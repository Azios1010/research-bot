import { assert, equals, rejects } from "../support.ts";
import { adapter, context, fixture, page, records, response } from "../ccfddl_support.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { ccfddlManifest } from "../../supabase/functions/_shared/adapters/sources/ccfddl/manifest.ts";

Deno.test("copied fixtures pin revision, license and LF-normalized SHA256", async () => {
  const manifest = JSON.parse(await fixture("manifest.json"));
  equals(manifest.revision, ccfddlManifest.upstreamRevision);
  equals(manifest.parser_version, adapter.parserVersion);
  assert((await fixture("LICENSE")).includes("Copyright (c) 2021 CCFDDL"));
  for (const [name, value] of Object.entries(manifest.files)) {
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode((await fixture(name)).replaceAll("\r\n", "\n")),
        ),
      ),
    ].map((b) => b.toString(16).padStart(2, "0")).join("");
    equals(hash, (value as { sha256_lf: string }).sha256_lf, `fixture checksum ${name}`);
  }
});

Deno.test("CCFDDL fetch uses fixed bounded endpoint and conditional GET only with committed revision", async () => {
  const ctx = context(response(await fixture()));
  let request;
  const original = ctx.http.request;
  ctx.http.request = (r) => {
    request = r;
    return original(r);
  };
  const first = await adapter.collectPage(ctx, null, {});
  assert(first.sourceRevision?.length === 64);
  equals(request!.url, ccfddlManifest.endpoint);
  equals(request!.maxBytes, 16384);
  equals(request!.timeoutMs, 15000);
  ctx.http = context(response("", 304)).http;
  const unchanged = await adapter.collectPage(ctx, null, first.validators);
  assert(unchanged.notModified);
  equals(unchanged.sourceRevision, first.sourceRevision);
  await rejects(() => adapter.collectPage(ctx, null, {}), "invalid_not_modified_response");
  await rejects(() => adapter.collectPage(ctx, { page: 2 }, {}), "invalid_source_cursor");
});
Deno.test("HTTP failure, unexpected content type and oversize never become empty success", async () => {
  for (const status of [401, 404, 429, 503]) {
    await rejects(
      () => adapter.collectPage(context(response("", status)), null, {}),
      "source_http_failed",
    );
  }
  await rejects(
    () => adapter.collectPage(context({ ...response("[]"), contentType: "text/html" }), null, {}),
    "source_content_type",
  );
  await rejects(
    () => adapter.collectPage(context(response("x".repeat(16385))), null, {}),
    "response_too_large",
  );
  const http = new BoundedHttpClient(
    [ccfddlManifest.endpoint],
    (() =>
      Promise.resolve(
        new Response("x".repeat(16385), { headers: { "content-type": "text/plain" } }),
      )) as typeof fetch,
  );
  await rejects(
    () => adapter.collectPage({ ...context(response("")), http }, null, {}),
    "response_too_large",
  );
});
Deno.test("pure parser is deterministic, bounded and keeps document revision out of stable keys", async () => {
  const payload = await fixture();
  equals([...adapter.parsePage(page(payload))], [...adapter.parsePage(page(payload))]);
  const items = records(payload);
  assert(items.every((r) => JSON.stringify(r.metadata).length < 2048));
  const changed = payload.replace("2026-10-17 23:59:59", "2026-10-20 23:59:59");
  equals(records(changed).map((r) => r.sourceRecordKey), items.map((r) => r.sourceRecordKey));
});
