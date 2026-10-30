import { assert, equals, rejects } from "../support.ts";
import { article, directory, journalFixtures, journalPage } from "../jeacs_support.ts";
import { JeacsAdapter } from "../../supabase/functions/_shared/adapters/sources/jeacs/adapter.ts";
import { jeacsManifest as m } from "../../supabase/functions/_shared/adapters/sources/jeacs/manifest.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import type { ObjectValue, ParsedRecord } from "../../supabase/functions/_shared/domain/model.ts";
import { temporal } from "../../supabase/functions/_shared/adapters/sources/jeacs/mapping.ts";
import { reconcile } from "../../supabase/functions/_shared/domain/reconcile.ts";
const adapter = new JeacsAdapter();
const records = (page: ReturnType<typeof journalPage>) =>
  [...adapter.parsePage(page)].filter((r): r is ParsedRecord => r.kind === "record");
Deno.test("real journal author calls distinguish a thematic issue and a closed regular unthemed CFP without duplicate aliases", async () => {
  const f = await journalFixtures(), rows = [...adapter.parsePage(journalPage(f))];
  equals(rows.length, 5);
  equals(rows.filter((r) => r.kind === "error").length, 2);
  const calls = records(journalPage(f));
  equals(calls.map((r) => r.draft.type), [
    "journal_special_issue",
    "journal_cfp",
    "journal_special_issue",
  ]);
  const si = await normalize(calls[0].draft), cf = await normalize(calls[1].draft);
  equals(si.fields.status, "open");
  equals(cf.fields.status, "closed");
  equals(si.deadlines.map((d) => [d.kind, d.dueDate, d.dueAt]), [["abstract", "2027-02-28", null], [
    "decision",
    "2027-03-31",
    null,
  ], ["submission", "2027-07-15", null]]);
  equals(si.fields.publishedAt, null);
  equals(si.fields.attributes.publication_date, "2026-10-08");
  equals(cf.fields.attributes.publication_date, "2025-02-10");
  const meta = si.fields.attributes.journal as ObjectValue,
    call = si.fields.attributes.journal_call as ObjectValue;
  equals(meta.issn, "2709-9946");
  equals(meta.publisher, m.publisher);
  equals(call.guest_editors, ["Irmy Schweiger", "Serena De Marchi", "Simona Gallo"]);
  equals(call.language, "English");
  equals(call.word_count_guidance, "max. 8,000 words");
  equals((call.fees as ObjectValue).amount, 0);
  assert(!JSON.stringify(calls).includes("@"));
});
Deno.test("standalone historical CFP was open in its real window and stays a separate manuscript opportunity", async () => {
  const f = await journalFixtures();
  f.html = directory(article(f.html, "174"), article(f.html, "190"));
  const row = records(journalPage(f, "2025-07-01T00:00:00Z"))[0];
  equals(row.draft.type, "journal_cfp");
  equals(row.draft.status, "open");
  equals(row.sourceRecordKey, "jeacs-v1:announcement:174");
  assert((row.draft.attributes!.journal_call as ObjectValue).book_reviews_solicited_only);
});
Deno.test("published collections generic pages editor proposals and stale unknown calls never become current author opportunities", async () => {
  const f = await journalFixtures(), base = article(f.html, "230");
  for (
    const heading of [
      "Published collection: Memory Studies",
      "Call for guest-editor proposals for a special issue",
      "Call for contributions to list of recent PhD dissertations",
    ]
  ) {
    f.html = directory(
      base.replace(
        /<h2>[\s\S]*?<\/h2>/,
        `<h2><a href="${m.endpoint}/view/230">${heading}</a></h2>`,
      ),
    );
    f.detail = "";
    const p = journalPage(f);
    p.payload = p.payload.replace('"detail":""', '"detail":null');
    equals(records(p).length, 0);
  }
  const originalPage = journalPage(await journalFixtures());
  await rejects(
    () => [...adapter.parsePage({ ...originalPage, payload: '{"schemaVersion":2}' })],
    "document_shape_changed",
  );
  const old = await journalFixtures();
  old.html = directory(article(old.html, "174").replace(/<p>Deadline[^<]*<\/p>/, ""));
  const p = journalPage(old);
  p.payload = p.payload.replace(/"detail":.*,"detailError"/, '"detail":null,"detailError"');
  equals(records(p).length, 0);
});
Deno.test("missing deadlines stay unknown only with explicit accepting evidence, rolling review is not a rolling deadline", async () => {
  const f = await journalFixtures();
  f.detail = f.detail.replace(
    /<li>(?:Deadline for abstracts|Notification of abstract acceptance|Submission of full articles):[^<]*<\/li>/g,
    "",
  )
    .replace(
      "<p>We invite original research",
      "<p>Currently accepting submissions.</p><p>We invite original research",
    );
  f.html = directory(
    article(f.html, "230").replace(
      /<li>(?:Deadline for abstracts|Notification of abstract acceptance|Submission of full articles):[^<]*<\/li>/g,
      "",
    ),
  );
  const unknown = await normalize(records(journalPage(f))[0].draft);
  equals(unknown.deadlines[0].dueAt, null);
  equals(unknown.deadlines[0].dueDate, null);
  f.detail = f.detail.replace(
    "Currently accepting submissions.",
    "Submissions accepted on a rolling basis.",
  );
  const rolling = await normalize(records(journalPage(f))[0].draft);
  equals(rolling.deadlines[0].rawValue, "rolling");
  const old = await journalFixtures();
  old.html = directory(
    article(old.html, "174").replace(
      "Deadline (for issue 6.2): July 15, 2025.",
      "Formal acceptances are issued on a rolling basis.",
    ),
  );
  equals(records(journalPage(old)).length, 0);
});
Deno.test("explicit opening windows upcoming state exact clocks and uncertain timezone retain source precision", async () => {
  const f = await journalFixtures();
  f.html = directory(article(f.html, "230"));
  f.detail = f.detail.replace(
    "Submission of full articles: July 15, 2027",
    "Submission window: June 1, 2027 — July 15, 2027",
  );
  const row = records(journalPage(f))[0];
  equals(row.draft.status, "unknown");
  equals((row.draft.attributes!.journal_call as ObjectValue).source_status, "upcoming");
  equals(
    ((row.draft.attributes!.journal_call as ObjectValue).submission_opening as ObjectValue).value,
    "2027-06-01",
  );
  f.detail = f.detail.replace(
    "Submission window: June 1, 2027 — July 15, 2027",
    "Submission of full articles: 2027-07-15T17:00:00+02:00",
  );
  const precise = await normalize(records(journalPage(f))[0].draft);
  const d = precise.deadlines.find((d) => d.kind === "submission")!;
  equals(d.dueAt, "2027-07-15T15:00:00.000Z");
  equals(d.timezone, "+02:00");
  equals(temporal("2027-07-15T17:00:00 CST").timezone, "CST");
  await rejects(() => temporal("February 30, 2027"));
});
Deno.test("same call directory and detail share identity, deadline amendment changes facts and not fingerprint", async () => {
  const f = await journalFixtures(), a = records(journalPage(f))[0];
  const detail = journalPage({ ...f, html: f.detail, detail: null }, undefined, m.detailUrl);
  const b = records(detail)[0];
  equals((await normalize(a.draft)).identities, (await normalize(b.draft)).identities);
  const before = await normalize(a.draft);
  f.html = f.html.replaceAll("July 15, 2027", "July 16, 2027");
  f.detail = f.detail.replaceAll("July 15, 2027", "July 16, 2027");
  const c = records(journalPage(f))[0];
  equals(c.sourceRecordKey, a.sourceRecordKey);
  equals((await normalize(c.draft)).fingerprint, before.fingerprint);
});
Deno.test("recurring issue cycles themes and journal namespaces stay distinct while weak candidate identity cannot force a merge", async () => {
  const f = await journalFixtures(),
    row = records(journalPage(f))[0],
    base = await normalize(row.draft);
  const next = structuredClone(row.draft);
  next.cycleKey = next.cycleKey!.replace("2027", "2028");
  next.identities = [];
  assert((await normalize(next)).fingerprint !== base.fingerprint);
  const other = structuredClone(row.draft);
  other.title = "Another distinct theme";
  other.identities = [];
  assert((await normalize(other)).fingerprint !== base.fingerprint);
  const journal = structuredClone(row.draft);
  journal.cycleKey = journal.cycleKey!.replace("jeacs", "another-journal");
  journal.identities = [];
  assert((await normalize(journal)).fingerprint !== base.fingerprint);
  const origin = {
    sourceId: "s",
    sourceSlug: m.slug,
    sourceRecordKey: row.sourceRecordKey,
    parserVersion: m.parserVersion,
    observedAt: "2026-10-29T00:00:00Z",
    authority: 0,
  };
  const candidates = ["a", "b"].map((id) => ({
    ...base,
    id,
    revision: 1,
    evidenceVersion: "v",
    firstSeenAt: origin.observedAt,
    provenance: {},
  }));
  const result = await reconcile(base, {
    recordKey: "other",
    observationId: null,
    observationOpportunityId: null,
    strongIds: [],
    candidates,
    truncated: false,
  }, origin);
  assert(!result.targetId);
  assert(result.canonical.fields.qualityFlags.includes("conflicting_identity_candidate"));
});
Deno.test("directory detail disagreement is one conflicted semantic round with bounded evidence and conservative precision", async () => {
  const f = await journalFixtures();
  f.detail = f.detail.replace("July 15, 2027", "July 18, 2027");
  const n = await normalize(records(journalPage(f))[0].draft),
    d = n.deadlines.find((d) => d.kind === "submission")!;
  equals(d.status, "conflicted");
  equals(d.dueAt, null);
  equals(d.dueDate, null);
  assert(n.fields.qualityFlags.includes("conflicting_deadline"));
});
Deno.test("missing metadata stays unknown Unicode is normalized and active markup cannot supply identity", async () => {
  const f = await journalFixtures();
  f.policy = f.policy.replace("ISSN: 2709-9946", "").replace(
    "The journal does not charge submission or publication fees.",
    "",
  );
  f.detail = f.detail.replace("Serena De Marchi", "Seréna De Marchi").replace(
    "<ul>",
    '<script>fetch("https://evil.invalid")</script><ul>',
  );
  f.detail = f.detail.replace(
    "<ul>",
    "<p>We welcome submissions from scholars at all career stages working in Sinophone studies.</p><ul>",
  );
  const row = records(journalPage(f))[0],
    n = await normalize(row.draft),
    meta = n.fields.attributes.journal as ObjectValue;
  equals(meta.issn, null);
  equals((n.fields.attributes.journal_call as ObjectValue).fees, null);
  equals(
    ((n.fields.attributes.journal_call as ObjectValue).eligibility as ObjectValue).career_stage,
    "all_career_stages",
  );
  assert(!JSON.stringify(row).includes("evil.invalid"));
  assert(JSON.stringify(row).includes("Seréna"));
  equals(n.fields.countryCodes, []);
  equals(n.fields.workMode, "unknown");
});
Deno.test("explicit withdrawal and closure override future deadlines and do not invent published status", async () => {
  for (
    const [evidence, status] of [["Call is withdrawn", "withdrawn"], [
      "Submissions are closed",
      "closed",
    ]]
  ) {
    const f = await journalFixtures();
    f.detail = f.detail.replace("<ul>", `<p>${evidence}</p><ul>`);
    const row = records(journalPage(f)).find((r) => r.sourceRecordKey.endsWith(":230"))!;
    equals(row.draft.status, status);
    equals((row.draft.attributes!.journal_call as ObjectValue).source_status, status);
  }
});
Deno.test("only explicitly introduced scope lists supply topics; review and contact bullets are not taxonomy", async () => {
  const f = await journalFixtures();
  f.html = directory(
    article(f.html, "190").replace(
      "</div></article>",
      "<p>Book reviews</p><ul><li>For further information: editor@example.invalid</li><li>Research papers undergo review</li></ul></div></article>",
    ),
  );
  const call = records(journalPage({ ...f, detail: null }))[0];
  equals(call.draft.topics, []);
  assert(!JSON.stringify(await normalize(call.draft)).includes("example.invalid"));
  f.html = directory(article((await journalFixtures()).html, "230"));
  f.detail = f.detail.replace(
    "</div></article>",
    "<p>Possible topics include:</p><ul><li>Memory and futurity</li><li>Language and cultural production</li><li>Contact editor@example.invalid</li></ul></div></article>",
  );
  const special = records(journalPage(f))[0];
  equals(special.draft.topics, ["Memory and futurity", "Language and cultural production"]);
});
Deno.test("explicit fees preserve currency conditions and authority; contradictory fee evidence quarantines one call", async () => {
  const f = await journalFixtures();
  f.detail = f.detail.replace(
    "<ul>",
    "<p>APC: EUR 1200.50 only after acceptance; waiver conditions apply</p><ul>",
  );
  const conflict = [...new JeacsAdapter().parsePage(journalPage(f))];
  assert(conflict.some((r) => r.kind === "error" && r.code === "conflicting_fee_evidence"));
  equals(conflict.filter((r) => r.kind === "record").length, 2);
  f.policy = f.policy.replace("The journal does not charge submission or publication fees.", "");
  const row = records(journalPage(f)).find((r) => r.sourceRecordKey.endsWith(":230"))!;
  const fee = (row.draft.attributes!.journal_call as ObjectValue).fees as ObjectValue;
  equals(fee.amount, 1200.5);
  equals(fee.currency, "EUR");
  assert((fee.conditions as string).includes("waiver conditions"));
  equals(fee.evidence_url, m.detailUrl);
});
