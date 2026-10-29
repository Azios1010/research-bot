import { assert, equals, fixture, rejects } from "../support.ts";
import { FakeSourceAdapter } from "../../supabase/functions/_shared/adapters/sources/fake/adapter.ts";
import {
  type CollectContext,
  type CollectedPage,
  collectionLimits,
} from "../../supabase/functions/_shared/application/ports.ts";
import { opportunityTypes } from "../../supabase/functions/_shared/domain/model.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { stable } from "../../supabase/functions/_shared/domain/primitives.ts";
const adapter = new FakeSourceAdapter();
Deno.test("fixture manifest records owned provenance and reproducible checksums", async () => {
  const manifest = JSON.parse(await fixture("manifest.json"));
  equals(manifest.original_url, null);
  equals(manifest.parser_version, adapter.parserVersion);
  for (const file of manifest.files) {
    const bytes = new TextEncoder().encode((await fixture(file)).replaceAll("\r\n", "\n"));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    equals(hash, manifest.checksums[file], `fixture checksum ${file}`);
  }
});
const page = (payload: string): CollectedPage => ({
  payload,
  sourceUrl: "https://fixtures.example.invalid/fake",
  fetchedAt: "2031-01-01T00:00:00Z",
  sourceRevision: "v1",
  nextCursor: null,
  validators: {},
  format: "json",
  notModified: false,
});
const context = (pages: string[]): CollectContext => ({
  source: {
    id: "s",
    slug: "fake",
    parserVersion: adapter.parserVersion,
    configVersion: 1,
    enabled: true,
    approved: true,
    config: { pages, revision: "v1" },
  },
  limits: collectionLimits,
  clock: { now: () => "2031-01-01T00:00:00Z" },
  signal: new AbortController().signal,
  http: {
    request: () => {
      throw new Error("fake adapter must never fetch");
    },
  },
});

Deno.test("synthetic fixture normalizes every supported type through the same pure parser", async () => {
  const source = await fixture("all-types.json"), records = [...adapter.parsePage(page(source))];
  equals(records.length, 11);
  const found: string[] = [];
  for (const record of records) {
    assert(record.kind === "record");
    found.push((await normalize(record.draft)).fields.type);
    assert(record.sourceRecordKey.startsWith("fake-v1:"));
  }
  equals(found.sort(), [...opportunityTypes].sort());
  equals(
    stable(JSON.parse(JSON.stringify(records))),
    stable(JSON.parse(JSON.stringify([...adapter.parsePage(page(source))]))),
  );
});
Deno.test("mixed siblings and duplicate source keys remain visible to page accounting", async () => {
  const records = [...adapter.parsePage(page(await fixture("mixed.json")))];
  equals(records.map((r) => r.kind), ["record", "error", "record", "record"]);
  equals(records[0].sourceRecordKey, records[3].sourceRecordKey);
  equals(records[1].sourceRecordKey, "fake-v1:malformed-b");
});
Deno.test("valid empty document differs from malformed JSON or changed source shape", async () => {
  await rejects(() => [...adapter.parsePage(page(" ".repeat(2097153)))], "response_too_large");
  equals([...adapter.parsePage(page(await fixture("empty.json")))], []);
  for (const body of ["{bad", '{"records":[]}', '{"schema_version":2,"items":[]}']) {
    await rejects(() => [...adapter.parsePage(page(body))]);
  }
  await rejects(
    () => [
      ...adapter.parsePage(page(JSON.stringify({ schema_version: 1, items: Array(101).fill({}) }))),
    ],
    "page_record_limit",
  );
});
Deno.test("optional fields cannot inject metadata or invalid producer shapes", () => {
  const records = [...adapter.parsePage(page(JSON.stringify({
    schema_version: 1,
    items: [
      {
        id: "a",
        category: "phd",
        heading: "Fixture",
        link: "https://example.invalid/a",
        unexpected: { raw: "x".repeat(20000) },
      },
      {
        id: "b",
        category: "phd",
        heading: "Fixture",
        link: "https://example.invalid/b",
        subjects: "wrong",
      },
    ],
  })))];
  assert(records[0].kind === "record");
  equals(records[0].metadata, { fixture_format: "fake-json-v1" });
  equals(records[1].kind, "error");
});
Deno.test("collection pages, revision validators and source keys are deterministic without internet", async () => {
  const ctx = context([await fixture("mixed.json"), await fixture("empty.json")]);
  const first = await adapter.collectPage(ctx, null, {});
  equals(first.nextCursor, { page: 1 });
  equals((await adapter.collectPage(ctx, first.nextCursor, first.validators)).nextCursor, null);
  const unchanged = await adapter.collectPage(ctx, null, first.validators);
  assert(unchanged.notModified);
  equals(unchanged.payload, "");
  const aborted = new AbortController();
  aborted.abort();
  await rejects(() => adapter.collectPage({ ...ctx, signal: aborted.signal }, null, {}));
});
