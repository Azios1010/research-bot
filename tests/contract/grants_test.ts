import { assert, equals, rejects } from "../support.ts";
import {
  fundingContext,
  fundingFixtures,
  fundingTransport,
  grantFixture,
  jsonResponse,
} from "../grants_support.ts";
import { GrantsAdapter } from "../../supabase/functions/_shared/adapters/sources/grantsgov/adapter.ts";
import { grantsManifest as m } from "../../supabase/functions/_shared/adapters/sources/grantsgov/manifest.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { digest } from "../../supabase/functions/_shared/domain/primitives.ts";
import { sourceRetryAfter } from "../../supabase/functions/_shared/adapters/sources/shared/retry.ts";
Deno.test("funding collection uses only four bounded public read POSTs and strips token/contact fields", async () => {
  const fixtures = await fundingFixtures();
  fixtures[0].detail.token = "discarded-test-value";
  fixtures[0].detail.data.publisherUid = "discarded-test-value";
  fixtures[0].detail.data.synopsis.agencyContactEmail = "discarded-test-value";
  let requests = 0;
  const transport = fundingTransport(fixtures),
    http = new BoundedHttpClient([m.search, m.detail], (...args) => {
      requests++;
      return transport(...args);
    }, [m.search, m.detail]),
    ctx = fundingContext(http.request.bind(http));
  const page = await new GrantsAdapter().collectPage(ctx, null, {});
  equals(requests, 4);
  assert(!page.payload.includes("discarded-test-value"));
  equals([...new GrantsAdapter().parsePage(page)].filter((r) => r.kind === "record").length, 2);
  await rejects(
    () => new GrantsAdapter().collectPage(ctx, { page: 2 }, {}),
    "invalid_source_cursor",
  );
});
Deno.test("funding API failure invalid JSON drift content type oversized input and 304 cannot be empty success", async () => {
  const adapter = new GrantsAdapter();
  for (const body of ["no-json", '{"errorcode":1,"data":{}}', '{"errorcode":0,"data":{}}']) {
    await rejects(() =>
      adapter.collectPage(fundingContext(() => Promise.resolve(jsonResponse(body))), null, {})
    );
  }
  for (const status of [304, 403, 429, 503]) {
    await rejects(() =>
      adapter.collectPage(
        fundingContext(() => Promise.resolve(jsonResponse("", status))),
        null,
        {},
      ), "source_http_failed");
  }
  await rejects(
    () =>
      adapter.collectPage(
        fundingContext(() => Promise.resolve({ ...jsonResponse("{}"), contentType: "text/html" })),
        null,
        {},
      ),
    "source_content_type",
  );
  await rejects(
    () =>
      adapter.collectPage(
        fundingContext(() => Promise.resolve(jsonResponse("x".repeat(m.maxSearchBytes + 1)))),
        null,
        {},
      ),
    "response_too_large",
  );
  const empty = await adapter.collectPage(
    fundingContext(() =>
      Promise.resolve(
        jsonResponse('{"errorcode":0,"data":{"oppHits":[],"hitCount":0,"startRecord":0}}'),
      )
    ),
    null,
    {},
  );
  equals([...adapter.parsePage(empty)], []);
});
Deno.test("funding fixture provenance pins public factual API fields without response token or contacts", async () => {
  const manifest = JSON.parse(await grantFixture("manifest.json"));
  equals(manifest.parser_version, m.parserVersion);
  for (const file of manifest.files) {
    const text = (await grantFixture(file.path)).replaceAll("\r\n", "\n");
    equals(await digest(text), file.sha256_canonical_string);
    assert(!/"(?:token|agencyContactEmail|publisherUid)"/.test(text));
  }
});
Deno.test("source retry hints honor bounded seconds and dates without uncontrolled retries", () => {
  const now = "2026-10-29T00:00:00Z";
  equals(sourceRetryAfter("600", now), 600);
  equals(sourceRetryAfter("999999", now), 86400);
  equals(sourceRetryAfter("Thu, 29 Oct 2026 00:05:00 GMT", now), 300);
  equals(sourceRetryAfter("invalid", now), 60);
});
Deno.test("funding pure document drift fails visibly while malformed identity preserves its valid sibling", async () => {
  const adapter = new GrantsAdapter();
  const { fundingPage } = await import("../grants_support.ts");
  const fixtures = await fundingFixtures(), page = fundingPage(fixtures);
  for (
    const payload of [
      "not-json",
      '{"schemaVersion":2,"records":[],"scope":[{},{}]}',
      '{"schemaVersion":1,"records":{}}',
    ]
  ) {
    await rejects(() => [...adapter.parsePage({ ...page, payload })]);
  }
  fixtures[0].detail.data.opportunityTitle = 42;
  equals([...adapter.parsePage(fundingPage(fixtures))].map((r) => r.kind), ["error", "record"]);
});
