import type postgres from "postgres";
import { assert, equals, TestAssertionError } from "../support.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import { ProcessingError } from "../../supabase/functions/_shared/application/ports.ts";
import {
  approvedEndpoints,
  approvedSources,
} from "../../supabase/functions/_shared/adapters/sources/registry.ts";
import { hotosManifest } from "../../supabase/functions/_shared/adapters/sources/ccfddl/manifest.ts";
import { openreviewManifest } from "../../supabase/functions/_shared/adapters/sources/openreview/manifest.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { StructuredLogger } from "../../supabase/functions/_shared/infrastructure/observability/logging.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";
import { bytes, digest } from "../../supabase/functions/_shared/domain/primitives.ts";

export async function verifyCoverageSources(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
  liveSlug?: string,
) {
  if (liveSlug && ![hotosManifest.slug, openreviewManifest.slug].includes(liveSlug)) {
    throw new ProcessingError("unapproved_source");
  }
  const inputHash = await conferenceInputHash();
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
  const clock = { now: () => new Date().toISOString() },
    passed: string[] = [],
    measurements: unknown[] = [];
  const [pause] = await sql`select value from radar.system_settings where key='collection_paused'`;
  const sources: string[] = [];
  const ok = (condition: unknown, label: string) => {
    assert(condition, label);
    passed.push(label);
    console.log(`PASS: conference coverage ${label}`);
  };
  try {
    await sql`update radar.system_settings set value='{"enabled":false}' where key='collection_paused'`;
    for (const slug of liveSlug ? [liveSlug] : [hotosManifest.slug, openreviewManifest.slug]) {
      const id = crypto.randomUUID();
      sources.push(id);
      const adapter = approvedSources().get(slug)!;
      const body = await Deno.readTextFile(
        slug === hotosManifest.slug
          ? "tests/fixtures/ccfddl/hotos.yml"
          : "tests/fixtures/openreview/invitation.json",
      );
      const transport: typeof fetch = () =>
        Promise.resolve(
          new Response(body, {
            headers: {
              "content-type": slug === hotosManifest.slug ? "text/plain" : "application/json",
              etag: '"coverage-fixture"',
            },
          }),
        );
      const http = new BoundedHttpClient(approvedEndpoints, liveSlug ? fetch : transport);
      const pages: { bytes: number; revision: string | null; unchanged: boolean }[] = [],
        parseMs: number[] = [];
      const originalCollect = adapter.collectPage.bind(adapter),
        originalParse = adapter.parsePage.bind(adapter);
      adapter.collectPage = async (...args) => {
        const page = await originalCollect(...args);
        pages.push({
          bytes: bytes(page.payload),
          revision: page.sourceRevision,
          unchanged: page.notModified,
        });
        return page;
      };
      adapter.parsePage = function* (page) {
        const t = performance.now();
        yield* originalParse(page);
        parseMs.push(performance.now() - t);
      };
      const deps = {
        repository,
        http,
        clock,
        adapters: new Map([[slug, adapter]]),
        logger: new StructuredLogger(),
      };
      await sql`insert into radar.sources(id,slug,name,category,adapter_version,enabled,approved_at) values(${id},${slug},'Scoped Phase 04 coverage','conference-test',${adapter.parserVersion},true,clock_timestamp())`;
      const execute = async () => {
        const run = await repository.createRun(id, `p04:${id}:${crypto.randomUUID()}`, "test");
        const lease = await repository.claim(crypto.randomUUID(), ["collect_page"]);
        assert(lease?.runId === run);
        return { run, lease, result: await collect(lease, deps, new AbortController().signal) };
      };
      const first = await execute(), expected = slug === hotosManifest.slug ? 4 : 1;
      ok(
        first.result.inserted === expected && first.result.rejected === 0,
        `${slug} expected real-source mapping persists`,
      );
      const [stats] =
        await sql`select records_seen::integer,accepted::integer,rejected::integer,pages_committed from radar.collection_runs where id=${first.run}`;
      ok(
        stats.records_seen === expected && stats.accepted === expected && stats.rejected === 0 &&
          stats.pages_committed === 1,
        `${slug} page accounting`,
      );
      const rows =
        await sql`select o.id,o.type_code,o.cycle_key,o.track_key,o.field_provenance,r.id as record_id,r.source_revision,r.metadata,o.content_revision from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id where r.source_id=${id} order by o.cycle_key`;
      ok(
        rows.length === expected &&
          rows.every((r) =>
            r.type_code === (slug === hotosManifest.slug ? "workshop" : "conference_cfp") &&
            r.field_provenance.title.source_record_id === r.record_id &&
            r.source_revision === r.metadata.source_revision
          ),
        `${slug} type and observation provenance`,
      );
      const deadlines =
        await sql`select d.due_at::text,d.due_date::text,d.precision,d.basis,d.kind,d.timezone,d.round_key from radar.opportunity_deadlines d join radar.source_records r on r.opportunity_id=d.opportunity_id where r.source_id=${id} order by d.due_date,d.kind`;
      ok(deadlines.length === (slug === hotosManifest.slug ? 5 : 1), `${slug} deadline count`);
      if (slug === hotosManifest.slug) {
        ok(
          deadlines.every((d) =>
            d.due_at === null && d.basis === "source_default" && d.precision === "date"
          ) && deadlines.some((d) => d.due_date === "2027-02-01"),
          "HotOS calendar dates and default AoE are honest",
        );
      } else {ok(
          deadlines[0].precision === "instant" && deadlines[0].timezone === "UTC" &&
            deadlines[0].due_at.startsWith("2026-10-10 13:00:00") &&
            rows[0].track_key === "workshop-proposals",
          "standalone call preserves actual API due instant not later expiry",
        );}
      const before = rows.map((r) => [r.id, r.content_revision]);
      ok(
        (await collect(first.lease, deps, new AbortController().signal)).replayed,
        `${slug} task replay skips IO`,
      );
      const again = await execute();
      ok(
        again.result.inserted === 0 && again.result.rejected === 0,
        `${slug} fresh-run replay nonduplicating`,
      );
      const after =
        await sql`select o.id,o.content_revision from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id where r.source_id=${id} order by o.cycle_key`;
      equals(
        after.map((r) => [r.id, r.content_revision]),
        before,
        `${slug} unchanged content revisions`,
      );
      measurements.push({
        slug,
        records: expected,
        deadlines: deadlines.length,
        pages,
        parseMs,
        rssProxy: Deno.memoryUsage().rss,
      });
    }
    const [{ notifications }] =
      await sql`select count(*)::integer as notifications from radar.notifications`;
    ok(notifications === 0, "coverage collection is non-notifying");
  } catch (error) {
    if (error instanceof TestAssertionError) console.error(error.message);
    if (error instanceof ProcessingError) console.error(`Coverage error: ${error.code}`);
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
    console.log("PASS: scoped workshop/call cleanup; settings and reference state preserved.");
  }
  assert(inputHash === await conferenceInputHash(), "coverage inputs changed during verification");
  await Deno.writeTextFile(
    `private/phase04-${liveSlug ?? "coverage-integration"}.json`,
    JSON.stringify(
      {
        projectRef: target.projectRef,
        targetClass: target.targetClass,
        verifiedAt: clock.now(),
        inputHash,
        assertions: passed,
        assertionsHash: await digest(passed),
        measurements,
        cleanup: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      mode: liveSlug ? "live" : "fixtures",
      measurements,
      assertions: passed.length,
    }),
  );
}
