import type {
  CollectContext,
  CollectedPage,
  HttpResponse,
} from "../supabase/functions/_shared/application/ports.ts";
import { collectionLimits } from "../supabase/functions/_shared/application/ports.ts";
import { grantsManifest as m } from "../supabase/functions/_shared/adapters/sources/grantsgov/manifest.ts";
export const grantFixture = (name: string) =>
  Deno.readTextFile(new URL(`./fixtures/grantsgov/${name}`, import.meta.url));
export async function fundingFixtures() {
  return await Promise.all(
    ["G", "CA"].map(async (code) => ({
      code,
      search: JSON.parse(await grantFixture(`search-${code}.json`)),
      detail: JSON.parse(await grantFixture(`detail-${code}.json`)),
    })),
  );
}
export type FundingFixtures = Awaited<ReturnType<typeof fundingFixtures>>;
export function fundingTransport(fixtures: FundingFixtures): typeof fetch {
  return (input, init) => {
    const body = JSON.parse(String(init?.body)),
      item = String(input) === m.search
        ? fixtures.find((f) => f.code === body.fundingInstruments)
        : fixtures.find((f) => f.detail.data.id === body.opportunityId);
    if (!item) throw new Error("unexpected fixture request");
    return Promise.resolve(
      new Response(JSON.stringify(String(input) === m.search ? item.search : item.detail), {
        headers: { "content-type": "application/json" },
      }),
    );
  };
}
export function fundingPage(fixtures: FundingFixtures): CollectedPage {
  return {
    payload: JSON.stringify({
      schemaVersion: 1,
      records: fixtures.map((f) => ({
        hit: f.search.data.oppHits[0],
        detail: f.detail.data,
        error: null,
      })),
      scope: fixtures.map((f) => ({
        instrument: f.code,
        hitCount: f.search.data.hitCount,
        selected: 1,
      })),
    }),
    sourceUrl: m.search,
    format: "grants-projection-v1",
    fetchedAt: "2026-10-29T00:00:00Z",
    sourceRevision: "a".repeat(64),
    validators: {},
    notModified: false,
    nextCursor: null,
  };
}
export function fundingContext(request: CollectContext["http"]["request"]): CollectContext {
  return {
    source: {
      id: "s",
      slug: m.slug,
      enabled: true,
      approved: true,
      parserVersion: m.parserVersion,
      configVersion: 1,
      config: {},
    },
    http: { request },
    clock: { now: () => "2026-10-29T00:00:00Z" },
    signal: new AbortController().signal,
    limits: collectionLimits,
  };
}
export const jsonResponse = (body: string, status = 200): HttpResponse => ({
  body,
  status,
  contentType: "application/json",
  headers: {},
});
