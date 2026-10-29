import type postgres from "postgres";
import { assert, equals, TestAssertionError } from "../support.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import { ProcessingError } from "../../supabase/functions/_shared/application/ports.ts";
import {
  approvedEndpoints,
  approvedSources,
} from "../../supabase/functions/_shared/adapters/sources/registry.ts";
import { bathManifest } from "../../supabase/functions/_shared/adapters/sources/bath/manifest.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { StructuredLogger } from "../../supabase/functions/_shared/infrastructure/observability/logging.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";
import { bytes } from "../../supabase/functions/_shared/domain/primitives.ts";

export async function verifyPositions(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
  liveSlug?: string,
) {
  if (liveSlug && liveSlug !== bathManifest.slug) throw new ProcessingError("unapproved_source");
  const inputHash = await conferenceInputHash(),
    passed: string[] = [],
    pages: unknown[] = [],
    parseMs: number[] = [];
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
  const id = crypto.randomUUID(),
    clock = { now: () => new Date().toISOString() },
    signal = new AbortController().signal;
  const adapter = approvedSources().get(bathManifest.slug)!;
  let payload = await Deno.readTextFile("tests/fixtures/bath/research.xml");
  const transport: typeof fetch = () =>
    Promise.resolve(
      new Response(payload, {
        headers: { "content-type": "text/xml; charset=utf-8", etag: '"fixture"' },
      }),
    );
  const deps = {
    repository,
    adapters: new Map([[adapter.slug, adapter]]),
    http: new BoundedHttpClient(approvedEndpoints, liveSlug ? fetch : transport),
    clock,
    logger: new StructuredLogger(),
  };
  const get = adapter.collectPage.bind(adapter), parse = adapter.parsePage.bind(adapter);
  adapter.collectPage = async (...args) => {
    const p = await get(...args);
    pages.push({ bytes: bytes(p.payload), revision: p.sourceRevision, notModified: p.notModified });
    return p;
  };
  adapter.parsePage = function* (p) {
    const start = performance.now();
    yield* parse(p);
    parseMs.push(performance.now() - start);
  };
  const [pause] = await sql`select value from radar.system_settings where key='collection_paused'`;
  const ok = (value: unknown, label: string) => {
    assert(value, label);
    passed.push(label);
    console.log(`PASS: positions ${label}`);
  };
  const execute = async () => {
    const run = await repository.createRun(id, `p05:${id}:${crypto.randomUUID()}`, "test");
    const lease = await repository.claim(crypto.randomUUID(), ["collect_page"]);
    assert(lease?.runId === run);
    return { run, lease, result: await collect(lease, deps, signal) };
  };
  const snapshot = async () =>
    await sql`select o.id,o.title,o.organization,o.canonical_url,o.location_text,o.work_mode,o.country_codes,o.published_at::text,o.cycle_key,o.type_code,o.qualification_tags,o.attributes->'position'->'eligibility' as eligibility,o.content_revision,o.field_provenance,r.id as observation_id,r.source_record_key,r.source_url,d.id as deadline_id,d.due_date::text,d.due_at::text,d.revision as deadline_revision from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id join radar.opportunity_deadlines d on d.opportunity_id=o.id where r.source_id=${id} order by r.source_record_key`;
  let samples: unknown;
  try {
    await sql`update radar.system_settings set value='{"enabled":false}' where key='collection_paused'`;
    await sql`insert into radar.sources(id,slug,name,category,adapter_version,enabled,approved_at)values(${id},${adapter.slug},'Scoped Bath position pilot','position-test',${adapter.parserVersion},true,clock_timestamp())`;
    const first = await execute(), initial = await snapshot();
    samples = initial.map(({ field_provenance: _provenance, ...row }) => row);
    ok(
      first.result.inserted > 0 && first.result.rejected > 0,
      "research records persist while out-of-scope roles have explicit durable dispositions",
    );
    const [stats] =
      await sql`select records_seen::integer,accepted::integer,rejected::integer,pages_committed,status from radar.collection_runs where id=${first.run}`;
    ok(
      stats.records_seen === stats.accepted + stats.rejected && stats.accepted === initial.length &&
        stats.pages_committed === 1 && stats.status === "partial",
      "partial run counters account for every accepted or excluded source record",
    );
    ok(
      initial.every((r) =>
        r.organization === "University of Bath" && r.cycle_key &&
        r.field_provenance.title.source_record_id === r.observation_id && r.due_at === null
      ),
      "actual source observations bind factual canonical provenance and date-only deadlines",
    );
    const [reference] = initial.filter((r) => r.source_record_key === "bath-v1:SS14039");
    ok(
      reference?.due_date === "2026-11-29" &&
        reference.published_at.startsWith("2026-10-22 00:00:00"),
      "publication and application dates remain distinct from fetch time",
    );
    ok(
      (await collect(first.lease, deps, signal)).replayed,
      "same task replay has no collection or completion effects",
    );
    const second = await execute();
    ok(second.result.inserted === 0, "new-run replay creates no duplicate canonicals");
    equals(
      (await snapshot()).map((r) => [r.id, r.content_revision]),
      initial.map((r) => [r.id, r.content_revision]),
    );
    if (!liveSlug) {
      payload = payload.replace("29 Nov 2026", "30 Nov 2026");
      await execute();
      const updated = (await snapshot()).find((r) => r.source_record_key === "bath-v1:SS14039")!;
      ok(
        updated.id === reference.id && updated.deadline_id === reference.deadline_id &&
          updated.deadline_revision === reference.deadline_revision + 1 &&
          updated.due_date === "2026-11-30",
        "deadline update keeps vacancy and logical deadline identities",
      );
      payload = payload.replaceAll("SS14039", "SS14039R");
      await execute();
      const reposts = await snapshot();
      ok(
        reposts.some((r) => r.source_record_key === "bath-v1:SS14039") && reposts.some((r) =>
          r.source_record_key === "bath-v1:SS14039R"
        ) && reposts.length === initial.length + 1,
        "new-reference repost stays a distinct hiring cycle without deleting the old vacancy",
      );
      payload = (await Deno.readTextFile("tests/fixtures/bath/research.xml")).replace(
        "<guid>https://www.bath.ac.uk/jobs/rss/click.aspx?ref=SS13911</guid>",
        "",
      );
      const mixed = await execute();
      ok(
        mixed.result.rejected === 5,
        "malformed assistant item preserves two valid sibling records plus explicit exclusions",
      );
      const run = await repository.createRun(id, `p05:${id}:disable`, "test"),
        lease = await repository.claim(crypto.randomUUID(), ["collect_page"]);
      assert(lease?.runId === run);
      await sql`update radar.sources set enabled=false where id=${id}`;
      try {
        await collect(lease, deps, signal);
        throw new Error("disable did not prevent collection");
      } catch (error) {
        assert(error instanceof ProcessingError && error.code === "source_disabled");
      }
      await repository.finish(lease, "canceled", "source_disabled", 60);
      const [health] = await sql`select consecutive_failures from radar.sources where id=${id}`;
      ok(
        health.consecutive_failures === 0 && (await snapshot()).length === reposts.length,
        "disabling cancels work without deleting canonicals or damaging source health",
      );
      await sql`update radar.sources set enabled=true where id=${id}`;
      payload = await Deno.readTextFile("tests/fixtures/bath/research.xml");
      await execute();
      ok(
        (await snapshot()).find((r) => r.source_record_key === "bath-v1:SS14039")?.id ===
          reference.id,
        "reenabling preserves deterministic source identity",
      );
    }
    const [{ notifications }] =
      await sql`select count(*)::integer as notifications from radar.notifications`;
    ok(notifications === 0, "pilot creates no notifications or personal profile");
  } catch (error) {
    if (error instanceof TestAssertionError) console.error(error.message);
    if (error instanceof ProcessingError) console.error(`Position error: ${error.code}`);
    throw error;
  } finally {
    await sql.begin(async (tx) => {
      const ids =
        (await tx`select distinct opportunity_id from radar.source_records where source_id=${id} and opportunity_id is not null`)
          .map((r) => String(r.opportunity_id));
      await tx`delete from radar.job_tasks where collection_run_id in(select id from radar.collection_runs where source_id=${id})`;
      await tx`delete from radar.opportunity_deadlines where opportunity_id=any(${ids}::uuid[])`;
      await tx`delete from radar.opportunity_identities where opportunity_id=any(${ids}::uuid[])`;
      await tx`delete from radar.source_records where source_id=${id}`;
      await tx`delete from radar.collection_runs where source_id=${id}`;
      await tx`delete from radar.opportunities where id=any(${ids}::uuid[])`;
      await tx`delete from radar.sources where id=${id}`;
      await tx`update radar.system_settings set value=${
        tx.json(pause.value)
      } where key='collection_paused'`;
    });
    console.log("PASS: scoped position pilot cleanup; pause and reference state preserved.");
  }
  assert(inputHash === await conferenceInputHash(), "position inputs changed during verification");
  await Deno.writeTextFile(
    `private/phase05-${liveSlug ?? "position-integration"}.json`,
    JSON.stringify(
      {
        projectRef: target.projectRef,
        targetClass: target.targetClass,
        verifiedAt: clock.now(),
        inputHash,
        assertions: passed,
        pages,
        parseMs,
        samples,
        rssProxy: Deno.memoryUsage().rss,
        cleanup: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      source: adapter.slug,
      mode: liveSlug ? "live" : "fixtures",
      assertions: passed.length,
      pages,
      parseMs,
      samples,
    }),
  );
}
