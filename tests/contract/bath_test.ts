import { assert, equals, rejects } from "../support.ts";
import { BathAdapter } from "../../supabase/functions/_shared/adapters/sources/bath/adapter.ts";
import { bathManifest } from "../../supabase/functions/_shared/adapters/sources/bath/manifest.ts";
import {
  type CollectContext,
  collectionLimits,
  type HttpResponse,
} from "../../supabase/functions/_shared/application/ports.ts";
const fixture = (name: string) =>
  Deno.readTextFile(new URL(`../fixtures/bath/${name}`, import.meta.url));
const context = (r: HttpResponse): CollectContext => ({
  source: {
    id: "s",
    slug: bathManifest.slug,
    enabled: true,
    approved: true,
    parserVersion: bathManifest.parserVersion,
    configVersion: 1,
    config: {},
  },
  clock: { now: () => "2026-10-29T00:00:00Z" },
  http: { request: () => Promise.resolve(r) },
  limits: collectionLimits,
  signal: new AbortController().signal,
});
const response = (body: string, status = 200): HttpResponse => ({
  body,
  status,
  contentType: "text/xml; charset=utf-8",
  headers: { etag: '"fixture"' },
});
Deno.test("Bath fixture provenance is factual sanitized metadata with reproducible license and checksum evidence", async () => {
  const manifest = JSON.parse(await fixture("manifest.json")), body = await fixture("research.xml");
  equals(manifest.parser_version, bathManifest.parserVersion);
  const hash = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body.replaceAll("\r\n", "\n")),
      ),
    ),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
  equals(hash, manifest.sha256_lf);
  assert(!body.includes("@"));
});
Deno.test("Bath transport uses a bounded fixed feed with no per-record navigation and safe validators", async () => {
  const adapter = new BathAdapter(), ctx = context(response(await fixture("research.xml")));
  let requests = 0;
  ctx.http.request = (request) => {
    requests++;
    equals(request.url, bathManifest.endpoint);
    equals(request.maxBytes, 524288);
    equals(request.timeoutMs, 15000);
    return Promise.resolve(response("[]"));
  };
  const first = await adapter.collectPage(ctx, null, {});
  equals(requests, 1);
  assert(first.sourceRevision?.length === 64);
  const cached = await adapter.collectPage(context(response("", 304)), null, first.validators);
  assert(cached.notModified);
  equals(cached.payload, "");
  await rejects(
    () => adapter.collectPage(context(response("", 304)), null, {}),
    "invalid_not_modified_response",
  );
  await rejects(() => adapter.collectPage(ctx, { page: 1 }, {}), "invalid_source_cursor");
  for (const status of [401, 403, 429, 503]) {
    await rejects(
      () => adapter.collectPage(context(response("", status)), null, {}),
      "source_http_failed",
    );
  }
  await rejects(
    () => adapter.collectPage(context({ ...response("x"), contentType: "text/html" }), null, {}),
    "source_content_type",
  );
  await rejects(
    () => adapter.collectPage(context(response("x".repeat(524289))), null, {}),
    "response_too_large",
  );
});
