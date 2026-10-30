import type postgres from "postgres";
import { assert, equals, rejects, TestAssertionError } from "../support.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { SupabaseInteractions } from "../../supabase/functions/_shared/infrastructure/supabase/interactions.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import {
  commands,
  deliverReply,
  handleInteraction,
  type ReplyPart,
} from "../../supabase/functions/_shared/application/interaction.ts";
import { type Lease, ProcessingError } from "../../supabase/functions/_shared/application/ports.ts";
import { TelegramDelivery } from "../../supabase/functions/_shared/adapters/telegram/delivery.ts";
import { TelegramRenderer } from "../../supabase/functions/_shared/adapters/telegram/render.ts";
import { webhookHandler } from "../../supabase/functions/_shared/adapters/telegram/webhook.ts";
import {
  decodeCallback,
  losslessJson,
  translateUpdate,
} from "../../supabase/functions/_shared/adapters/telegram/protocol.ts";
import {
  callbackFixture,
  config as fixtureConfig,
  messageFixture,
  syntheticBot,
  syntheticUser,
} from "../telegram_support.ts";
import { MockBotApi } from "../telegram_transport.ts";
import { opportunityTypes } from "../../supabase/functions/_shared/domain/model.ts";

// SQL creates/asserts/cleans synthetic rows only. Runtime work uses real Supabase-js RPCs.
// Invoked exclusively through scripts/db/main.ts after target/history/receipt/lock guards.
export async function verifyTelegram(
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
  const tracedFetch: typeof fetch = async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname.split("/")
      .at(-1);
    const response = await fetch(input, init);
    if (!response.ok) {
      const body = await response.clone().json().catch(() => ({}));
      console.error(
        JSON.stringify({
          rpc: path,
          code: typeof body.code === "string" && /^[A-Z0-9]{5,12}$/.test(body.code)
            ? body.code
            : "HTTP_FAILURE",
        }),
      );
    }
    return response;
  };
  const client = persistenceClient(`https://${target.projectRef}.supabase.co`, key, tracedFetch),
    store = new SupabaseInteractions(client),
    work = new SupabaseRepository(client);
  const profileId = crypto.randomUUID(),
    targetId = crypto.randomUUID(),
    otherProfile = crypto.randomUUID(),
    otherTarget = crypto.randomUUID(),
    sourceId = crypto.randomUUID();
  const ids = opportunityTypes.map(() => crypto.randomUUID()).concat(
    Array.from({ length: 8 }, () => crypto.randomUUID()),
  );
  const config = {
    ...fixtureConfig,
    bindings: [{ userId: syntheticUser, chatId: syntheticUser, targetId }],
  };
  const clock = { now: () => new Date().toISOString() },
    bot = new MockBotApi(),
    delivery = new TelegramDelivery(`${syntheticBot}:${"x".repeat(40)}`, bot.fetch),
    renderer = new TelegramRenderer();
  let updateId = 10000;
  const pauses =
    await sql`select key,value from radar.system_settings where key in ('collection_paused','delivery_paused')`;
  const ok = (condition: unknown, label: string) => {
    assert(condition, label);
    passed.push(label);
    console.log(`PASS: Telegram ${label}`);
  };
  const handler = webhookHandler({
    config,
    inbox: () => store,
    acknowledge: (id) => delivery.acknowledge(id),
  });
  const ingress = async (body: string) => {
    const r = await handler(
      new Request("https://example.invalid/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": config.secret,
        },
        body,
      }),
    );
    equals(r.status, 200, "hosted webhook receipt");
  };
  const sendOne = async () => {
    const lease = await work.claim(crypto.randomUUID(), ["send_notification"]);
    if (lease) await deliverReply(lease, { repository: store, delivery });
    return lease;
  };
  const drain = async () => {
    for (let i = 0; i < 30; i++) if (!await sendOne()) return;
    throw new TestAssertionError("bounded reply drain");
  };
  const process = async (body: string, send = true) => {
    await ingress(body);
    const lease = await work.claim(crypto.randomUUID(), ["telegram_command"]);
    assert(lease, "accepted command has durable task");
    await handleInteraction(lease, { repository: store, renderer, clock });
    const [n] =
      await sql`select id,parts from radar.notifications where profile_id=${profileId} and schedule_key=${
        "command:" + lease.id
      }`;
    assert(n, "command logical notification persisted");
    if (send) await drain();
    return { lease, notificationId: String(n.id), parts: n.parts as ReplyPart[] };
  };
  const command = (name: string, send = true, id = String(++updateId)) =>
    messageFixture(name, id).then((body) => process(body, send));
  type Reply = Awaited<ReturnType<typeof process>>;
  const button = async (reply: Reply, code: string) => {
    const partIndex = reply.parts.findIndex((p) =>
      p.buttons.flat().some((b) => b.action?.startsWith(`1:${code}:`))
    );
    assert(partIndex >= 0, `reply contains ${code} button`);
    const action = reply.parts[partIndex].buttons.flat().find((b) =>
      b.action?.startsWith(`1:${code}:`)
    )!.action!;
    const [attempt] =
      await sql`select telegram_message_id from radar.notification_attempts where notification_id=${reply.notificationId} and part_index=${partIndex} and state='sent' order by attempt_number desc limit 1`;
    assert(attempt, "callback original message has definite persistence");
    const index = decodeCallback(action).index;
    return {
      action,
      messageId: String(attempt.telegram_message_id),
      opportunityId: reply.parts[partIndex].itemIds[index],
    };
  };
  const click = async (reply: Reply, code: string) => {
    const b = await button(reply, code);
    return await process(
      callbackFixture(b.action, { messageId: b.messageId, updateId: String(++updateId) }),
    );
  };
  try {
    await sql`update radar.system_settings set value='{"enabled":false}' where key in ('collection_paused','delivery_paused')`;
    await sql`insert into radar.research_profiles(id,display_name)values(${profileId},'Synthetic UI profile'),(${otherProfile},'Synthetic other profile')`;
    await sql`insert into radar.delivery_targets(id,profile_id,external_account_id,external_chat_id,bot_id,enabled)values(${targetId},${profileId},${syntheticUser},${syntheticUser},${syntheticBot},true),(${otherTarget},${otherProfile},'20000000000000002','20000000000000002',${syntheticBot},true)`;
    for (let i = 0; i < ids.length; i++) {
      const type = opportunityTypes[i] ?? "conference";
      const attrs = type === "grant"
        ? {
          schema_version: 1,
          funding: { schema_version: 1, source_status: "forecasted", deadline_estimated: true },
        }
        : type === "journal_special_issue"
        ? {
          schema_version: 1,
          journal_call: { schema_version: 1, source_status: "upcoming", abstract_required: true },
        }
        : { schema_version: 1 };
      await sql`insert into radar.opportunities(id,type_code,title,title_key,organization,canonical_url,content_hash,fingerprint,fingerprint_version,status,attributes,event_start)values(${
        ids[i]
      },${type},${`Synthetic ${i} Nghiên cứu & <dữ liệu> 😀`},${`synthetic ${i}`},'Université de Montréal · 東京大学','https://example.invalid/official?x=1&y=2',${
        "a".repeat(64)
      },${"b".repeat(64)},1,'open',${sql.json(attrs)},${
        ["conference", "workshop"].includes(type) ? "2027-06-01" : null
      })`;
      const precision = i === 0 ? "instant" : i === 1 || i === 2 ? "unknown" : "date";
      await sql`insert into radar.opportunity_deadlines(opportunity_id,kind,round_key,label,precision,basis,due_at,due_date,timezone,status)values(${
        ids[i]
      },'application','application',${
        i === 1 ? "Rolling application" : "Application"
      },${precision},${precision === "unknown" ? "unknown" : "explicit"},${
        precision === "instant" ? new Date(Date.now() + 86400000).toISOString() : null
      },${
        precision === "date" ? new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) : null
      },${precision === "instant" ? "UTC" : null},${i === 3 ? "conflicted" : "current"})`;
    }
    for (const cmd of commands) {
      const reply = await command(cmd);
      ok(reply.parts.length > 0 && reply.parts.length <= 10, `${cmd} command durable routing`);
    }
    const [initial] =
      await sql`select enabled,digest_enabled,timezone,rules from radar.research_profiles where id=${profileId}`;
    ok(
      !initial.enabled && !initial.digest_enabled && initial.timezone === null &&
        Object.keys(initial.rules).length === 0,
      "start and profile do not invent settings",
    );
    const before =
      await sql`select count(*)::int n from radar.notifications where profile_id=${profileId}`;
    const raw = await messageFixture("help", String(updateId));
    await ingress(raw);
    const after =
      await sql`select count(*)::int n from radar.notifications where profile_id=${profileId}`;
    ok(
      before[0].n === after[0].n && !await work.claim(crypto.randomUUID(), ["telegram_command"]),
      "completed command replay makes no logical reply",
    );
    await command("help", true, "1002");
    await command("help", true, "1001");
    const outOfOrder =
      await sql`select update_id::text from radar.telegram_updates where bot_id=${syntheticBot} and update_id in (1001,1002) and status='completed'`;
    ok(outOfOrder.length === 2, "1002 then 1001 both process");
    await command("profile enabled true");
    ok(
      !(await sql`select enabled from radar.research_profiles where id=${profileId}`)[0].enabled,
      "incomplete enable fails closed",
    );
    for (
      const patch of [
        "timezone UTC",
        "topics synthetic research; dữ liệu",
        "types " + opportunityTypes.join(","),
        "time 09:15",
        "enabled true",
        "digest false",
      ]
    ) await command("profile " + patch);
    const [configured] =
      await sql`select enabled,timezone,digest_local_time::text,digest_enabled,revision from radar.research_profiles where id=${profileId}`;
    ok(
      configured.enabled && configured.timezone === "UTC" && !configured.digest_enabled &&
        configured.digest_local_time.startsWith("09:15"),
      "explicit basic profile validates and persists",
    );
    await sql`insert into radar.opportunity_assessments(profile_id,opportunity_id,eligible,score,reason_codes,components,opportunity_revision,profile_revision,rules_version,valid_until)select ${profileId},id,true,75,array['topic_match'],'{}',content_revision,${configured.revision},'deterministic-v2',clock_timestamp()+interval '1 day' from radar.opportunities where id=any(${ids}::uuid[])`;
    const today = await command("today");
    const todaySnapshot = today.parts[0].view;
    ok(
      Boolean(todaySnapshot?.ids.length) && !todaySnapshot!.ids.includes(ids[9]) &&
        !todaySnapshot!.ids.includes(ids[8]),
      "today uses fresh assessments and excludes forecast upcoming calls",
    );
    const deadlines = await command("deadlines"),
      text = deadlines.parts.map((p) => p.text).join(" ");
    ok(
      Boolean(deadlines.parts[0].view?.ids.includes(ids[0])) &&
        /date only|rolling|unknown|conflicting|explicit|UTC/.test(text),
      "deadline precision and uncertain states project safely",
    );
    const listing = await command("conferences"), snapshot = listing.parts[0].view;
    assert(snapshot && snapshot.ids.length > 3);
    const next = await click(listing, "p");
    equals(next.parts[0].view?.ids, snapshot.ids);
    equals(next.parts[0].view?.offset, 3);
    ok(
      !next.parts.filter((p) => p.buttons.length).some((p) =>
        p.itemIds.some((id) => snapshot.ids.slice(0, 3).includes(id))
      ),
      "stable snapshot pagination has no repeated first page items",
    );
    const saved = await click(listing, "s"), savedButton = await button(saved, "u");
    let [state] =
      await sql`select saved,ignored from radar.user_opportunity_state where profile_id=${profileId} and opportunity_id=${savedButton.opportunityId}`;
    ok(state.saved && !state.ignored, "Save sets desired state and feedback");
    const [exposure] =
      await sql`select context from radar.user_feedback where profile_id=${profileId} and opportunity_id=${savedButton.opportunityId} and action='save'`;
    ok(
      exposure.context.rule_version === "deterministic-v2" && exposure.context.score === 75 &&
        exposure.context.opportunity_revision === 1,
      "feedback preserves original shown assessment exposure context",
    );
    const replayId = String(updateId),
      priorFeedback =
        (await sql`select count(*)::int n from radar.user_feedback where profile_id=${profileId}`)[
          0
        ].n;
    const originalSave = await button(listing, "s");
    await ingress(
      callbackFixture(originalSave.action, {
        messageId: originalSave.messageId,
        updateId: replayId,
      }),
    );
    ok(
      (await sql`select count(*)::int n from radar.user_feedback where profile_id=${profileId}`)[0]
        .n === priorFeedback,
      "callback update replay does not repeat Save",
    );
    const savedList = await command("saved");
    ok(
      savedList.parts[0].view?.ids.includes(savedButton.opportunityId),
      "saved projection reads current state",
    );
    const unsaved = await click(saved, "u");
    [state] =
      await sql`select saved,ignored from radar.user_opportunity_state where profile_id=${profileId} and opportunity_id=${savedButton.opportunityId}`;
    ok(!state.saved, "Unsave explicitly clears saved state");
    const ignored = await click(unsaved, "i");
    [state] =
      await sql`select saved,ignored from radar.user_opportunity_state where profile_id=${profileId} and opportunity_id=${savedButton.opportunityId}`;
    ok(state.ignored, "Ignore explicitly suppresses normal lists");
    const ignoreButton = await button(unsaved, "i");
    const ignoreFeedback =
      (await sql`select count(*)::int n from radar.user_feedback where profile_id=${profileId}`)[0]
        .n;
    await ingress(
      callbackFixture(ignoreButton.action, {
        messageId: ignoreButton.messageId,
        updateId: String(updateId),
      }),
    );
    ok(
      (await sql`select count(*)::int n from radar.user_feedback where profile_id=${profileId}`)[0]
        .n === ignoreFeedback,
      "callback replay cannot repeat or reverse Ignore",
    );
    const ignoredList = await command("conferences");
    ok(
      !ignoredList.parts[0].view?.ids.includes(savedButton.opportunityId),
      "ignored item excluded from normal projection",
    );
    const unignored = await click(ignored, "r");
    [state] =
      await sql`select saved,ignored from radar.user_opportunity_state where profile_id=${profileId} and opportunity_id=${savedButton.opportunityId}`;
    ok(!state.ignored, "Undo Ignore explicitly clears ignored state");
    const details = await click(unignored, "d");
    ok(
      details.parts.some((p) => p.text.includes("Relevance:")) &&
        details.parts.some((p) => p.buttons.flat().some((b) => b.url?.startsWith("https:"))),
      "details include score source link and bounded facts",
    );
    ok(
      (await sql`select count(*)::int n from radar.user_feedback where profile_id=${profileId} and action='open_intent'`)[
        0
      ].n === 0,
      "URL buttons do not fabricate Open telemetry",
    );
    await click(details, "o");
    ok(
      (await sql`select count(*)::int n from radar.user_feedback where profile_id=${profileId} and action='open_intent'`)[
        0
      ].n === 1,
      "tracked Open records intent only",
    );
    const foreign = {
      updateId: String(++updateId),
      binding: { userId: "20000000000000002", chatId: "20000000000000002", targetId: otherTarget },
      action: {
        kind: "callback" as const,
        token: originalSave.action,
        messageId: originalSave.messageId,
      },
    };
    const rejected = await store.accept(foreign, syntheticBot);
    ok(
      rejected.status === "rejected" &&
        !await work.claim(crypto.randomUUID(), ["telegram_command"]),
      "cross profile and cross target callback rejected without task",
    );
    await ingress(
      callbackFixture(originalSave.action, { messageId: "9999999", updateId: String(++updateId) }),
    );
    await ingress(
      callbackFixture('{"profileId":"forged","opportunityId":"forged"}', {
        updateId: String(++updateId),
      }),
    );
    ok(
      !await work.claim(crypto.randomUUID(), ["telegram_command"]),
      "copied message and forged callback IDs rejected",
    );
    await sql`update radar.notifications set created_at=clock_timestamp()-interval '25 hours' where id=${listing.notificationId}`;
    await ingress(
      callbackFixture(originalSave.action, {
        messageId: originalSave.messageId,
        updateId: String(++updateId),
      }),
    );
    ok(
      !await work.claim(crypto.randomUUID(), ["telegram_command"]),
      "stale callback safely rejected",
    );
    const concurrent = translateUpdate(
      losslessJson(await messageFixture("help", String(++updateId))),
      config,
    )!;
    const receipts = await Promise.all([
      store.accept(concurrent, syntheticBot),
      store.accept(concurrent, syntheticBot),
    ]);
    ok(
      receipts.filter((r) => !r.duplicate).length === 1,
      "concurrent real HTTP inbox receipt deduplicates",
    );
    const concurrentLease = await work.claim(crypto.randomUUID(), ["telegram_command"]);
    assert(concurrentLease);
    await handleInteraction(concurrentLease, { repository: store, renderer, clock });
    await drain();
    await sql`insert into radar.sources(id,slug,name,category,adapter_version,enabled,approved_at)values(${sourceId},${
      "p07-" + sourceId
    },'Synthetic refresh fixture','fixture','fake-json-v1',true,clock_timestamp())`;
    await ingress(await messageFixture("refresh", String(++updateId)));
    await ingress(await messageFixture("refresh", String(++updateId)));
    const l1 = await work.claim(crypto.randomUUID(), ["telegram_command"]),
      l2 = await work.claim(crypto.randomUUID(), ["telegram_command"]);
    assert(l1 && l2);
    const results = await Promise.all([store.execute(l1), store.execute(l2)]);
    ok(
      results.some((r) => r.result.status === "queued") && results.some((r) =>
        r.result.status === "throttled"
      ) &&
        (await sql`select count(*)::int n from radar.collection_runs where source_id=${sourceId} and status in ('queued','running')`)[
            0
          ].n === 1,
      "concurrent refresh durable coalescing and five minute throttle",
    );
    for (const l of [l1, l2]) await handleInteraction(l, { repository: store, renderer, clock });
    await drain();
    const refreshCount =
      (await sql`select count(*)::int n from radar.collection_runs where source_id=${sourceId}`)[0]
        .n;
    await ingress(await messageFixture("refresh", String(updateId)));
    ok(
      (await sql`select count(*)::int n from radar.collection_runs where source_id=${sourceId}`)[0]
        .n === refreshCount,
      "refresh replay cannot enqueue another run",
    );
    // Crash after effect but before reply: re-execution reads its journal, even after a later edit.
    await ingress(await messageFixture("profile time 10:00", String(++updateId)));
    const effectLease = await work.claim(crypto.randomUUID(), ["telegram_command"]);
    assert(effectLease);
    await store.execute(effectLease);
    await sql`update radar.research_profiles set digest_local_time='11:00' where id=${profileId}`;
    await handleInteraction(effectLease, { repository: store, renderer, clock });
    await drain();
    ok(
      (await sql`select digest_local_time::text t from radar.research_profiles where id=${profileId}`)[
        0
      ].t.startsWith("11:00"),
      "profile effect replay cannot overwrite later settings",
    );
    const success =
      (await sql`select count(*)::int n from radar.notification_attempts where state='sent'`)[0].n;
    ok(success > 0, "mock successful sends persist definite message IDs");
    await command("help", false);
    bot.scenario = "rate_limit";
    const rateLease = await sendOne();
    assert(rateLease);
    const [rate] =
      await sql`select a.state,a.retry_after_seconds,t.status,t.available_at>clock_timestamp()+interval '30 seconds' as delayed from radar.notification_attempts a join radar.job_tasks t on t.id=a.task_id where t.id=${rateLease.id}`;
    ok(
      rate.state === "retryable_failure" && rate.retry_after_seconds === 37 &&
        rate.status === "queued" && rate.delayed,
      "429 persists Retry After without immediate replay",
    );
    bot.scenario = "success";
    await sql`update radar.job_tasks set available_at=clock_timestamp()-interval '1 second' where id=${rateLease.id}`;
    await drain();
    ok(
      (await sql`select count(*)::int n from radar.notification_attempts where task_id=${rateLease.id}`)[
        0
      ].n === 2,
      "definite rejection retries as a new persisted attempt",
    );
    await command("help", false);
    bot.scenario = "permanent";
    const permanent = await sendOne();
    assert(permanent);
    ok(
      (await sql`select state from radar.notification_attempts where task_id=${permanent.id}`)[0]
        .state === "permanent_failure",
      "permanent Bot API failure terminalizes send",
    );
    for (const scenario of ["timeout", "server"] as const) {
      bot.scenario = "success";
      await command("help", false);
      bot.scenario = scenario;
      const uncertain = await sendOne();
      assert(uncertain);
      const calls = bot.sends.length;
      await ingress(await messageFixture("help", String(updateId)));
      await sendOne();
      ok(
        (await sql`select state from radar.notification_attempts where task_id=${uncertain.id}`)[0]
              .state === "uncertain" && bot.sends.length === calls,
        `${scenario} stays uncertain and is never blindly replayed`,
      );
    }
    bot.scenario = "success";
    for (const possibleSend of [false, true]) {
      await command("help", false);
      const crashed = await work.claim(crypto.randomUUID(), ["send_notification"]);
      assert(crashed);
      const attempt = await store.begin(crashed);
      assert(attempt.attemptId && attempt.part && attempt.destination);
      if (possibleSend) await delivery.send(attempt.destination, attempt.part);
      const calls = bot.sends.length;
      await sql`update radar.job_tasks set lease_until=clock_timestamp()-interval '1 second' where id=${crashed.id}`;
      await sendOne();
      ok(
        (await sql`select state from radar.notification_attempts where task_id=${crashed.id}`)[0]
              .state === "uncertain" && bot.sends.length === calls,
        possibleSend
          ? "crash after possible send quarantines attempt"
          : "crash after attempt creation quarantines attempt",
      );
    }
    const status = await command("status");
    ok(
      status.parts.some((p) => p.text.includes("Uncertain deliveries:")) &&
        !status.parts.some((p) => p.text.includes(key)),
      "status exposes uncertainty without credential text",
    );
    const original = await messageFixture("status", String(updateId));
    const sendsBefore = bot.sends.length;
    await ingress(original);
    await drain();
    ok(bot.sends.length === sendsBefore, "command replay after uncertain outcomes creates no send");
    await command("help", false);
    bot.scenario = "forbidden";
    await sendOne();
    ok(
      !(await sql`select enabled from radar.delivery_targets where id=${targetId}`)[0].enabled,
      "forbidden destination is disabled durably",
    );
    for (const role of ["anon", "authenticated"]) {
      let denied = false;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select public.rr_execute_interaction(${crypto.randomUUID()},${crypto.randomUUID()},1)`;
        });
      } catch (e) {
        denied = (e as { code?: string }).code === "42501";
      }
      ok(denied, `${role} cannot execute private interaction RPC`);
    }
    ok(bot.acknowledgements >= 10, "supported callbacks acknowledged through mock API");
    await rejects(() => store.execute({ ...leaseLike(), id: crypto.randomUUID() }), "lease_stale");
    ok(true, "unowned interaction fence denied through actual HTTP");
    assert(
      await conferenceInputHash() === inputHash,
      "Telegram inputs unchanged during hosted verification",
    );
  } catch (error) {
    if (error instanceof TestAssertionError) console.error(`Telegram assertion: ${error.message}`);
    if (error instanceof ProcessingError) console.error(`Telegram error: ${error.code}`);
    throw error;
  } finally {
    const profiles = [profileId, otherProfile];
    await sql.begin(async (tx) => {
      await tx`delete from radar.notification_attempts where notification_id in(select id from radar.notifications where profile_id=any(${profiles}::uuid[]))`;
      await tx`delete from radar.notification_items where profile_id=any(${profiles}::uuid[])`;
      await tx`delete from radar.job_tasks where payload->>'profile_id'=any(${profiles}::text[]) or telegram_bot_id=${syntheticBot} and telegram_update_id in(select update_id from radar.telegram_updates where profile_id=any(${profiles}::uuid[])) or kind='send_notification' and payload->>'notification_id' in(select id::text from radar.notifications where profile_id=any(${profiles}::uuid[])) or collection_run_id in(select id from radar.collection_runs where source_id=${sourceId})`;
      await tx`delete from radar.notifications where profile_id=any(${profiles}::uuid[])`;
      await tx`delete from radar.telegram_updates where profile_id=any(${profiles}::uuid[])`;
      await tx`delete from radar.user_feedback where profile_id=any(${profiles}::uuid[])`;
      await tx`delete from radar.user_opportunity_state where profile_id=any(${profiles}::uuid[])`;
      await tx`delete from radar.opportunity_assessments where profile_id=any(${profiles}::uuid[])`;
      await tx`delete from radar.delivery_targets where profile_id=any(${profiles}::uuid[])`;
      await tx`delete from radar.research_profiles where id=any(${profiles}::uuid[])`;
      await tx`delete from radar.opportunity_deadlines where opportunity_id=any(${ids}::uuid[])`;
      await tx`delete from radar.opportunities where id=any(${ids}::uuid[])`;
      await tx`delete from radar.collection_runs where source_id=${sourceId}`;
      await tx`delete from radar.sources where id=${sourceId}`;
      for (const pause of pauses) {
        await tx`update radar.system_settings set value=${
          tx.json(pause.value)
        } where key=${pause.key}`;
      }
    });
    const [remaining] =
      await sql`select exists(select 1 from radar.research_profiles where id=any(${profiles}::uuid[])) or exists(select 1 from radar.opportunities where id=any(${ids}::uuid[])) as found`;
    assert(!remaining.found, "Telegram scoped cleanup");
    console.log("PASS: Telegram scoped cleanup; both pause flags restored.");
  }
  await Deno.writeTextFile(
    "private/phase07-telegram.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        targetClass: target.targetClass,
        projectRef: target.projectRef,
        inputHash,
        assertions: passed,
        cleanup: true,
        mockBotApi: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${passed.length} hosted Telegram assertions using real RPC persistence and mocked Bot API.`,
  );
}
function leaseLike(): Lease {
  return {
    id: "",
    owner: crypto.randomUUID(),
    generation: 1,
    kind: "telegram_command",
    attempt: 1,
    leaseUntil: new Date(Date.now() + 90000).toISOString(),
    runId: null,
  };
}
