import type postgres from "postgres";
import { assert, equals } from "../support.ts";
import { fundingFixtures, fundingTransport } from "../grants_support.ts";
import { GrantsAdapter } from "../../supabase/functions/_shared/adapters/sources/grantsgov/adapter.ts";
import { grantsManifest } from "../../supabase/functions/_shared/adapters/sources/grantsgov/manifest.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import { sourceSession } from "./source_session.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";

export async function verifyFunding(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
  live = false,
) {
  console.log(grantsManifest.attribution);
  const inputHash = await conferenceInputHash(),
    passed: string[] = [],
    adapter = new GrantsAdapter();
  const fixtures = await fundingFixtures();
  let detailFailure = false;
  const transport: typeof fetch = (input, init) =>
    detailFailure &&
      String(input) === grantsManifest.detail &&
      JSON.parse(String(init?.body)).opportunityId === fixtures[0].detail.data.id
      ? Promise.resolve(
        new Response("{}", { status: 503, headers: { "content-type": "application/json" } }),
      )
      : fundingTransport(fixtures)(input, init);
  const ok = (value: unknown, label: string) => {
    assert(value, label);
    passed.push(label);
    console.log(`PASS: funding ${label}`);
  };
  let evidence: unknown;
  await sourceSession(
    sql,
    target,
    token,
    adapter,
    live ? fetch : transport,
    async ({ id, execute, snapshot, deps, measurements }) => {
      const first = await execute(), initial = await snapshot();
      ok(
        initial.length === 2 && new Set(initial.map((r) => r.type_code)).size === 2,
        "distinct grant and cooperative research funding persist through the shared pipeline",
      );
      const [stats] =
        await sql`select records_seen::integer,accepted::integer,rejected::integer,pages_committed,status from radar.collection_runs where id=${first.run}`;
      ok(
        stats.records_seen === 2 && stats.accepted === 2 && stats.rejected === 0 &&
          stats.pages_committed === 1 && stats.status === "succeeded",
        "bounded two-call page has exact accounting and one atomic cursor commit",
      );
      ok(
        initial.every((r) =>
          r.field_provenance.title.source_record_id === r.observation_id &&
          r.field_provenance.attributes.source_record_id === r.observation_id
        ),
        "canonical funding facts bind actual source observations",
      );
      ok(
        initial.every((r) =>
          r.due_at === null && r.due_date && r.precision === "date" && r.timezone === null &&
          r.published_at === null && r.attributes.funding.posted_date
        ),
        "calendar-only application and publication evidence creates no invented instant or timezone",
      );
      ok(
        initial.every((r) =>
          r.attributes.funding.eligibility.applicant_types.length > 0 &&
          r.attributes.funding.eligibility.additional_information &&
          r.attributes.funding.eligibility.nationality === null && r.country_codes.length === 0
        ),
        "institutional applicant restrictions persist without assuming personal eligibility or location",
      );
      const before = measurements.length;
      ok(
        (await collect(first.leases[0], deps, new AbortController().signal)).replayed &&
          measurements.length === before,
        "completed task replay performs no source IO or accounting",
      );
      const replay = await execute();
      ok(
        replay.results.every((r) => r.inserted === 0),
        "new-run replay creates no duplicate canonicals",
      );
      equals(
        (await snapshot()).map(
          (r) => [r.id, r.observation_id, r.content_revision, r.deadline_id, r.deadline_revision],
        ),
        initial.map(
          (r) => [r.id, r.observation_id, r.content_revision, r.deadline_id, r.deadline_revision],
        ),
      );
      ok(true, "replay preserves canonical observation round IDs and revisions");
      if (!live) {
        const grant = initial.find((r) => r.type_code === "grant")!;
        fixtures[0].detail.data.synopsis.responseDateStr = "2026-11-12-00-00-00";
        fixtures[0].detail.data.synopsis.version++;
        fixtures[0].detail.data.revision++;
        await execute();
        const changed = (await snapshot()).find((r) => r.id === grant.id)!;
        ok(
          changed.deadline_id === grant.deadline_id &&
            changed.deadline_revision === grant.deadline_revision + 1 &&
            changed.due_date === "2026-11-12" &&
            Number(changed.content_revision) === Number(grant.content_revision) + 1,
          "amended deadline revises the same canonical call and semantic round",
        );
        // Same programme number/funder homepage, new portal announcement is a genuine new cycle.
        fixtures[0].detail.data.id = 999900001;
        fixtures[0].search.data.oppHits[0].id = "999900001";
        await execute();
        ok(
          (await snapshot()).length === 3 &&
            (await snapshot()).some((r) => r.cycle_key === "20-558:999900001"),
          "reused programme number and homepage do not collapse a new portal call cycle",
        );
        const previousCa = fixtures[1];
        fixtures[0].detail.data.synopsis.fundingInstruments.push({
          id: "CA",
          description: "Cooperative Agreement",
        });
        fixtures[1] = { ...structuredClone(fixtures[0]), code: "CA" };
        const mixed = await execute();
        const [mixedStats] =
          await sql`select records_seen::integer,accepted::integer,rejected::integer from radar.collection_runs where id=${mixed.run}`;
        ok(
          mixedStats.records_seen === 1 && mixedStats.accepted === 1 && mixedStats.rejected === 0 &&
            (await snapshot()).length === 3,
          "one call returned by both instrument queries has one source identity and one accounting disposition",
        );
        fixtures[1] = previousCa;
        detailFailure = true;
        const partial = await execute();
        const [counts] =
          await sql`select accepted::integer,rejected::integer,status from radar.collection_runs where id=${partial.run}`;
        const [rejection] =
          await sql`select error_code from radar.source_records where source_id=${id} and source_record_key='grants-v1:999900001:20-558'`;
        ok(
          counts.accepted === 1 && counts.rejected === 1 && counts.status === "partial" &&
            rejection.error_code === "source_http_failed",
          "failed bounded detail has durable rejection while the valid funding sibling commits",
        );
        ok(
          (await snapshot()).length >= 2,
          "detail failure retains already persisted canonical funding",
        );
      }
      const [effects] =
        await sql`select (select count(*) from radar.notifications)::integer as notifications,(select count(*) from radar.research_profiles)::integer as profiles`;
      ok(
        effects.notifications === 0 && effects.profiles === 0,
        "no notification schedule or personal profile is created",
      );
      evidence = {
        stats,
        samples: initial.map(({ field_provenance: _p, ...row }) => row),
        measurements,
        rssProxy: Deno.memoryUsage().rss,
      };
    },
  );
  assert(inputHash === await conferenceInputHash(), "funding verification inputs changed");
  await Deno.writeTextFile(
    `private/phase05-funding-${live ? "smoke" : "integration"}.json`,
    JSON.stringify(
      {
        projectRef: target.projectRef,
        targetClass: target.targetClass,
        verifiedAt: new Date().toISOString(),
        inputHash,
        assertions: passed,
        evidence,
        cleanup: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      source: adapter.slug,
      mode: live ? "live" : "fixtures",
      assertions: passed.length,
      evidence,
    }),
  );
}
