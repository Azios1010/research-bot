import { assert, equals, rejects } from "../support.ts";
import { CernAdapter } from "../../supabase/functions/_shared/adapters/sources/cern/adapter.ts";
import { cernManifest } from "../../supabase/functions/_shared/adapters/sources/cern/manifest.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import type { CollectedPage } from "../../supabase/functions/_shared/application/ports.ts";
const file = (name: string) =>
  Deno.readTextFile(new URL(`../fixtures/cern/${name}`, import.meta.url));
const page = (
  feed: string,
  detail: string | null,
  detailError: string | null = null,
): CollectedPage => ({
  payload: JSON.stringify({ schemaVersion: 1, feed, detail, detailError, page: 0 }),
  format: "cern-rss-envelope-v1",
  sourceUrl: cernManifest.feeds[0],
  fetchedAt: "2026-10-29T11:00:00Z",
  sourceRevision: null,
  validators: { document_hash: "a".repeat(64) },
  nextCursor: null,
  notModified: false,
});
Deno.test("CERN programme mappings keep explicit doctoral edition and internship cycle with bounded eligibility", async () => {
  const rows = [
    ...new CernAdapter().parsePage(page(await file("students.xml"), await file("internship.html"))),
  ];
  equals(rows.map((r) => r.kind), ["record", "record", "error"]);
  assert(rows[0].kind === "record" && rows[1].kind === "record");
  const phd = await normalize(rows[0].draft), intern = await normalize(rows[1].draft);
  equals(phd.fields.type, "phd");
  equals(phd.fields.cycleKey, "2027-1");
  equals(phd.fields.publishedAt, null);
  equals(phd.deadlines[0].dueAt, null);
  equals(intern.fields.type, "research_internship");
  equals(intern.fields.workMode, "onsite");
  equals(intern.fields.countryCodes, ["CH"]);
  equals(intern.fields.publishedAt, "2025-10-21T13:07:53.000Z");
  equals(intern.deadlines[0].dueAt, "2026-11-01T22:59:00.000Z");
  equals(intern.deadlines[0].timezone, "Europe/Zurich");
  assert(JSON.stringify(intern.fields.attributes).includes("research_assignment_not_guaranteed"));
  assert(JSON.stringify(intern.fields.attributes).includes("PK"));
  assert(JSON.stringify(rows[1]).length < 6000);
});
Deno.test("CERN malformed or failed-detail sibling does not kill a valid doctoral record; schema drift is visible", async () => {
  const feed = await file("students.xml"), adapter = new CernAdapter();
  for (
    const bad of [
      null,
      "<html>wrong page</html>",
      (await file("internship.html")).replace(
        "Before 01/11/2026 at 23:59 (Geneva Time)",
        "Unknown format",
      ),
    ]
  ) {
    const rows = [...adapter.parsePage(page(feed, bad))];
    equals(rows.map((r) => r.kind), ["record", "error", "error"]);
  }
  const rows = [...adapter.parsePage(page(feed, null, "transport_timeout"))];
  equals((rows[1] as { code: string }).code, "transport_timeout");
  await rejects(() => [...adapter.parsePage(page("<rss>broken", null))]);
  await rejects(
    () => [...adapter.parsePage({ ...page(feed, null), payload: '{"schemaVersion":2}' })],
    "document_shape_changed",
  );
  equals([
    ...adapter.parsePage(
      page('<rss version="2.0"><channel><title>careers.cern</title></channel></rss>', null),
    ),
  ], []);
});
Deno.test("reused CERN homepage never collapses hiring cycles; deadline corrections preserve cycle and round", async () => {
  const feed = await file("students.xml"),
    html = await file("internship.html"),
    adapter = new CernAdapter();
  const base = [...adapter.parsePage(page(feed, html))][1],
    later = [...adapter.parsePage(page(feed, html.replace("01/11/2026", "02/11/2026")))][1],
    repost = [...adapter.parsePage(page(feed, html.replace("STAG 2026", "STAG 2027")))][1];
  assert(base.kind === "record" && later.kind === "record" && repost.kind === "record");
  equals(base.sourceRecordKey, later.sourceRecordKey);
  const a = await normalize(base.draft),
    b = await normalize(later.draft),
    c = await normalize(repost.draft);
  equals(a.fingerprint, b.fingerprint);
  assert(a.fingerprint !== c.fingerprint);
  assert(a.identities[0].value !== c.identities[0].value);
  equals(a.deadlines[0].roundKey, b.deadlines[0].roundKey);
});

Deno.test("CERN explicit closure and missing eligibility retain source precision without inventing degree alternatives", async () => {
  const feed = await file("students.xml"),
    html = (await file("internship.html")).replace(
      "Before 01/11/2026 at 23:59 (Geneva Time)",
      "Applications closed",
    ).replace(
      "Post-secondary diploma, Bachelor or Master studies are required.",
      "Master studies are required.",
    ).replace(
      "Applicants remain enrolled as a full-time student during the placement.",
      "Student status is unspecified.",
    );
  const row = [...new CernAdapter().parsePage(page(feed, html))][1];
  assert(row.kind === "record");
  const n = await normalize(row.draft);
  equals(n.fields.status, "closed");
  equals(n.deadlines[0].dueAt, null);
  assert(!n.fields.qualificationTags.includes("student_full_time"));
  assert(!n.fields.qualificationTags.includes("undergraduate_or_masters"));
  const attrs = n.fields.attributes.position as {
    eligibility: { degree_levels: string[]; student_full_time: boolean | null };
  };
  equals(attrs.eligibility.degree_levels, ["masters"]);
  equals(attrs.eligibility.student_full_time, null);
});
