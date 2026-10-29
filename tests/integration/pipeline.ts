// Admin SQL is fixture setup/assertion/cleanup only. All application paths use the actual
// Supabase-js repository over HTTPS and the deployed narrow RPC contracts.
import type postgres from "postgres";
import { assert, equals, fixture, rejects, TestAssertionError } from "../support.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { FakeSourceAdapter } from "../../supabase/functions/_shared/adapters/sources/fake/adapter.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import { runWorker } from "../../supabase/functions/_shared/application/worker.ts";
import {
  ProcessingError,
  type Repository,
  type SourceAdapter,
} from "../../supabase/functions/_shared/application/ports.ts";
import { StructuredLogger } from "../../supabase/functions/_shared/infrastructure/observability/logging.ts";
import { digest } from "../../supabase/functions/_shared/domain/primitives.ts";
import type { ObjectValue } from "../../supabase/functions/_shared/domain/model.ts";

async function inputHash(): Promise<string> {
  const root = new URL("../../", import.meta.url);
  const paths = ["deno.json", "deno.lock"];
  async function walk(path: string) {
    for await (const entry of Deno.readDir(new URL(path, root))) {
      const next = `${path}${entry.name}`;
      if (entry.isDirectory) await walk(`${next}/`);
      else if (/\.(ts|json|sql)$/.test(next)) paths.push(next);
    }
  }
  for (
    const path of [
      "supabase/functions/",
      "supabase/migrations/",
      "supabase/tests/database/",
      "tests/",
    ]
  ) await walk(path);
  return await digest(
    await Promise.all(
      paths.sort().map(async (
        path,
      ) => [path, (await Deno.readTextFile(new URL(path, root))).replaceAll("\r\n", "\n")]),
    ),
  );
}

