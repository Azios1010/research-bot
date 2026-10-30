import type postgres from "postgres";
import { assert, equals, rejects, TestAssertionError } from "../support.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import { SupabaseInteractions } from "../../supabase/functions/_shared/infrastructure/supabase/interactions.ts";
import { assess } from "../../supabase/functions/_shared/domain/assessment.ts";
import { type Lease, ProcessingError } from "../../supabase/functions/_shared/application/ports.ts";
import { executeLease } from "../../supabase/functions/_shared/application/worker.ts";
import {
  type BasicPatch,
  handleInteraction,
} from "../../supabase/functions/_shared/application/interaction.ts";
import { TelegramRenderer } from "../../supabase/functions/_shared/adapters/telegram/render.ts";
import {
  losslessJson,
  translateUpdate,
} from "../../supabase/functions/_shared/adapters/telegram/protocol.ts";
import { config as fixtureConfig, messageFixture } from "../telegram_support.ts";

// Real HTTPS RPCs; SQL only provisions/asserts/cleans isolated synthetic fixtures.
// No collector, external source, LLM, scheduler or real Telegram transport is constructed.
export async function verifyRanking(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
) {
  const inputHash = await conferenceInputHash(), passed: string[] = [];
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target.projectRef}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new ProcessingError("backend_key_unavailable");
  const keys = await response.json() as { name?: string; type?: string; api_key?: string }[];
  const key = keys.find((k) => k.name === "service_role")?.api_key ??
    keys.find((k) => k.type === "secret")?.api_key;
  if (!key) throw new ProcessingError("backend_key_unavailable");
  const client = persistenceClient(`https://${target.projectRef}.supabase.co`, key),
    work = new SupabaseRepository(client),
    ui = new SupabaseInteractions(client);
  const profile = crypto.randomUUID(),
    targetId = crypto.randomUUID(),
    ids = Array.from({ length: 123 }, () => crypto.randomUUID()).sort();
  // Preserve exact recovery scope before the first fixture write, including hard process exit.
  await Deno.writeTextFile(
    "private/phase08-fixture.json",
    JSON.stringify({
      projectRef: target.projectRef,
      targetClass: target.targetClass,
      profile,
      targetId,
      ids,
    }),
    { createNew: true },
  );
  const config = { ...fixtureConfig, bindings: [{ ...fixtureConfig.bindings[0], targetId }] };
  const ok = (value: unknown, label: string) => {
    assert(value, label);
    passed.push(label);
    console.log(`PASS: Ranking ${label}`);
  };
  let update = 30000;
  const command = async (text: string, patch?: BasicPatch) => {
    const input = translateUpdate(
      losslessJson(await messageFixture(text, String(++update))),
      config,
    );
    assert(input);
    if (patch) input.action = { kind: "command", command: "profile", patch };
    await ui.accept(input, config.botId);
    const lease = await work.claim(crypto.randomUUID(), ["telegram_command"]);
    assert(lease);
    const context = await ui.execute(lease);
    await handleInteraction(lease, {
      repository: ui,
      renderer: new TelegramRenderer(),
      clock: { now: () => new Date().toISOString() },
    });
    return { context, lease, input };
  };
  const compute = async (lease: Lease, clock = new Date().toISOString()) => {
    const c = await work.assessment(lease);
    return c.opportunities.map((o) =>
      assess(
        o,
        c.profile,
        c.states[o.id] ?? { saved: false, ignored: false },
        clock,
        c.enabledTypes,
      )
    );
  };
  const one = async (name: string) => {
    const result = await client.rpc("rr_enqueue_task", {
      p_kind: "assess_batch",
      p_request_key: `ranking:${profile}:${name}`,
      p_payload: { profile_id: profile, opportunity_ids: [ids[0]] },
    });
    assert(!result.error);
    // Isolate the requested task from any already queued rerank continuations.
    await sql`update radar.job_tasks set available_at=clock_timestamp()-interval '1 day' where request_key=${`ranking:${profile}:${name}`}`;
    const lease = await work.claim(crypto.randomUUID(), ["assess_batch"]);
    assert(lease);
    return lease;
  };
  const drain = async () => {
    let batches = 0;
    for (let i = 0; i < 25; i++) {
      const lease = await work.claim(crypto.randomUUID(), ["assess_batch"]);
      if (!lease) return batches;
      await executeLease(lease, {
        repository: work,
        adapters: new Map(),
        clock: { now: () => new Date().toISOString() },
        logger: { log: () => {} },
        http: {
          request: () => {
            throw new TestAssertionError("source IO forbidden");
          },
        },
      }, new AbortController().signal);
      batches++;
    }
    throw new TestAssertionError("bounded rerank drain");
  };
  try {
    await sql`insert into radar.research_profiles(id,display_name)values(${profile},'Synthetic ranking profile')`;
    await sql`insert into radar.delivery_targets(id,profile_id,external_account_id,external_chat_id,bot_id,enabled)values(${targetId},${profile},${
      config.bindings[0].userId
    },${config.bindings[0].chatId},${config.botId},true)`;
    for (let i = 0; i < ids.length; i++) {
      await sql`insert into radar.opportunities(id,type_code,title,title_key,organization,organization_key,topics,qualification_tags,country_codes,work_mode,content_hash,fingerprint,fingerprint_version,status,event_end)values(${
        ids[i]
      },${
        i === 122 ? "conference" : "phd"
      },${`Synthetic MRI ${i}`},${`synthetic mri ${i}`},'Example Institute','example institute',array['medical imaging'],array['masters'],array['DE'],'remote',${
        "a".repeat(64)
      },${"b".repeat(64)},1,'open',${i === 122 ? "2020-01-01" : null})`;
    }
    const setup = await command("profile", {
      timezone: "UTC",
      topics: ["MRI"],
      types: ["phd"],
      enabled: true,
      preferences: {
        type_weights: { phd: 1 },
        preferred_countries: ["DE"],
        compatible_qualifications: ["masters"],
        reminder_offsets: [7, 1],
      },
    });
    ok(
      setup.context.profile.revision === 2 && setup.context.profile.enabled,
      "atomic profile setup increments revision once",
    );
    const duplicate = await ui.accept(setup.input, config.botId);
    ok(duplicate.duplicate, "update replay cannot repeat profile mutation");
    const [revision] = await sql`select revision from radar.research_profiles where id=${profile}`;
    equals(Number(revision.revision), 2);
    const active = await client.rpc("rr_request_rerank", {
      p_profile: profile,
      p_request_key: "coalesce",
    });
    assert(!active.error);
    const again = await client.rpc("rr_request_rerank", {
      p_profile: profile,
      p_request_key: "coalesce",
    });
    ok(active.data === again.data, "rerank requests coalesce with active revision chain");
    const [batch] = await sql`select payload from radar.job_tasks where id=${active.data}`;
    ok(
      batch.payload.opportunity_ids.length === 50,
      "first rerank task bounded to fifty persisted IDs",
    );
    const claims = await Promise.all([
      work.claim(crypto.randomUUID(), ["assess_batch"]),
      work.claim(crypto.randomUUID(), ["assess_batch"]),
    ]);
    ok(claims.filter(Boolean).length === 1, "concurrent workers cannot own the same rerank page");
    const first = claims.find((l) => l)!;
    await work.storeAssessments(first, await compute(first));
    const remaining = await drain();
    ok(remaining === 2, "atomic continuation covers remaining keyset in bounded pages");
    const [all] =
      await sql`select count(*)::integer n from radar.opportunity_assessments where profile_id=${profile}`;
    ok(all.n === 123, "full persisted set reranked without recollection");
    const [expired] =
      await sql`select eligible,score,reason_codes,valid_until,evaluated_at from radar.opportunity_assessments where profile_id=${profile} and opportunity_id=${
        ids[122]
      }`;
    ok(
      !expired.eligible && expired.score === null &&
        expired.reason_codes.includes("event_expired") &&
        new Date(expired.valid_until).getTime() > new Date(expired.evaluated_at).getTime(),
      "expired event exclusion persists with a future recheck time",
    );
    const invalid = await command("profile", {
      timezone: "Europe/Paris",
      preferences: { type_weights: { phd: -1 } },
    });
    ok(
      invalid.context.result.status === "invalid_profile" &&
        invalid.context.profile.timezone === "UTC" && invalid.context.profile.revision === 2,
      "invalid multi field mutation rolls back atomically",
    );
    for (
      const text of [
        "profile topics medical imaging^3|MRI; machine learning^1|AI",
        "profile weights phd=0.8,conference=0.4",
        "profile blocked weapons",
        "profile ignored advertising",
        "profile countries DE,VN",
        "profile excluded-countries US",
        "profile hard-countries false",
        "profile institutions Example Institute",
        "profile blocked-institutions Other Institute",
        "profile work-modes remote,hybrid",
        "profile qualifications masters",
        "profile conflicts clinical license",
        "profile student false",
        "profile nationalities VN",
        "profile unknown allow",
        "profile time 07:30",
        "profile offsets 30d,7d,1d",
        "profile reminders true",
        "profile digest false",
      ]
    ) {
      const c = await command(text);
      ok(
        c.context.result.status === "ok",
        `${text.split(" ").slice(0, 2).join(" ")} edit via authorized application action`,
      );
    }
    await drain();
    const [fresh] =
      await sql`select * from radar.opportunity_assessments where profile_id=${profile} and opportunity_id=${
        ids[0]
      }`;
    ok(
      fresh.rules_version === "deterministic-v2" && Number(fresh.score) === 77,
      "stored exact score components read through persisted current model",
    );
    const old = await one("profile-cas"), oldResults = await compute(old);
    await command("profile countries DE");
    await rejects(() => work.storeAssessments(old, oldResults), "reconciliation_stale");
    await work.finish(old, "canceled", "fixture_stale", 1);
    ok(true, "profile changes fence an in flight assessment");
    await drain();
    const changed = await one("opportunity-cas"), changedResults = await compute(changed);
    await sql`update radar.opportunities set title='Synthetic revised MRI',content_revision=content_revision+1 where id=${
      ids[0]
    }`;
    await rejects(() => work.storeAssessments(changed, changedResults), "reconciliation_stale");
    await work.finish(changed, "canceled", "fixture_stale", 1);
    ok(true, "opportunity revision fences stale assessment writes");
    const rule = await one("rule-cas"), ruleResults = await compute(rule);
    ruleResults[0].rulesVersion = "deterministic-v1";
    await rejects(() => work.storeAssessments(rule, ruleResults), "reconciliation_stale");
    await work.finish(rule, "canceled", "fixture_stale", 1);
    ok(true, "old rule cannot overwrite current assessment");
    const timed = await one("time-cas"), timedResults = await compute(timed);
    timedResults[0].validUntil = new Date(Date.now() - 1000).toISOString();
    await rejects(() => work.storeAssessments(timed, timedResults), "reconciliation_stale");
    await work.finish(timed, "canceled", "fixture_stale", 1);
    ok(true, "expired assessment cannot be persisted as current");
    const older = await one("older"), newer = await one("newer");
    const early = new Date().toISOString(), late = new Date(Date.parse(early) + 1).toISOString();
    const earlyResults = await compute(older, early), lateResults = await compute(newer, late);
    const races = await Promise.allSettled([
      work.storeAssessments(older, earlyResults),
      work.storeAssessments(newer, lateResults),
    ]);
    for (let i = 0; i < races.length; i++) {
      if (races[i].status === "rejected") {
        const err = (races[i] as PromiseRejectedResult).reason;
        assert(err instanceof ProcessingError && err.code === "reconciliation_stale");
        await work.finish([older, newer][i], "canceled", "fixture_stale", 1);
      }
    }
    const [winner] =
      await sql`select evaluated_at from radar.opportunity_assessments where profile_id=${profile} and opportunity_id=${
        ids[0]
      }`;
    ok(
      new Date(winner.evaluated_at).getTime() === Date.parse(late),
      "overlapping writes preserve newest evaluation timestamp",
    );
    const ignoreRace = await one("ignore-race"), beforeIgnore = await compute(ignoreRace);
    let pending: Promise<number> | undefined;
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${
        "notification-profile:" + profile
      },0))`;
      pending = work.storeAssessments(ignoreRace, beforeIgnore);
      // Observe immediately; retain the original promise for the explicit rejection assertion.
      void pending.catch(() => {});
      // This operator transaction is a concurrency barrier, never a runtime IO transaction.
      let blocked = false;
      for (let i = 0; i < 40; i++) {
        const [lock] =
          await tx`select exists(select 1 from pg_locks where locktype='advisory' and not granted) waiting`;
        if (lock.waiting) {
          blocked = true;
          break;
        }
        await tx`select pg_sleep(0.05)`;
      }
      assert(blocked, "assessment waits for feedback critical section");
      await tx`insert into radar.user_opportunity_state(profile_id,opportunity_id,saved,ignored,saved_at,ignored_at)values(${profile},${
        ids[0]
      },true,true,now(),now())`;
    });
    assert(pending);
    await rejects(() => pending!, "reconciliation_stale");
    await work.finish(ignoreRace, "canceled", "fixture_stale", 1);
    await drain();
    ok(true, "concurrent Ignore is serialized before assessment eligibility CAS");
    // Create a historical active claim directly as a synthetic fixture, not a digest generator.
    const [notification] =
      await sql`insert into radar.notifications(profile_id,delivery_target_id,kind,schedule_key,local_date,timezone_snapshot,due_at,expires_at,parts,part_states,status,sent_at)values(${profile},${targetId},'digest','digest:' || current_date,current_date,'UTC',now(),now()+interval '1 day','[{"text":"Synthetic historical claim"}]','["sent"]','sent',now())returning id`;
    await sql`insert into radar.notification_items(notification_id,profile_id,opportunity_id,part_index,purpose,snapshot)values(${notification.id},${profile},${
      ids[0]
    },0,'digest_first_seen','{"label":"synthetic historical exposure"}')`;
    await drain();
    const [ignored] =
      await sql`select a.score,a.eligible,s.saved,s.ignored from radar.opportunity_assessments a join radar.user_opportunity_state s using(profile_id,opportunity_id)where a.profile_id=${profile} and a.opportunity_id=${
        ids[0]
      }`;
    ok(
      !ignored.eligible && ignored.score === null && ignored.saved && ignored.ignored,
      "rerank preserves saved plus ignored and excludes before scoring",
    );
    await command("profile weights phd=1");
    await drain();
    const [claim] =
      await sql`select count(*)::integer n,bool_and(claim_active) active from radar.notification_items where notification_id=${notification.id}`;
    ok(
      claim.n === 1 && claim.active,
      "profile scoring changes preserve historical notification claim",
    );
    await sql`insert into radar.user_feedback(profile_id,opportunity_id,action,idempotency_key,context) values(${profile},${
      ids[0]
    },'save','synthetic-historical-feedback','{"rule_version":"deterministic-v2","score":77,"label":"synthetic exposure"}')`;
    const [feedbackBefore] =
      await sql`select count(*)::integer n from radar.user_feedback where profile_id=${profile}`;
    await command("profile weights phd=0.9");
    await command("profile rerank");
    await drain();
    const [feedbackAfter] =
      await sql`select count(*)::integer n,min((context->>'score')::integer) shown from radar.user_feedback where profile_id=${profile}`;
    ok(
      feedbackBefore.n === 1 && feedbackAfter.n === 1 && feedbackAfter.shown === 77,
      "profile edit and rerank preserve existing feedback exposure",
    );
    const [collections] = await sql`select count(*)::integer n from radar.collection_runs`;
    ok(collections.n === 0, "profile edits and reranking enqueue no collections");
    ok(
      inputHash === await conferenceInputHash(),
      "ranking inputs unchanged during hosted verification",
    );
  } catch (error) {
    if (error instanceof TestAssertionError) console.error(`Ranking assertion: ${error.message}`);
    if (error instanceof ProcessingError) console.error(`Ranking error: ${error.code}`);
    throw error;
  } finally {
    await sql.begin(async (tx) => {
      await tx`delete from radar.notification_attempts where notification_id in(select id from radar.notifications where profile_id=${profile})`;
      await tx`delete from radar.notification_items where profile_id=${profile}`;
      await tx`delete from radar.job_tasks where payload->>'profile_id'=${profile} or telegram_bot_id=${config.botId} and telegram_update_id in(select update_id from radar.telegram_updates where profile_id=${profile}) or payload->>'notification_id' in(select id::text from radar.notifications where profile_id=${profile})`;
      await tx`delete from radar.notifications where profile_id=${profile}`;
      await tx`delete from radar.telegram_updates where profile_id=${profile}`;
      await tx`delete from radar.user_feedback where profile_id=${profile}`;
      await tx`delete from radar.user_opportunity_state where profile_id=${profile}`;
      await tx`delete from radar.opportunity_assessments where profile_id=${profile}`;
      await tx`delete from radar.delivery_targets where profile_id=${profile}`;
      await tx`delete from radar.research_profiles where id=${profile}`;
      await tx`delete from radar.opportunities where id=any(${ids}::uuid[])`;
    });
    console.log("PASS: Ranking scoped synthetic cleanup; no pause settings changed.");
    await Deno.remove("private/phase08-fixture.json");
  }
  await Deno.writeTextFile(
    "private/phase08-ranking.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        targetClass: target.targetClass,
        projectRef: target.projectRef,
        inputHash,
        assertions: passed,
        cleanup: true,
        personalCalibration: false,
      },
      null,
      2,
    ),
  );
  console.log(`PASS: ${passed.length} hosted ranking assertions.`);
}
