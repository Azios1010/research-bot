import type postgres from "postgres";
import { GuardError } from "./guards.ts";

function assert(condition: boolean, label: string) {
  if (!condition) throw new GuardError(`Hosted concurrency assertion failed: ${label}`);
}

export async function verifyConcurrency(sql: postgres.Sql): Promise<void> {
  const token = crypto.randomUUID().replaceAll("-", "");
  const profile = crypto.randomUUID();
  const target = crypto.randomUUID();
  const sources = [crypto.randomUUID(), crypto.randomUUID()];
  const owners = [crypto.randomUUID(), crypto.randomUUID()];
  const maintenanceKey = `rrtest-${token}-maintenance`;
  console.log(
    JSON.stringify({
      fixtureScope: token,
      profileId: profile,
      sourceIds: sources,
      targetId: target,
    }),
  );
  const settings =
    await sql`select key,value from radar.system_settings where key in ('collection_paused','delivery_paused')`;
  const role = async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
    await sql.begin(async (tx) => {
      await tx`set local role service_role`;
      return await fn(tx);
    }) as T;
  try {
    await sql.begin(async (tx) => {
      await tx`update radar.system_settings set value = '{"enabled":false}' where key in ('collection_paused','delivery_paused')`;
      await tx`insert into radar.research_profiles(id,display_name,enabled,timezone,digest_enabled,reminders_enabled,rules)
        values(${profile},'Temporary concurrency fixture',true,'UTC',true,true,'{"positive_topics":["fixture"]}')`;
      await tx`insert into radar.delivery_targets(id,profile_id,bot_id,external_account_id,external_chat_id,enabled)
        values(${target},${profile},'1','1','1',true)`;
      for (const [index, source] of sources.entries()) {
        await tx`insert into radar.sources(id,slug,name,category,adapter_version,enabled,approved_at)
          values(${source},${`rrtest-${token}-${index}`},'Temporary fixture','fixture','fixture-v1',true,now())`;
      }
    });
    const runs = await Promise.all([0, 1].map((index) =>
      role(async (tx) => {
        const [run] = await tx`select * from public.rr_create_collection_run(${
          sources[0]
        },${`rrtest-${token}-coalesce-${index}`},'test')`;
        return run;
      })
    ));
    assert(runs[0].id === runs[1].id, "concurrent source refresh coalescing");
    await role(async (tx) => {
      await tx`select public.rr_create_collection_run(${
        sources[1]
      },${`rrtest-${token}-second-source`},'test')`;
    });

    await role(async (tx) => {
      await tx`select public.rr_enqueue_task('maintenance',${maintenanceKey},'{"operation":"health"}')`;
    });
    const claims = await Promise.all(owners.map((owner) =>
      role(async (tx) => {
        const [task] = await tx`select * from public.rr_claim_task(${owner},array['maintenance'])`;
        return { owner, task };
      })
    ));
    const winners = claims.filter(({ task }) => task.id !== null);
    assert(winners.length === 1, "SKIP LOCKED gives one owner for one ready task");
    await role(async (tx) => {
      await tx`select public.rr_finish_task(${winners[0].task.id},${winners[0].owner},${
        winners[0].task.lease_generation
      },'succeeded')`;
    });

    const pages = await Promise.all(owners.map((owner) =>
      role(async (tx) => {
        const [task] = await tx`select * from public.rr_claim_task(${owner},array['collect_page'])`;
        const [run] =
          await tx`select * from radar.collection_runs where id = ${task.collection_run_id}`;
        return { owner, task, run };
      })
    ));
    assert(
      pages.every(({ task }) => task.id) && pages[0].task.id !== pages[1].task.id,
      "two independent collection tasks",
    );
    const record = {
      source_record_key: "fixture-one",
      source_url: "https://example.invalid/fixture-one",
      parser_version: "fixture-v1",
      payload_hash: "a".repeat(64),
      canonical: {
        type_code: "conference",
        title: "Concurrency fixture",
        title_key: "concurrency fixture",
        organization: "Fixture university",
        organization_key: "fixture university",
        cycle_key: "2027",
        track_key: "",
        fingerprint: `rrtest-${token}`,
        fingerprint_version: 1,
        status: "open",
      },
      identities: [{ kind: "natural_key", key_version: 1, value: `rrtest-${token}` }],
    };
    await Promise.all(pages.map(({ owner, task, run }) =>
      role(async (tx) => {
        await tx`select public.rr_commit_source_page(${task.id},${owner},${task.lease_generation},0,${run.cursor_hash},
        'https://example.invalid/fixture',${tx.json([record])})`;
      })
    ));
    const observations =
      await sql`select opportunity_id from radar.source_records where source_id = any(${sources}::uuid[])`;
    assert(
      observations.length === 2 &&
        observations[0].opportunity_id === observations[1].opportunity_id,
      "cross-source strong identities converge",
    );
    const opportunity = observations[0].opportunity_id as string;
    const [{ count }] =
      await sql`select count(*)::integer as count from radar.opportunities where fingerprint = ${`rrtest-${token}`}`;
    assert(count === 1, "no orphan/duplicate canonical from concurrent insertion");

    const updates = await Promise.all([0, 1].map(() =>
      role(async (tx) => {
        const [row] =
          await tx`select public.rr_accept_telegram_update(${target},'1',100,'{"action":"help"}') as result`;
        return row.result;
      })
    ));
    assert(
      updates.filter((row) => row.duplicate === false).length === 1,
      "one accepted inbox action",
    );
    const [{ tasks }] =
      await sql`select count(*)::integer as tasks from radar.job_tasks where telegram_bot_id = '1' and telegram_update_id = 100`;
    assert(tasks === 1, "one concurrent inbox task");
    const command = await role(async (tx) => {
      const [task] = await tx`select * from public.rr_claim_task(${
        owners[0]
      },array['telegram_command'])`;
      return task;
    });
    await Promise.all([0, 1].map(() =>
      role(async (tx) => {
        await tx`select public.rr_apply_feedback(${profile},${opportunity},'save',${`rrtest-${token}-save`},'{}',${command.id},${
          owners[0]
        },${command.lease_generation})`;
      })
    ));
    const [{ feedback }] =
      await sql`select count(*)::integer as feedback from radar.user_feedback where profile_id = ${profile}`;
    assert(feedback === 1, "feedback event/current state are atomic under replay");
    await sql`insert into radar.opportunity_assessments(profile_id,opportunity_id,eligible,score,opportunity_revision,profile_revision,rules_version,valid_until)
      values(${profile},${opportunity},true,75,1,1,'fixture',now()+interval '1 day')`;

    for (const offset of [0, 1]) {
      await role(async (tx) => {
        await tx`select public.rr_enqueue_task('prepare_digest',${`rrtest-${token}-prepare-${offset}`},
        jsonb_build_object('profile_id',${profile}::uuid,'local_date',current_date + ${offset}::integer))`;
      });
    }
    const preparers = await Promise.all(owners.map((owner) =>
      role(async (tx) => {
        const [task] =
          await tx`select * from public.rr_claim_task(${owner},array['prepare_digest'])`;
        return { task, owner };
      })
    ));
    const outcomes = await Promise.allSettled(
      preparers.map(({ task, owner }) =>
        role(async (tx) => {
          await tx`select public.rr_prepare_notification(${profile},${target},'digest',${`digest:${task.payload.local_date}`},
        now()-interval '1 second',now()+interval '1 day','[{"text":"Temporary fixture"}]',
        ${
            tx.json([{
              opportunity_id: opportunity,
              part_index: 0,
              snapshot: { opportunity_revision: 1 },
            }])
          },${task.payload.local_date}::date,'UTC',${task.id},${owner},${task.lease_generation})`;
        })
      ),
    );
    assert(
      outcomes.filter((result) => result.status === "fulfilled").length === 1,
      "one first-digest claim across two concurrent dates",
    );
    const rejected = outcomes.find((result) => result.status === "rejected");
    assert(
      rejected?.status === "rejected" && rejected.reason?.code === "23505",
      "claim loser is an explicit uniqueness conflict",
    );
    const [{ notifications }] =
      await sql`select count(*)::integer as notifications from radar.notifications where profile_id = ${profile}`;
    assert(notifications === 1, "losing notification transaction leaves no empty/orphan envelope");
    const send = await role(async (tx) => {
      const [task] = await tx`select * from public.rr_claim_task(${
        owners[0]
      },array['send_notification'],1)`;
      await tx`select public.rr_begin_notification_attempt(${task.id},${
        owners[0]
      },${task.lease_generation})`;
      return task;
    });
    await sql`select pg_sleep(1.1)`;
    await role(async (tx) => {
      await tx`select public.rr_claim_task(${owners[1]},array['send_notification'])`;
    });
    const [after] =
      await sql`select t.status,a.state from radar.job_tasks t join radar.notification_attempts a on a.task_id = t.id where t.id = ${send.id}`;
    assert(
      after.status === "failed" && after.state === "uncertain",
      "crash after sending marker never becomes automatic resend",
    );
    console.log(
      "PASS: hosted concurrent clients: coalescing, SKIP LOCKED, identity convergence, inbox, feedback, notification claims, send-crash ambiguity.",
    );
  } finally {
    // Every deletion is scoped to UUIDs created by this invocation. No reset/truncate.
    await sql.begin(async (tx) => {
      const notifications =
        (await tx`select id from radar.notifications where profile_id = ${profile}`).map((row) =>
          row.id as string
        );
      const opportunities =
        (await tx`select distinct opportunity_id from radar.source_records where source_id = any(${sources}::uuid[]) and opportunity_id is not null`)
          .map((row) => row.opportunity_id as string);
      await tx`delete from radar.notification_attempts where notification_id = any(${notifications}::uuid[])`;
      await tx`delete from radar.notification_items where notification_id = any(${notifications}::uuid[])`;
      await tx`delete from radar.job_tasks where collection_run_id in (select id from radar.collection_runs where source_id = any(${sources}::uuid[]))
        or (telegram_bot_id = '1' and telegram_update_id = 100 and exists(select 1 from radar.telegram_updates u where u.bot_id = '1' and u.update_id = 100 and u.profile_id = ${profile}))
        or request_key = ${maintenanceKey} or payload->>'profile_id' = ${profile} or payload->>'notification_id' = any(${notifications}::text[])`;
      await tx`delete from radar.notifications where profile_id = ${profile}`;
      await tx`delete from radar.telegram_updates where profile_id = ${profile}`;
      await tx`delete from radar.user_feedback where profile_id = ${profile}`;
      await tx`delete from radar.user_opportunity_state where profile_id = ${profile}`;
      await tx`delete from radar.opportunity_assessments where profile_id = ${profile}`;
      await tx`delete from radar.opportunity_deadlines where opportunity_id = any(${opportunities}::uuid[])`;
      await tx`delete from radar.opportunity_identities where opportunity_id = any(${opportunities}::uuid[])`;
      await tx`delete from radar.source_records where source_id = any(${sources}::uuid[])`;
      await tx`delete from radar.collection_runs where source_id = any(${sources}::uuid[])`;
      await tx`delete from radar.opportunities where id = any(${opportunities}::uuid[])`;
      await tx`delete from radar.delivery_targets where id = ${target}`;
      await tx`delete from radar.research_profiles where id = ${profile}`;
      await tx`delete from radar.sources where id = any(${sources}::uuid[])`;
      for (const setting of settings) {
        await tx`update radar.system_settings set value = ${
          tx.json(setting.value)
        } where key = ${setting.key}`;
      }
    });
    console.log("PASS: this invocation's committed fixtures removed and pause settings restored.");
  }
}
