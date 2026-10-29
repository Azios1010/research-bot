import { assert, equals, rejects } from "../support.ts";
import { BathAdapter } from "../../supabase/functions/_shared/adapters/sources/bath/adapter.ts";
import { bathManifest } from "../../supabase/functions/_shared/adapters/sources/bath/manifest.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import type { CollectedPage } from "../../supabase/functions/_shared/application/ports.ts";
import { closingDate } from "../../supabase/functions/_shared/adapters/sources/bath/mapping.ts";

const fixture = () => Deno.readTextFile(new URL("../fixtures/bath/research.xml", import.meta.url));
const adapter = new BathAdapter();
Deno.test("Bath calendar month tokens require actual month names rather than a guessed prefix", async () => {
  equals(closingDate("29 November 2026"), "2026-11-29");
  await rejects(() => closingDate("29 Mayhem 2026"), "malformed_closing_date");
});
const page = (payload: string): CollectedPage => ({
  payload,
  format: "rss",
  sourceUrl: bathManifest.endpoint,
  sourceRevision: "a".repeat(64),
  fetchedAt: "2026-10-29T00:00:00Z",
  validators: {},
  notModified: false,
  nextCursor: null,
});
Deno.test("Bath factual feed separates research employment from faculty clinical administrative and technical roles", async () => {
  const items = [...adapter.parsePage(page(await fixture()))];
  equals(items.length, 7);
  equals(items.map((x) => x.kind), [
    "record",
    "record",
    "record",
    "error",
    "error",
    "error",
    "error",
  ]);
  const good = items.slice(0, 3);
  for (const i of good) {
    assert(i.kind === "record");
    assert(JSON.stringify(i).length < 6000);
  }
  const first = good[0];
  assert(first.kind === "record");
  const normalized = await normalize(first.draft);
  equals(normalized.fields.type, "postdoc");
  equals(normalized.fields.publishedAt, "2026-10-22T00:00:00.000Z");
  equals(normalized.fields.countryCodes, []);
  equals(normalized.fields.workMode, "unknown");
  equals(normalized.deadlines[0].dueDate, "2026-11-29");
  equals(normalized.deadlines[0].dueAt, null);
  equals(normalized.deadlines[0].timezone, null);
  assert(normalized.fields.qualificationTags.includes("doctoral_completed_or_nearing"));
  assert(good[1].kind === "record");
  equals(good[1].draft.type, "research_assistant");
  equals(good[1].draft.publishedAt, null);
  equals((items[5] as { code: string }).code, "excluded_nonresearch_category");
});
Deno.test("one malformed XML item preserves valid siblings while malformed document and drift fail visibly", async () => {
  const xml = await fixture(),
    bad = xml.replace("<guid>https://www.bath.ac.uk/jobs/rss/click.aspx?ref=SS13911</guid>", "");
  const items = [...adapter.parsePage(page(bad))];
  equals(items.slice(0, 3).map((x) => x.kind), ["record", "error", "record"]);
  for (
    const payload of [
      "",
      xml.replace('version="2.0"', 'version="3.0"'),
      xml.replace("</channel>", "</feed>"),
      '<rss version="2.0"><channel><title>Another source</title></channel></rss>',
    ]
  ) await rejects(() => [...adapter.parsePage(page(payload))]);
  equals([
    ...adapter.parsePage(
      page('<rss version="2.0"><channel><title>Jobs at Bath</title></channel></rss>'),
    ),
  ], []);
});
Deno.test("XML safety rejects DTD entity expansion excessive depth nodes and size; no network or environment", async () => {
  for (
    const payload of [
      '<!DOCTYPE rss SYSTEM "https://evil.invalid/x"><rss/>',
      '<!DOCTYPE rss [<!ENTITY a "expanded">]><rss/>',
      "<a>".repeat(21) + "</a>".repeat(21),
      "<rss>" + "<a/>".repeat(4100) + "</rss>",
      "x".repeat(524289),
    ]
  ) await rejects(() => [...adapter.parsePage(page(payload))]);
});
Deno.test("missing rolling locations and optional fields preserve uncertainty with explicit facts only", async () => {
  const xml = (await fixture()).replace("23 Sep 2026", "Open Until Filled").replace(
    "<p>Closing Date: Open Until Filled",
    "<p>Location: Bath, United Kingdom; Kyoto, Japan<br/>Work Mode: Hybrid<br/>Closing Date: Open Until Filled",
  );
  const item = [...adapter.parsePage(page(xml))][1];
  assert(item.kind === "record");
  const n = await normalize(item.draft);
  equals(n.fields.countryCodes, ["GB", "JP"]);
  equals(n.fields.workMode, "hybrid");
  equals(n.deadlines[0].precision, "unknown");
  equals(n.deadlines[0].rawValue, "rolling");
  const missing = [...adapter.parsePage(
    page((await fixture()).replace("Closing Date: 23 Sep 2026", "No date supplied")),
  )][1];
  assert(missing.kind === "record");
  equals(missing.draft.deadlines![0].value, null);
});
Deno.test("same reference deadline correction is stable; same-looking repost with a new reference stays distinct", async () => {
  const xml = await fixture(),
    first = [...adapter.parsePage(page(xml))][0],
    changed = [...adapter.parsePage(page(xml.replace("29 Nov 2026", "30 Nov 2026")))][0];
  assert(first.kind === "record" && changed.kind === "record");
  equals(first.sourceRecordKey, changed.sourceRecordKey);
  equals((await normalize(first.draft)).fingerprint, (await normalize(changed.draft)).fingerprint);
  const repost = [...adapter.parsePage(page(xml.replaceAll("SS14039", "SS14039R")))][0];
  assert(repost.kind === "record");
  assert(repost.sourceRecordKey !== first.sourceRecordKey);
  assert(
    (await normalize(repost.draft)).fingerprint !== (await normalize(first.draft)).fingerprint,
  );
});

Deno.test("Bath Unicode optional metadata duplicate keys and absence of equivalence stay factual", async () => {
  const xml = (await fixture()).replace(
    "Research Assistant (SS13911)",
    "Research Assistant — Café (SS13911)",
  ).replace("PhD or equivalent", "PhD").replace(
    "a PhD (completed or nearing completion), or equivalent research experience",
    "a PhD (completed or nearing completion)",
  );
  const rows = [...adapter.parsePage(page(xml))];
  assert(rows[1].kind === "record");
  equals((await normalize(rows[1].draft)).fields.title, "Research Assistant — Café");
  const first = rows[0];
  assert(first.kind === "record");
  const attrs = first.draft.attributes!.position as {
    eligibility: { equivalence_accepted: unknown };
  };
  equals(attrs.eligibility.equivalence_accepted, null);
  const item = /<item>[\s\S]*?<\/item>/.exec(xml)![0],
    duplicates = [...adapter.parsePage(page(xml.replace("</channel>", `${item}</channel>`)))];
  assert(duplicates[0].kind === "record" && duplicates.at(-1)?.kind === "record");
  equals(duplicates[0].sourceRecordKey, duplicates.at(-1)!.sourceRecordKey);
  const optional = [
    ...adapter.parsePage(
      page(xml.replace("</item>", "<unexpected>not a qualification</unexpected></item>")),
    ),
  ];
  equals(optional[0].kind, "record");
});