export async function verifyPipeline(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
) {
  const verifiedInput = await inputHash();
  const negativeResponses: { status: number; code: string }[] = [];
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target.projectRef}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) {
    throw new Error("Cannot read existing backend key securely; hosted integration did not run.");
  }
  const keys = await response.json() as { name?: string; type?: string; api_key?: string }[];
  const backendKey = keys.find((k) => k.name === "service_role")?.api_key ??
    keys.find((k) => k.type === "secret")?.api_key;
  if (!backendKey) throw new Error("No existing backend key available; do not invent or log one.");
  const transport: typeof fetch = async (input, init) => {
    let result: Response;
    try {
      result = await fetch(input, init);
    } catch {
      console.error(
        JSON.stringify({
          negativeRpcTransport: "fetch_failed",
          aborted: init?.signal?.aborted === true,
        }),
      );
      throw new ProcessingError("backend_transport_failed", true);
    }
    if (!result.ok) {
      const body = await result.clone().json().catch(() => ({}));
      const state = typeof body.code === "string" && /^[0-9A-Z]{5}$/.test(body.code)
        ? body.code
        : "non_sql_error";
      console.log(JSON.stringify({ negativeRpcStatus: result.status, sqlstate: state }));
      negativeResponses.push({ status: result.status, code: state });
    }
    return result;
  };
  const repository = new SupabaseRepository(
    persistenceClient(`https://${target.projectRef}.supabase.co`, backendKey, transport),
  );
  const scope = crypto.randomUUID().replaceAll("-", ""),
    sources: string[] = [],
    profile = crypto.randomUUID();
  const adapters = new Map<string, SourceAdapter>(), logs: string[] = [];
  const clock = { now: () => new Date().toISOString() }, signal = new AbortController().signal;
  const dependencies = (repo: Repository = repository) => ({
    repository: repo,
    adapters,
    clock,
    http: {
      request: () => {
        throw new Error("External HTTP is forbidden in hosted fake-source integration.");
      },
    },
    logger: new StructuredLogger((entry) => logs.push(entry)),
  });
  const passed: string[] = [];
  const ok = (condition: unknown, name: string) => {
    assert(condition, name);
    passed.push(name);
    console.log(`PASS: pipeline ${name}`);
  };
  const pause = await sql`select value from radar.system_settings where key='collection_paused'`;
  async function source(body: string, extra: ObjectValue = {}) {
    const id = crypto.randomUUID(), slug = `fake-${scope.slice(0, 16)}-${sources.length}`;
    sources.push(id);
    adapters.set(slug, new FakeSourceAdapter(slug));
    await sql`insert into radar.sources(id,slug,name,category,enabled,approved_at,adapter_version,config)
      values(${id},${slug},'Synthetic Phase 03 fixture','fixture',true,now(),'fake-json-v1',${
      sql.json({ pages: [body], revision: "v1", ...extra })
    })`;
    return id;
  }
  async function start(id: string) {
    const run = await repository.createRun(id, `p03:${scope}:${crypto.randomUUID()}`, "test");
    const lease = await repository.claim(crypto.randomUUID(), ["collect_page"]);
    assert(lease && lease.runId === run, "expected scoped collection claim");
    return { run, lease };
  }
  async function drain() {
    return await runWorker(dependencies(), { owner: crypto.randomUUID(), maxTasks: 5 });
  }
  const document = (...items: Record<string, unknown>[]) =>
    JSON.stringify({ schema_version: 1, items });
  const item = (id: string, overrides = {}) => ({
    id,
    category: "phd",
    heading: `Synthetic position ${id}`,
    provider: "Example University",
    link: `https://positions.example.invalid/${id}`,
    edition: "2031",
    track: "main",
    subjects: ["AI"],
    state: "open",
    ...overrides,
  });
  const counters = async (id: string) =>
    (await sql`select status,records_seen::integer,accepted::integer,inserted::integer,updated::integer,duplicates::integer,rejected::integer,page_sequence::integer,pages_committed,cursor from radar.collection_runs where id=${id}`)[
      0
    ];
  const wrap = (overrides: Partial<Repository>): Repository =>
    new Proxy(repository, {
      get(target, name) {
        const replacement = overrides[name as keyof Repository];
        if (replacement) return replacement;
        const value = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  try {
    await sql`update radar.system_settings set value='{"enabled":false}' where key='collection_paused'`;
    await sql`insert into radar.research_profiles(id,display_name,enabled,timezone,rules) values(${profile},'Temporary synthetic pipeline profile',true,'UTC','{"positive_topics":["AI","Machine Learning"],"type_weights":{"phd":1}}')`;
    const allSource = await source(await fixture("all-types.json")), all = await start(allSource);
    const allResult = await collect(all.lease, dependencies(), signal);
    ok(
      allResult.inserted === 11 && allResult.rejected === 0,
      "all eleven types persist through real RPC mapping",
    );
    await drain();
    const [{ count: assessments }] =
      await sql`select count(*)::integer as count from radar.opportunity_assessments where profile_id=${profile}`;
    ok(assessments === 11, "atomic assessment handoff executes and stores versioned reasons");
    const [{ count: provenanceCount }] =
      await sql`select count(*)::integer as count from radar.opportunities o join radar.source_records r on r.opportunity_id=o.id where r.source_id=${allSource} and o.field_provenance->'title'->>'source_record_id'=r.id::text`;
    ok(
      provenanceCount === 11,
      "canonical field provenance resolves actual source observation UUIDs",
    );
    const initial = await counters(all.run);
    const replay = await collect(all.lease, dependencies(), signal);
    equals(await counters(all.run), initial, "replay preserves all page counters/cursor");
    const [{ records, opportunities, tasks }] =
      await sql`select (select count(*)::integer from radar.source_records where source_id=${allSource}) as records,
      (select count(distinct opportunity_id)::integer from radar.source_records where source_id=${allSource}) as opportunities,
      (select count(*)::integer from radar.job_tasks where request_key like ${`assess:${all.run}:%`}) as tasks`;
    ok(
      replay.replayed && records === 11 && opportunities === 11 && tasks === 1,
      "page replay has no duplicate opportunities observations counters or completion effects",
    );
    const notModified = await start(allSource);
    const nm = await collect(notModified.lease, dependencies(), signal);
    ok(
      nm.inserted === 0 && (await counters(notModified.run)).records_seen === 0,
      "conditional not-modified is distinct from empty collection",
    );

    await sql`update radar.sources set config_version=config_version+1 where id=${allSource}`;
    const newConfig = await start(allSource);
    const newConfigResult = await collect(newConfig.lease, dependencies(), signal);
    ok(
      newConfigResult.duplicates === 11 && (await counters(newConfig.run)).records_seen === 11,
      "config change refetches complete data even when source ETag is reused",
    );
    await drain();

    const interruptedBody = document(item("interrupted-first"));
    const interruptedSource = await source(interruptedBody, {
      pages: [interruptedBody, '{"shape_changed":true}'],
    });
    const interrupted = await start(interruptedSource);
    await collect(interrupted.lease, dependencies(), signal);
    await drain();
    const afterInterruption = await start(interruptedSource);
    const resumedContext = await repository.collection(afterInterruption.lease);
    const resumedPage = await collect(afterInterruption.lease, dependencies(), signal);
    ok(
      Object.keys(resumedContext.validators).length === 0 && resumedPage.duplicates === 1 &&
        (await counters(afterInterruption.run)).cursor !== null,
      "incomplete snapshot cannot return false not-modified and lose continuation work",
    );
    await drain();

    const mixedSource = await source(await fixture("mixed.json")), mixed = await start(mixedSource);
    const partial = await collect(mixed.lease, dependencies(), signal),
      counts = await counters(mixed.run);
    const observed =
      await sql`select record_status,error_code from radar.source_records where source_id=${mixedSource} order by source_record_key`;
    ok(
      partial.inserted === 2 && partial.rejected === 1 && counts.records_seen === 3 &&
        counts.accepted === 2 && counts.status === "partial" && observed.filter((r) =>
            r.record_status === "quarantined"
          ).length === 1,
      "valid A malformed B valid C commit together with explicit rejection and distinct-key accounting",
    );
    await drain();

    const changing = {
      ...item("mutable"),
      calls: [{ kind: "application", round: "main", label: "Apply", value: "2031-03-01" }],
    };

    const evidenceItem = item("evidence-race", { reviewed_listing: true });
    const evidenceBase = await source(document(evidenceItem)),
      evidenceInitial = await start(evidenceBase);
    await collect(evidenceInitial.lease, dependencies(), signal);
    await drain();
    const evidenceOfficial = await source(document(evidenceItem), {
      field_authority: { title: 100 },
    });
    const evidenceWeak = await source(
      document({ ...evidenceItem, heading: "Weaker racing title" }),
    );
    const officialLease = await start(evidenceOfficial), weakLease = await start(evidenceWeak);
    let oldRead!: () => void, releaseWeak!: () => void, weakReads = 0;
    const oldReadReady = new Promise<void>((resolve) => oldRead = resolve);
    const officialCommitted = new Promise<void>((resolve) => releaseWeak = resolve);
    const boundedBarrier = async (value: Promise<void>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          value,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new TestAssertionError("provenance race barrier timed out")),
              15000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const weakRepository = wrap({
      candidates: async (...args) => {
        const result = await repository.candidates(...args);
        if (++weakReads === 1) {
          oldRead();
          await boundedBarrier(officialCommitted);
        }
        return result;
      },
    });
    const beforeEvidence =
      (await sql`select o.content_revision from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id where r.source_id=${evidenceBase}`)[
        0
      ].content_revision;
    const weakWork = collect(weakLease.lease, dependencies(weakRepository), signal);
    // Both branches settle before cleanup even when a negative assertion fails.
    const strongWork = (async () => {
      try {
        await boundedBarrier(oldReadReady);
        await collect(officialLease.lease, dependencies(), signal);
      } finally {
        releaseWeak();
      }
    })();
    const evidenceOutcomes = await Promise.allSettled([weakWork, strongWork]);
    assert(
      evidenceOutcomes.every((r) => r.status === "fulfilled"),
      "both provenance-race workers settle",
    );
    const [evidenceAfter] =
      await sql`select o.title,o.content_revision,o.field_provenance->'title'->>'source_record_id' as origin,r.id::text as official from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id where r.source_id=${evidenceOfficial}`;
    ok(
      weakReads === 2 && evidenceAfter.title === evidenceItem.heading &&
        evidenceAfter.origin === evidenceAfter.official &&
        evidenceAfter.content_revision === beforeEvidence,
      "provenance CAS rejects stale weak overwrite while unchanged content revision stays stable",
    );
    await drain();

    const pageOne = document(item("page-one")), pageTwo = document(item("page-two"));
    const pagedSource = await source(pageOne, { pages: [pageOne, pageTwo] }),
      paged = await start(pagedSource);
    await collect(paged.lease, dependencies(), signal);
    const checkpoint = await counters(paged.run);
    ok(
      checkpoint.status === "running" && checkpoint.pages_committed === 1 &&
        checkpoint.records_seen === 1 && checkpoint.cursor !== null,
      "bounded page commits cursor with durable continuation before next page",
    );
    await drain();
    const finishedPages = await counters(paged.run);
    ok(
      finishedPages.status === "succeeded" && finishedPages.pages_committed === 2 &&
        finishedPages.records_seen === 2 && finishedPages.cursor === null,
      "continuation resumes returned cursor and completes next bounded page once",
    );

    const authoritative = item("authority", {
      reviewed_listing: true,
      summary: "Reviewed evidence",
    });
    const official = await source(document(authoritative), {
        field_authority: { title: 100, organization: 100, description: 100 },
      }),
      officialRun = await start(official);
    await collect(officialRun.lease, dependencies(), signal);
    await drain();
    const weaker = await source(
        document({
          ...authoritative,
          heading: "Weaker alternative title",
          provider: null,
          summary: null,
        }),
      ),
      weakerRun = await start(weaker);
    await collect(weakerRun.lease, dependencies(), signal);
    await drain();
    const [authorityRow] =
      await sql`select o.title,o.organization,o.description,o.field_provenance->'title'->>'source_record_id' as origin,r.id::text as original from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id where r.source_id=${official}`;
    ok(
      authorityRow.title === authoritative.heading &&
        authorityRow.organization === "Example University" &&
        authorityRow.description === "Reviewed evidence" &&
        authorityRow.origin === authorityRow.original,
      "reviewed field authority preserves stronger non-null facts and their source provenance",
    );
    const mutableSource = await source(document(changing)), mutable = await start(mutableSource);
    await collect(mutable.lease, dependencies(), signal);
    await drain();
    const [before] =
      await sql`select o.id,o.fingerprint,o.content_revision,d.revision from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id join radar.opportunity_deadlines d on d.opportunity_id=o.id where r.source_id=${mutableSource}`;
    changing.calls[0].value = "2031-03-08";
    await sql`update radar.sources set config=${
      sql.json({ pages: [document(changing)], revision: "v2" })
    },config_version=config_version+1 where id=${mutableSource}`;
    const changed = await start(mutableSource);
    await collect(changed.lease, dependencies(), signal);
    await drain();
    const [after] =
      await sql`select o.id,o.fingerprint,o.content_revision,d.revision,d.due_date::text from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id join radar.opportunity_deadlines d on d.opportunity_id=o.id where r.source_id=${mutableSource}`;
    ok(
      before.id === after.id && before.fingerprint === after.fingerprint &&
        Number(after.content_revision) > Number(before.content_revision) &&
        after.revision === before.revision + 1 && after.due_date === "2031-03-08",
      "deadline correction revises evidence without changing stable identity",
    );

    // Barrier after both workers read their pre-commit candidates ensures actual overlapping claims.
    const concurrentBody = document(item("convergent", { reviewed_listing: true }));
    const left = await source(concurrentBody), right = await source(concurrentBody);
    const a = await start(left), b = await start(right);
    let arrivals = 0, release!: () => void;
    const barrier = new Promise<void>((resolve) => release = resolve);
    const concurrentRepo = wrap({
      candidates: async (...args) => {
        const result = await repository.candidates(...args);
        if (++arrivals <= 2) {
          if (arrivals === 2) release();
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              barrier,
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                  () => reject(new TestAssertionError("concurrent candidate barrier timed out")),
                  15000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timeout);
          }
        }
        return result;
      },
    });
    const concurrentResults = await Promise.allSettled([
      collect(a.lease, dependencies(concurrentRepo), signal),
      collect(b.lease, dependencies(concurrentRepo), signal),
    ]);
    assert(
      concurrentResults.every((r) => r.status === "fulfilled"),
      "both concurrent workers settle before scoped cleanup",
    );
    const [{ identities }] =
      await sql`select count(distinct opportunity_id)::integer as identities from radar.source_records where source_id=any(${[
        left,
        right,
      ]}::uuid[])`;
    ok(
      identities === 1 && (await counters(a.run)).records_seen === 1 &&
        (await counters(b.run)).records_seen === 1,
      "concurrent HTTP workers converge on one strong canonical identity",
    );
    await drain();
    const claimSource = await source(document(item("single-claim")));
    const requestKey = `p03:${scope}:coalesced`;
    const runs = await Promise.all([
      repository.createRun(claimSource, requestKey, "test"),
      repository.createRun(claimSource, requestKey, "test"),
    ]);
    equals(runs[0], runs[1]);
    const claims = await Promise.all([
      repository.claim(crypto.randomUUID(), ["collect_page"]),
      repository.claim(crypto.randomUUID(), ["collect_page"]),
    ]);
    ok(
      claims.filter(Boolean).length === 1,
      "duplicate task requests and concurrent SKIP LOCKED claims produce one owner",
    );
    await collect(claims.find(Boolean)!, dependencies(), signal);
    await drain();

    const weak = document(item("weak", { provider: null, edition: null, track: null }));
    const weakA = await source(weak), weakB = await source(weak);
    const wa = await start(weakA);
    await collect(wa.lease, dependencies(), signal);
    await drain();
    const wb = await start(weakB);
    await collect(wb.lease, dependencies(), signal);
    await drain();
    const [{ separate, flagged }] =
      await sql`select count(distinct o.id)::integer as separate,bool_or(o.quality_flags @> array['conflicting_identity_candidate']) as flagged from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id where r.source_id=any(${[
        weakA,
        weakB,
      ]}::uuid[])`;
    ok(
      separate === 2 && flagged,
      "unknown-organization fingerprint candidates remain separate and flagged",
    );
    const ownerBodyA = document(item("owner-a", { reviewed_listing: true })),
      ownerBodyB = document(item("owner-b", { reviewed_listing: true }));
    const ownerA = await source(ownerBodyA), ownerB = await source(ownerBodyB);
    const oa = await start(ownerA);
    await collect(oa.lease, dependencies(), signal);
    await drain();
    const ob = await start(ownerB);
    await collect(ob.lease, dependencies(), signal);
    await drain();
    const conflictSource = await source(
        document(
          item("owner-a", {
            link: "https://positions.example.invalid/owner-b",
            reviewed_listing: true,
          }),
        ),
      ),
      conflict = await start(conflictSource);
    const cr = await collect(conflict.lease, dependencies(), signal);
    const [conflictRecord] =
      await sql`select record_status,error_code,opportunity_id from radar.source_records where source_id=${conflictSource}`;
    ok(
      cr.rejected === 1 && conflictRecord.record_status === "conflict" &&
        conflictRecord.opportunity_id === null,
      "two existing strong identities quarantine conflict without arbitrary merge",
    );

    const rollbackSource = await source(
        document(item("new-before-failure"), {
          ...changing,
          id: "rollback-update",
          heading: changing.heading,
          summary: "Updated canonical evidence",
        }),
      ),
      rollback = await start(rollbackSource);
    let commits = 0, verifiedRollback = false;
    const rollbackResponsesStart = negativeResponses.length;
    const failureRepo = wrap({
      commit: async (lease, context, page, records, abort) => {
        if (++commits === 1) {
          const altered = records.map((record, index) =>
            index === 1 ? { ...record, expectedRevision: 0 } : record
          );
          try {
            return await repository.commit(lease, context, page, altered, abort);
          } catch (error) {
            if (!(error instanceof ProcessingError) || error.code !== "reconciliation_stale") {
              console.error(
                `Controlled failure classification: ${
                  error instanceof ProcessingError ? error.code : "non_application_error"
                }`,
              );
            }
            assert(
              error instanceof ProcessingError && error.code === "reconciliation_stale",
              "injected late failure must be serialization rejection",
            );
            const [{ count }] =
              await sql`select count(*)::integer as count from radar.source_records where source_id=${rollbackSource}`;
            const [{ orphan }] =
              await sql`select count(*)::integer as orphan from radar.opportunities where title='Synthetic position new-before-failure'`;
            verifiedRollback = count === 0 && orphan === 0 &&
              (await counters(rollback.run)).page_sequence === 0;
            throw error;
          }
        }
        return await repository.commit(lease, context, page, records, abort);
      },
    });
    const rr = await collect(rollback.lease, dependencies(failureRepo), signal);
    ok(
      verifiedRollback && commits === 2 && rr.inserted === 1 && rr.updated === 1 &&
        negativeResponses.slice(rollbackResponsesStart).some((r) =>
          r.status === 409 && r.code === "PT409"
        ),
      "late transactional failure leaves no orphan or cursor advance and re-read retry succeeds",
    );
    await drain();

    const crashSource = await source(document(item("crash-before-commit"))),
      crash = await start(crashSource);
    await rejects(() =>
      collect(
        crash.lease,
        dependencies(wrap({
          commit: () => {
            throw new ProcessingError("transport_timeout", true);
          },
        })),
        signal,
      ), "transport_timeout");
    ok(
      (await counters(crash.run)).page_sequence === 0,
      "crash before commit leaves cursor and accounting untouched",
    );
    await repository.finish(crash.lease, "retry", "transport_timeout", 1);
    await sql`update radar.job_tasks set available_at=clock_timestamp() where id=${crash.lease.id}`;
    const resumed = await repository.claim(crypto.randomUUID(), ["collect_page"]);
    assert(resumed && resumed.id === crash.lease.id && resumed.generation > crash.lease.generation);
    await rejects(() => repository.renew(crash.lease), "lease_stale");
    await collect(resumed, dependencies(), signal);
    await drain();
    ok(
      (await counters(crash.run)).records_seen === 1,
      "retry reclaims same task with newer fence and no double effects",
    );

    const expirySource = await source(document(item("expired-lease")));
    const expiryRun = await repository.createRun(expirySource, `p03:${scope}:expiry`, "test");
    const expired = await repository.claim(crypto.randomUUID(), ["collect_page"], undefined, 1);
    assert(expired && expired.runId === expiryRun);
    const oldContext = await repository.collection(expired);
    const fake = adapters.get(oldContext.source.slug)!;
    const oldPage = await fake.collectPage(
      {
        ...dependencies(),
        source: oldContext.source,
        signal,
        limits: { timeoutMs: 15000, maxBytes: 2097152, maxRecords: 100 },
      },
      null,
      {},
    );
    await sql`select pg_sleep(1.2)`;
    const newer = await repository.claim(crypto.randomUUID(), ["collect_page"]);
    assert(newer && newer.id === expired.id && newer.generation > expired.generation);
    await rejects(() => repository.commit(expired, oldContext, oldPage, []), "lease_stale");
    ok(
      (await counters(expiryRun)).page_sequence === 0,
      "expired reclaimed lease rejects old worker commit",
    );
    await collect(newer, dependencies(), signal);
    await drain();

    const disabledSource = await source(document(item("disabled-during-page"))),
      disabled = await start(disabledSource);
    const disableRepo = wrap({
      commit: async (...args) => {
        await sql`update radar.sources set enabled=false where id=${disabledSource}`;
        return await repository.commit(...args);
      },
    });
    await rejects(
      () => collect(disabled.lease, dependencies(disableRepo), signal),
      "source_disabled",
    );
    await repository.finish(disabled.lease, "canceled", "source_disabled", 1);
    const [health] =
      await sql`select consecutive_failures from radar.sources where id=${disabledSource}`;
    ok(
      (await counters(disabled.run)).status === "canceled" &&
        (await counters(disabled.run)).records_seen === 0 && health.consecutive_failures === 0,
      "source disable during page prevents commit without damaging health",
    );

    const malformedSource = await source('{"new_shape":[]}');
    await repository.createRun(malformedSource, `p03:${scope}:malformed`, "test");
    const healthySource = await source(document(item("healthy-sibling-source")));
    await repository.createRun(healthySource, `p03:${scope}:healthy`, "test");
    const worker = await drain();
    const [malformedRun] =
      await sql`select status,pages_committed from radar.collection_runs where source_id=${malformedSource}`;
    const [{ healthy }] =
      await sql`select count(*)::integer as healthy from radar.source_records where source_id=${healthySource}`;
    ok(
      worker.failed === 1 && healthy === 1 && malformedRun.status === "failed" &&
        malformedRun.pages_committed === 0,
      "document failure is visible and another source continues in bounded worker",
    );
    ok(
      logs.length > 10 && logs.every((entry) =>
        !entry.includes(backendKey) && !entry.includes(token) && !entry.includes("raw") &&
        !entry.includes("pages")
      ),
      "structured application logs contain identifiers counts and sanitized codes only",
    );
  } catch (error) {
    if (error instanceof TestAssertionError) console.error(`Assertion failed: ${error.message}`);
    else if (error instanceof ProcessingError) console.error(`Application failure: ${error.code}`);
    throw error;
  } finally {
    await sql.begin(async (tx) => {
      const opportunities =
        (await tx`select distinct opportunity_id from radar.source_records where source_id=any(${sources}::uuid[]) and opportunity_id is not null`)
          .map((row) => String(row.opportunity_id));
      await tx`delete from radar.job_tasks where collection_run_id in(select id from radar.collection_runs where source_id=any(${sources}::uuid[])) or payload->>'profile_id'=${profile}`;
      await tx`delete from radar.opportunity_assessments where profile_id=${profile}`;
      await tx`delete from radar.opportunity_deadlines where opportunity_id=any(${opportunities}::uuid[])`;
      await tx`delete from radar.opportunity_identities where opportunity_id=any(${opportunities}::uuid[])`;
      await tx`delete from radar.source_records where source_id=any(${sources}::uuid[])`;
      await tx`delete from radar.collection_runs where source_id=any(${sources}::uuid[])`;
      await tx`delete from radar.opportunities where id=any(${opportunities}::uuid[])`;
      await tx`delete from radar.research_profiles where id=${profile}`;
      await tx`delete from radar.sources where id=any(${sources}::uuid[])`;
      await tx`update radar.system_settings set value=${
        tx.json(pause[0].value)
      } where key='collection_paused'`;
    });
    console.log("PASS: Phase 03 scoped fixtures removed; collection pause restored.");
  }
  assert(verifiedInput === await inputHash(), "pipeline inputs changed during hosted verification");
  await Deno.writeTextFile(
    "private/phase03-verification.json",
    JSON.stringify(
      {
        projectRef: target.projectRef,
        targetClass: target.targetClass ?? "verified_isolated",
        verifiedAt: new Date().toISOString(),
        assertions: passed,
        inputHash: verifiedInput,
        assertionsHash: await digest(passed),
        deno: Deno.version.deno,
      },
      null,
      2,
    ),
  );
  console.log(`PASS: hosted pipeline integration (${passed.length} named assertions).`);
}
