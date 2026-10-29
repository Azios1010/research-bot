import { assert, equals, rejects } from "../support.ts";
import { CernAdapter } from "../../supabase/functions/_shared/adapters/sources/cern/adapter.ts";
import { cernManifest as m } from "../../supabase/functions/_shared/adapters/sources/cern/manifest.ts";
import {
  type CollectContext,
  collectionLimits,
  type HttpResponse,
  ProcessingError,
} from "../../supabase/functions/_shared/application/ports.ts";
import { digest } from "../../supabase/functions/_shared/domain/primitives.ts";
const fixture = (name: string) =>
  Deno.readTextFile(new URL(`../fixtures/cern/${name}`, import.meta.url));
const response = (body: string, status = 200, type = "application/rss+xml"): HttpResponse => ({
  body,
  status,
  contentType: type,
  headers: {},
});
const ctx = (request: CollectContext["http"]["request"]): CollectContext => ({
  source: {
    id: "s",
    slug: m.slug,
    enabled: true,
    approved: true,
    parserVersion: m.parserVersion,
    configVersion: 1,
    config: {},
  },
  clock: { now: () => "2026-10-29T00:00:00Z" },
  http: { request },
  signal: new AbortController().signal,
  limits: collectionLimits,
});
Deno.test("malformed internship heading cannot fail transport planning for a valid doctoral sibling", async () => {
  const feed = (await fixture("students.xml")).replace(
    "<title>Short-Term Internship</title>",
    "<title/>",
  );
  let requests = 0;
  const adapter = new CernAdapter(),
    page = await adapter.collectPage(
      ctx(() => {
        requests++;
        return Promise.resolve(response(feed));
      }),
      null,
      {},
    );
  equals(requests, 1);
  equals([...adapter.parsePage(page)].map((r) => r.kind), ["record", "error", "error"]);
});
Deno.test("CERN request path is fixed, two requests maximum, no ATS navigation, bounded durable pagination", async () => {
  const adapter = new CernAdapter(),
    feed = await fixture("students.xml"),
    html = await fixture("internship.html"),
    seen: string[] = [];
  const context = ctx((r) => {
    seen.push(r.url);
    assert(r.signal);
    equals(r.timeoutMs, 15000);
    return Promise.resolve(
      r.url === m.internshipUrl ? response(html, 200, "text/html") : response(feed),
    );
  });
  const page = await adapter.collectPage(context, null, {});
  equals(seen, [m.feeds[0], m.internshipUrl]);
  equals(page.sourceRevision, null);
  equals(page.nextCursor, null);
  const item = /<item>[\s\S]*?<\/item>/.exec(feed)![0],
    full = `<rss version="2.0"><channel><title>careers.cern</title>${
      item.repeat(10)
    }</channel></rss>`;
  equals(
    (await adapter.collectPage(ctx(() => Promise.resolve(response(full))), null, {})).nextCursor,
    { page: 1 },
  );
  await rejects(
    () => adapter.collectPage(ctx(() => Promise.resolve(response(full))), { page: 5 }, {}),
    "source_page_limit",
  );
  await rejects(() => adapter.collectPage(context, { page: 6 }, {}), "invalid_source_cursor");
  await rejects(
    () => adapter.collectPage(ctx(() => Promise.resolve(response("", 304))), null, {}),
    "source_http_failed",
  );
});
Deno.test("CERN transport/document/detail failures are distinct and bounded, never successful empty", async () => {
  const adapter = new CernAdapter(), feed = await fixture("students.xml");
  for (const status of [403, 429, 500]) {
    await rejects(
      () => adapter.collectPage(ctx(() => Promise.resolve(response("", status))), null, {}),
      "source_http_failed",
    );
  }
  await rejects(
    () =>
      adapter.collectPage(
        ctx(() => Promise.reject(new ProcessingError("transport_timeout", true))),
        null,
        {},
      ),
    "transport_timeout",
  );
  await rejects(
    () =>
      adapter.collectPage(
        ctx(() => Promise.resolve(response("<html/>", 200, "text/html"))),
        null,
        {},
      ),
    "source_content_type",
  );
  await rejects(
    () => adapter.collectPage(ctx(() => Promise.resolve(response("x".repeat(65537)))), null, {}),
    "response_too_large",
  );
  await rejects(
    () => adapter.collectPage(ctx(() => Promise.resolve(response("<rss>bad"))), null, {}),
    "document_parse_failed",
  );
  const page = await adapter.collectPage(
    ctx((r) => Promise.resolve(r.url === m.internshipUrl ? response("", 503) : response(feed))),
    null,
    {},
  );
  const rows = [...adapter.parsePage(page)];
  assert(rows[0].kind === "record");
  equals((rows[1] as { code: string }).code, "detail_http_failed");
});
Deno.test("CERN fixture manifest binds rewritten historical and observed facts without raw adverts", async () => {
  const manifest = JSON.parse(await fixture("manifest.json"));
  equals(manifest.parser_version, m.parserVersion);
  for (const f of manifest.files) {
    const text = (await fixture(f.path)).replaceAll("\r\n", "\n");
    equals(await digest(text), f.sha256_canonical_string);
    assert(!text.includes("@"));
  }
});
