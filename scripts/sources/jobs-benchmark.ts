import { BathAdapter } from "../../supabase/functions/_shared/adapters/sources/bath/adapter.ts";
import { bathManifest } from "../../supabase/functions/_shared/adapters/sources/bath/manifest.ts";
import { rssItems } from "../../supabase/functions/_shared/adapters/sources/bath/rss.ts";
import { mapItem } from "../../supabase/functions/_shared/adapters/sources/bath/mapping.ts";
import { bytes } from "../../supabase/functions/_shared/domain/primitives.ts";
import {
  CernAdapter,
  items as cernItems,
} from "../../supabase/functions/_shared/adapters/sources/cern/adapter.ts";
import { cernManifest } from "../../supabase/functions/_shared/adapters/sources/cern/manifest.ts";
import { mapCernItem } from "../../supabase/functions/_shared/adapters/sources/cern/mapping.ts";

const fixture = await Deno.readTextFile("tests/fixtures/bath/research.xml");
const item = /<item>[\s\S]*?<\/item>/.exec(fixture)![0];
let upper = '<rss version="2.0"><channel><title>University of Bath jobs</title>';
for (let i = 0; i < 40; i++) {
  upper += item.replaceAll("SS14039", `SS${20000 + i}`).replace(
    "</item>",
    `<benchmark>${"x".repeat(11000)}</benchmark></item>`,
  );
}

const cernFeed = await Deno.readTextFile("tests/fixtures/cern/students.xml"),
  cernHtml = await Deno.readTextFile("tests/fixtures/cern/internship.html");
const cernFixtureItems = [...cernFeed.matchAll(/<item>[\s\S]*?<\/item>/g)].map((m) => m[0]);
const firstCernItem = cernFixtureItems[0];
let upperFeed = `<rss version="2.0"><channel><title>careers.cern</title>${
  firstCernItem.repeat(9) + cernFixtureItems[1]
}</channel></rss>`;
upperFeed = upperFeed.replace(
  "</channel>",
  `<!--${"x".repeat(cernManifest.maxFeedBytes - bytes(upperFeed) - 7)}--></channel>`,
);
const upperHtml = cernHtml.replace(
  "<body>",
  `<body><!--${"x".repeat(cernManifest.maxDetailBytes - bytes(cernHtml) - 7)}-->`,
);
for (
  const [name, feed, detail] of [["sanitized-facts", cernFeed, cernHtml], [
    "synthetic-upper-bound",
    upperFeed,
    upperHtml,
  ]]
) {
  const parse: number[] = [], mapping: number[] = [], before = Deno.memoryUsage();
  let count = 0;
  const page = {
    payload: JSON.stringify({ schemaVersion: 1, feed, detail, detailError: null, page: 0 }),
    format: "cern-rss-envelope-v1",
    sourceUrl: cernManifest.feeds[0],
    fetchedAt: "2026-10-29T00:00:00Z",
    sourceRevision: null,
    validators: {},
    nextCursor: null,
    notModified: false,
  };
  for (let i = 0; i < 30; i++) {
    const start = performance.now(), rows = cernItems(feed);
    parse.push(performance.now() - start);
    const ms = performance.now();
    rows.map((r) => mapCernItem(r, page, detail, null));
    mapping.push(performance.now() - ms);
    count = rows.length;
    if ([...new CernAdapter().parsePage(page)].length !== count) {
      throw new Error("CERN benchmark mismatch");
    }
  }
  const after = Deno.memoryUsage();
  console.log(JSON.stringify({
    source: cernManifest.slug,
    name,
    feedBytes: bytes(feed),
    detailBytes: bytes(detail),
    envelopeBytes: bytes(page.payload),
    records: count,
    parseMaxMs: Math.max(...parse),
    parseMeanMs: parse.reduce((a, b) => a + b, 0) / parse.length,
    mappingMaxMs: Math.max(...mapping),
    rssBefore: before.rss,
    rssAfter: after.rss,
    heapUsedBefore: before.heapUsed,
    heapUsedAfter: after.heapUsed,
    requestsPerTask: 2,
    detailRequestsPerTask: 1,
    maxRequestsPerRun: 12,
    workUnit: "one ten-item RSS page; one fixed internship detail at most; local memory proxies",
  }));
}
upper += "</channel></rss>";
// Explicit synthetic padding at the reviewed maximum; no full advertisement is vendored.
upper = upper.replace(
  "</channel>",
  `<!--${"x".repeat(bathManifest.maxBytes - bytes(upper) - 7)}--></channel>`,
);
for (const [name, payload] of [["sanitized-facts", fixture], ["synthetic-upper-bound", upper]]) {
  const parse: number[] = [], mapping: number[] = [], before = Deno.memoryUsage();
  let records = 0, accepted = 0;
  for (let i = 0; i < 30; i++) {
    const start = performance.now(), rows = rssItems(payload);
    parse.push(performance.now() - start);
    const page = {
      payload,
      sourceUrl: bathManifest.endpoint,
      fetchedAt: "2026-10-29T00:00:00Z",
      sourceRevision: null,
      validators: {},
      format: "rss",
      notModified: false,
      nextCursor: null,
    };
    const mapStart = performance.now(), mapped = rows.map((row) => mapItem(row, page));
    mapping.push(performance.now() - mapStart);
    records = mapped.length;
    accepted = mapped.filter((r) => r.kind === "record").length;
    if ([...new BathAdapter().parsePage(page)].length !== records) {
      throw new Error("benchmark parser mismatch");
    }
  }
  const after = Deno.memoryUsage();
  console.log(JSON.stringify({
    source: bathManifest.slug,
    name,
    payloadBytes: bytes(payload),
    records,
    accepted,
    parseMaxMs: Math.max(...parse),
    parseMeanMs: parse.reduce((a, b) => a + b, 0) / parse.length,
    mappingMaxMs: Math.max(...mapping),
    rssBefore: before.rss,
    rssAfter: after.rss,
    heapUsedBefore: before.heapUsed,
    heapUsedAfter: after.heapUsed,
    requests: 1,
    detailRequests: 0,
    workUnit: "one bounded feed; maximum 512 KiB / 40 items; local memory proxy, not hosted peak",
  }));
}
