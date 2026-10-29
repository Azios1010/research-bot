import { fundingFixtures, fundingPage } from "../../tests/grants_support.ts";
import { grantsManifest as m } from "../../supabase/functions/_shared/adapters/sources/grantsgov/manifest.ts";
import {
  apiData,
  publicDetail,
  publicHit,
  searchData,
} from "../../supabase/functions/_shared/adapters/sources/grantsgov/json.ts";
import { mapFunding } from "../../supabase/functions/_shared/adapters/sources/grantsgov/mapping.ts";
import { GrantsAdapter } from "../../supabase/functions/_shared/adapters/sources/grantsgov/adapter.ts";
import { bytes } from "../../supabase/functions/_shared/domain/primitives.ts";

function padded(value: unknown, maximum: number) {
  const object = { ...(value as Record<string, unknown>), benchmark_padding: "" };
  object.benchmark_padding = "x".repeat(maximum - bytes(JSON.stringify(object)));
  const result = JSON.stringify(object);
  if (bytes(result) !== maximum) throw new Error("benchmark bound mismatch");
  return result;
}
const fixtures = await fundingFixtures();
for (const upper of [false, true]) {
  const inputs = fixtures.map((f) => ({
    search: upper ? padded(f.search, m.maxSearchBytes) : JSON.stringify(f.search),
    detail: upper ? padded(f.detail, m.maxDetailBytes) : JSON.stringify(f.detail),
  }));
  const parse: number[] = [], map: number[] = [], before = Deno.memoryUsage();
  let projectionBytes = 0;
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const records = inputs.map((f) => ({
      hit: publicHit(searchData(f.search, m.maxSearchBytes).hits[0]),
      detail: publicDetail(apiData(f.detail, m.maxDetailBytes)),
      error: null,
    }));
    parse.push(performance.now() - start);
    const page = {
      ...fundingPage(fixtures),
      payload: JSON.stringify({ schemaVersion: 1, records, scope: [{}, {}] }),
    };
    projectionBytes = bytes(page.payload);
    const at = performance.now(), rows = records.map((r) => mapFunding(r, page));
    map.push(performance.now() - at);
    if (
      rows.some((r) => r.kind !== "record") || [...new GrantsAdapter().parsePage(page)].length !== 2
    ) {
      throw new Error("funding benchmark mapping mismatch");
    }
  }
  const after = Deno.memoryUsage();
  console.log(
    JSON.stringify({
      source: m.slug,
      name: upper ? "synthetic-upper-bound" : "sanitized-factual-fields",
      searchBytes: inputs.map((i) => bytes(i.search)),
      detailBytes: inputs.map((i) => bytes(i.detail)),
      totalDecodedBytes: inputs.reduce((n, i) => n + bytes(i.search) + bytes(i.detail), 0),
      projectionBytes,
      records: 2,
      parseMaxMs: Math.max(...parse),
      parseMeanMs: parse.reduce((a, b) => a + b, 0) / parse.length,
      mappingMaxMs: Math.max(...map),
      rssBefore: before.rss,
      rssAfter: after.rss,
      heapUsedBefore: before.heapUsed,
      heapUsedAfter: after.heapUsed,
      requestsPerTask: 4,
      detailRequestsPerTask: 2,
      maxPages: 1,
      workUnit:
        "latest one NSF/ST/research G and one CA; bounded raw input stripped before parser framing; local memory proxy, not hosted peak",
    }),
  );
}
