// Guarded operator fixture setup/assertions/cleanup; application writes use real narrow HTTPS RPCs.
import type postgres from "postgres";
import { assert, equals, rejects, TestAssertionError } from "../support.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";
import { bytes } from "../../supabase/functions/_shared/domain/primitives.ts";
import { document, fixture } from "../ccfddl_support.ts";
import { CcfddlAdapter } from "../../supabase/functions/_shared/adapters/sources/ccfddl/adapter.ts";
import { ccfddlManifest } from "../../supabase/functions/_shared/adapters/sources/ccfddl/manifest.ts";
import { FakeSourceAdapter } from "../../supabase/functions/_shared/adapters/sources/fake/adapter.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import {
  ProcessingError,
  type SourceAdapter,
} from "../../supabase/functions/_shared/application/ports.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import { StructuredLogger } from "../../supabase/functions/_shared/infrastructure/observability/logging.ts";
import { digest } from "../../supabase/functions/_shared/domain/primitives.ts";

export async function verifyConferences(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
  live = false,
) {
  const inputHash = await conferenceInputHash();
  const upstreamPages: { bytes: number; revision: string | null; notModified: boolean }[] = [];
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
  const repository = new SupabaseRepository(
    persistenceClient(`https://${target.projectRef}.supabase.co`, key),
  );
  const scope = crypto.randomUUID(), sources: string[] = [], passed: string[] = [];
  const clock = { now: () => new Date().toISOString() }, signal = new AbortController().signal;
  let payload = await fixture(), unchanged = false, fetched = 0;
  const upstream: typeof fetch = (_input, init) => {
    fetched++;
    const conditional = new Headers(init?.headers).has("if-none-match");
    return Promise.resolve(
      new Response(unchanged && conditional ? null : payload, {
        status: unchanged && conditional ? 304 : 200,
        headers: { "content-type": "text/plain; charset=utf-8", etag: '"fixture-current"' },
      }),
    );
  };
  const http = new BoundedHttpClient([ccfddlManifest.endpoint], live ? fetch : upstream);
  const adapter = new CcfddlAdapter(), originalCollect = adapter.collectPage.bind(adapter);
  adapter.collectPage = async (...args) => {
    const page = await originalCollect(...args);
    upstreamPages.push({
      bytes: bytes(page.payload),
      revision: page.sourceRevision,
      notModified: page.notModified,
    });
    return page;
  };
  const adapters = new Map<string, SourceAdapter>([["ccfddl", adapter]]);
  const dependencies = { repository, adapters, http, clock, logger: new StructuredLogger() };
  const [pause] = await sql`select value from radar.system_settings where key='collection_paused'`;
  const ok = (condition: unknown, label: string) => {
    assert(condition, label);
    passed.push(label);
    console.log(`PASS: conferences ${label}`);
  };
  const addSource = async (slug: string, parserVersion: string, config = {}) => {
    const id = crypto.randomUUID();
    sources.push(id);
    await sql`insert into radar.sources(id,slug,name,category,adapter_version,enabled,approved_at,config) values(${id},${slug},'Phase 04 scoped verification','conference-test',${parserVersion},true,clock_timestamp(),${
      sql.json(config)
    })`;
    return id;
  };
  const start = async (id: string) => {
    const run = await repository.createRun(id, `p04:${scope}:${crypto.randomUUID()}`, "test");
    const lease = await repository.claim(crypto.randomUUID(), ["collect_page"]);
    assert(lease?.runId === run, "claim must belong to test run");
    return { run, lease };
  };
  const run = async (id: string) => {
    const work = await start(id);
    return { ...work, result: await collect(work.lease, dependencies, signal) };
  };
  const counts = async (source: string) =>
    (await sql`select count(*)::integer as records,count(distinct opportunity_id)::integer as canonicals from radar.source_records where source_id=${source}`)[
      0
    ];
  const latest = async (source: string) =>
    (await sql`select o.id,o.content_revision, o.event_end::text,d.id as deadline_id,d.revision,d.due_date::text,r.id as record_id,r.normalized_snapshot,r.metadata,r.source_revision,o.field_provenance from radar.opportunities o join radar.source_records r on r.opportunity_id=o.id join radar.opportunity_deadlines d on d.opportunity_id=o.id where r.source_id=${source} and o.cycle_key='2027' and d.kind='submission' and d.round_key='round-4'`)[
      0
    ];
  let initialCounts: unknown;
  try {
    await sql`update radar.system_settings set value='{"enabled":false}' where key='collection_paused'`;
    const id = await addSource("ccfddl", ccfddlManifest.parserVersion);
    const first = await run(id);
    ok(
      first.result.inserted === 7 && first.result.rejected === 0,
      "seven real-source editions persist without bypassing the pipeline",
    );
    initialCounts = await counts(id);
    equals(initialCounts, { records: 7, canonicals: 7 });
    const [stats] =
      await sql`select records_seen::integer,accepted::integer,rejected::integer,pages_committed,page_sequence::integer,status from radar.collection_runs where id=${first.run}`;
    ok(
      stats.records_seen === 7 && stats.accepted === 7 && stats.rejected === 0 &&
        stats.pages_committed === 1 && stats.page_sequence === 1 && stats.status === "succeeded",
      "durable page accounting and terminal cursor agree",
    );
    const [{ deadlines }] =
      await sql`select count(*)::integer as deadlines from radar.opportunity_deadlines d join radar.source_records r on r.opportunity_id=d.opportunity_id where r.source_id=${id}`;
    ok(deadlines === 43, "all 43 abstract submission rebuttal decision rounds persist");
    const before = await latest(id);
    ok(
      before.field_provenance.title.source_record_id === before.record_id &&
        before.source_revision === before.metadata.source_revision &&
        before.normalized_snapshot.deadline_evidence.length === 16,
      "actual observation IDs content revision and original clock evidence remain traceable",
    );
    const calls = fetched;
    ok(
      (await collect(first.lease, dependencies, signal)).replayed && fetched === calls,
      "task replay performs no upstream IO or duplicate completion effects",
    );
    equals(await counts(id), initialCounts);
    if (!live) {
      const repeated = await run(id);
      ok(
        repeated.result.duplicates === 7 && repeated.result.inserted === 0,
        "same payload in a new run creates no duplicate canonical or source records",
      );
      unchanged = true;
      const cached = await run(id);
      const [cacheStats] =
        await sql`select records_seen::integer,accepted::integer,pages_committed from radar.collection_runs where id=${cached.run}`;
      ok(
        cached.result.inserted === 0 && cacheStats.records_seen === 0 &&
          cacheStats.accepted === 0 && cacheStats.pages_committed === 1,
        "304 commits unchanged status with zero freshly parsed records",
      );
      unchanged = false;
      payload = payload.replace("2026-10-17 23:59:59", "2026-10-20 23:59:59");
      await run(id);
      const after = await latest(id);
      ok(
        after.id === before.id && after.deadline_id === before.deadline_id &&
          after.revision === before.revision + 1 && after.due_date === "2026-10-20" &&
          after.content_revision > before.content_revision,
        "changed deadline increments same logical round and canonical revision",
      );
      equals(await counts(id), initialCounts);
      const mixed = await document();
      (mixed[0].confs as Record<string, unknown>[])[1].link = 42;
      payload = JSON.stringify(mixed);
      const partial = await run(id);
      const [partialStats] =
        await sql`select status,records_seen::integer,accepted::integer,rejected::integer from radar.collection_runs where id=${partial.run}`;
      ok(
        partial.result.rejected === 1 && partialStats.records_seen === 7 &&
          partialStats.accepted === 6 && partialStats.rejected === 1 &&
          partialStats.status === "partial",
        "malformed middle edition quarantines while all six valid siblings commit",
      );
      payload = await fixture();
      await run(id);
      const secondSlug = `reviewed-${scope.slice(0, 12)}`;
      adapters.set(secondSlug, new FakeSourceAdapter(secondSlug));
      const second = await addSource(secondSlug, "fake-json-v1", {
        pages: [await fixture("second-source.json")],
        revision: "reviewed-v1",
        field_authority: { eventEnd: 60 },
      });
      const overlap = await run(second);
      const [overlapRow] =
        await sql`select opportunity_id from radar.source_records where source_id=${second}`;
      const [corrected] =
        await sql`select event_end::text,field_provenance from radar.opportunities where id=${before.id}`;
      ok(
        overlap.result.inserted === 0 && overlapRow.opportunity_id === before.id &&
          corrected.event_end === "2027-06-18" &&
          corrected.field_provenance.event_end.source_slug === secondSlug,
        "reviewed second-source fixture merges strong identity and higher-authority official event date",
      );
      // Invalid cursor state must fail atomically through the actual application repository.
      const broken = await start(id), context = await repository.collection(broken.lease);
      const collected = await adapters.get("ccfddl")!.collectPage(
        {
          ...dependencies,
          source: context.source,
          signal,
          limits: { maxBytes: 2097152, maxRecords: 100, timeoutMs: 15000 },
        },
        null,
        {},
      );
      await rejects(() =>
        repository.commit(broken.lease, { ...context, cursorHash: "0".repeat(64) }, collected, [])
      );
      const [rollback] =
        await sql`select pages_committed,records_seen::integer,page_sequence::integer from radar.collection_runs where id=${broken.run}`;
      ok(
        rollback.pages_committed === 0 && rollback.records_seen === 0 &&
          rollback.page_sequence === 0,
        "invalid cursor commit rolls back accounting and canonical work",
      );
      await collect(broken.lease, dependencies, signal);
      ok(true, "failed transaction retries safely through same task");
    } else {
      const again = await run(id);
      ok(
        again.result.inserted === 0 && again.result.rejected === 0,
        "bounded live replay is nonduplicating whether 200 or 304",
      );
      equals(await counts(id), initialCounts);
    }
    const [{ notifications }] =
      await sql`select count(*)::integer as notifications from radar.notifications`;
    ok(notifications === 0, "no notifications profiles or delivery side effects created");
    console.log(
      JSON.stringify({
        source: "ccfddl",
        mode: live ? "live" : "fixtures",
        ...initialCounts as object,
        deadlines,
        upstreamBytes: live ? "bounded by manifest" : 4016,
        verifiedAt: clock.now(),
      }),
    );
  } catch (error) {
    if (error instanceof TestAssertionError) console.error(error.message);
    if (error instanceof ProcessingError) console.error(`Conference error: ${error.code}`);
    throw error;
  } finally {
    await sql.begin(async (tx) => {
      const ids =
        (await tx`select distinct opportunity_id from radar.source_records where source_id=any(${sources}::uuid[]) and opportunity_id is not null`)
          .map((r) => String(r.opportunity_id));
      await tx`delete from radar.job_tasks where collection_run_id in(select id from radar.collection_runs where source_id=any(${sources}::uuid[]))`;
      await tx`delete from radar.opportunity_deadlines where opportunity_id=any(${ids}::uuid[])`;
      await tx`delete from radar.opportunity_identities where opportunity_id=any(${ids}::uuid[])`;
      await tx`delete from radar.source_records where source_id=any(${sources}::uuid[])`;
      await tx`delete from radar.collection_runs where source_id=any(${sources}::uuid[])`;
      await tx`delete from radar.opportunities where id=any(${ids}::uuid[])`;
      await tx`delete from radar.sources where id=any(${sources}::uuid[])`;
      await tx`update radar.system_settings set value=${
        tx.json(pause.value)
      } where key='collection_paused'`;
    });
    console.log("PASS: scoped Phase 04 cleanup; reference and migration state preserved.");
  }
  assert(
    inputHash === await conferenceInputHash(),
    "conference verification inputs changed during execution",
  );
  await Deno.writeTextFile(
    `private/phase04-${live ? "smoke" : "integration"}.json`,
    JSON.stringify(
      {
        projectRef: target.projectRef,
        targetClass: target.targetClass,
        verifiedAt: clock.now(),
        mode: live ? "live" : "fixtures",
        source: "ccfddl",
        inputHash,
        upstreamPages,
        assertions: passed,
        assertionsHash: await digest(passed),
        cleanup: true,
      },
      null,
      2,
    ),
  );
}
