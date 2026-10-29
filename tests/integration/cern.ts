import type postgres from "postgres";
import { assert, equals } from "../support.ts";
import { CernAdapter } from "../../supabase/functions/_shared/adapters/sources/cern/adapter.ts";
import { cernManifest } from "../../supabase/functions/_shared/adapters/sources/cern/manifest.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import { sourceSession } from "./source_session.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";

export async function verifyCern(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
  live = false,
) {
  const inputHash = await conferenceInputHash(), passed: string[] = [], adapter = new CernAdapter();
  const feed = await Deno.readTextFile("tests/fixtures/cern/students.xml");
  let html = await Deno.readTextFile("tests/fixtures/cern/internship.html"),
    detailStatus = 200;
  const transport: typeof fetch = (input) =>
    Promise.resolve(
      String(input) === cernManifest.internshipUrl
        ? new Response(html, { status: detailStatus, headers: { "content-type": "text/html" } })
        : new Response(feed, { headers: { "content-type": "application/rss+xml" } }),
    );
  const ok = (value: unknown, label: string) => {
    assert(value, label);
    passed.push(label);
    console.log(`PASS: CERN ${label}`);
  };
  let evidence: unknown;
  await sourceSession(
    sql,
    target,
    token,
    adapter,
    live ? fetch : transport,
    async ({ execute, snapshot, deps, measurements }) => {
      const first = await execute(), initial = await snapshot(), expected = live ? 1 : 2;
      ok(
        initial.length === expected,
        "expected real programme types persist via the shared pipeline",
      );
      const [stats] =
        await sql`select records_seen::integer,accepted::integer,rejected::integer,pages_committed,status,source_revision from radar.collection_runs where id=${first.run}`;
      ok(
        stats.records_seen === stats.accepted + stats.rejected && stats.accepted === expected &&
          stats.pages_committed === (live ? 4 : 1) && stats.status === "partial" &&
          stats.source_revision === null,
        "unversioned paginated run accounting and cursor commits are exact",
      );
      ok(
        initial.every((r) => r.field_provenance.title.source_record_id === r.observation_id),
        "canonical provenance binds actual observations",
      );
      const intern = initial.find((r) => r.type_code === "research_internship")!;
      ok(
        intern.cycle_key === "stag 2026" && intern.country_codes.join(",") === "CH" &&
          intern.work_mode === "onsite" && intern.due_at === "2026-11-01 22:59:00+00" &&
          intern.timezone === "Europe/Zurich",
        "real STAG cycle location mode and explicit Geneva deadline persist",
      );
      ok(
        intern.published_at === "2025-10-21 13:07:53+00" &&
          intern.attributes.position.eligibility.excluded_nationalities.includes("PK"),
        "publication is not fetch/cycle date and restrictions remain source evidence",
      );
      const before = measurements.length;
      ok(
        (await collect(first.leases[0], deps, new AbortController().signal)).replayed &&
          measurements.length === before,
        "task replay does no upstream IO or double accounting",
      );
      await execute();
      equals(
        (await snapshot()).map((r) => [r.id, r.content_revision]),
        initial.map((r) => [r.id, r.content_revision]),
      );
      ok(true, "new-run replay preserves canonical IDs revisions and source identity");
      if (!live) {
        html = html.replace("01/11/2026", "02/11/2026");
        await execute();
        const changed = (await snapshot()).find((r) => r.type_code === "research_internship")!;
        ok(
          changed.id === intern.id && changed.deadline_id === intern.deadline_id &&
            changed.deadline_revision === intern.deadline_revision + 1,
          "deadline correction keeps opportunity and round IDs",
        );
        html = html.replace("STAG 2026", "STAG 2027");
        await execute();
        const cycles = await snapshot();
        ok(
          cycles.length === 3 && new Set(cycles.map((r) => r.id)).size === 3,
          "reused internship homepage with a new cycle does not collapse",
        );
        detailStatus = 503;
        const partial = await execute();
        const [counts] =
          await sql`select accepted::integer,rejected::integer from radar.collection_runs where id=${partial.run}`;
        ok(
          counts.accepted === 1 && counts.rejected === 2 && (await snapshot()).length === 3,
          "detail failure is durably rejected without failing doctoral sibling or deleting existing canonicals",
        );
      }
      evidence = {
        stats,
        samples: initial.map(({ field_provenance: _p, ...row }) => row),
        measurements,
        rssProxy: Deno.memoryUsage().rss,
      };
    },
  );
  assert(inputHash === await conferenceInputHash(), "CERN verification inputs changed");
  await Deno.writeTextFile(
    `private/phase05-cern-${live ? "smoke" : "integration"}.json`,
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
