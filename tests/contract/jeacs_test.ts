import { assert, equals, rejects } from "../support.ts";
import {
  article,
  directory,
  journalContext,
  journalFixture,
  journalFixtures,
  journalPage,
  journalTransport,
} from "../jeacs_support.ts";
import { JeacsAdapter } from "../../supabase/functions/_shared/adapters/sources/jeacs/adapter.ts";
import { jeacsManifest as m } from "../../supabase/functions/_shared/adapters/sources/jeacs/manifest.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { digest } from "../../supabase/functions/_shared/domain/primitives.ts";
import { ProcessingError } from "../../supabase/functions/_shared/application/ports.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
Deno.test("journal collection is three fixed bounded GETs with shared deadline and no source-controlled enrichment", async () => {
  const f = await journalFixtures(),
    calls: string[] = [],
    transport = journalTransport(f),
    http = new BoundedHttpClient([m.endpoint, m.policyUrl, m.detailUrl], (u, i) => {
      calls.push(String(u));
      equals(i?.method, "GET");
      return transport(u, i);
    });
  const a = new JeacsAdapter(), page = await a.collectPage(journalContext(http), null, {});
  equals(calls, [m.endpoint, m.policyUrl, m.detailUrl]);
  equals(page.nextCursor, null);
  equals(page.notModified, false);
  equals([...a.parsePage(page)].length, 5);
  await rejects(
    () => a.collectPage(journalContext(http), { page: 2 }, {}),
    "invalid_source_cursor",
  );
  f.html = directory(article(f.html, "174"));
  calls.length = 0;
  await a.collectPage(journalContext(http), null, {});
  equals(calls, [m.endpoint, m.policyUrl]);
});
Deno.test("journal document transport and policy failures are not empty successes or unbounded retries", async () => {
  const a = new JeacsAdapter(), f = await journalFixtures();
  for (const status of [304, 403, 429, 503]) {
    const http = {
      request: () =>
        Promise.resolve({
          status,
          body: "",
          contentType: "text/html",
          headers: { "retry-after": "600" },
        }),
    };
    await rejects(() => a.collectPage(journalContext(http), null, {}), "source_http_failed");
  }
  for (const code of ["transport_timeout", "response_too_large"]) {
    await rejects(() =>
      a.collectPage(
        journalContext({
          request: () => {
            throw new ProcessingError(code, true);
          },
        }),
        null,
        {},
      ), code);
  }
  await rejects(
    () =>
      a.collectPage(
        journalContext({
          request: () =>
            Promise.resolve({
              status: 200,
              body: "{}",
              contentType: "application/json",
              headers: {},
            }),
        }),
        null,
        {},
      ),
    "source_content_type",
  );
  const page = journalPage(f);
  for (
    const payload of [
      "no-json",
      '{"schemaVersion":2}',
      page.payload.replace("page_announcements", "changed_new_layout"),
    ]
  ) await rejects(() => [...a.parsePage({ ...page, payload })]);
  await rejects(
    () => [...a.parsePage(journalPage({ ...f, policy: "<html>unknown publisher</html>" }))],
    "policy_shape_changed",
  );
});
Deno.test("one fixed detail failure or removed stale detail preserves valid author-call siblings", async () => {
  const a = new JeacsAdapter(),
    f = await journalFixtures(),
    base = journalTransport(f),
    http = new BoundedHttpClient(
      [m.endpoint, m.policyUrl, m.detailUrl],
      (u, i) =>
        String(u) === m.detailUrl
          ? Promise.resolve(new Response("gone", { status: 404 }))
          : base(u, i),
    );
  const page = await a.collectPage(journalContext(http), null, {}), rows = [...a.parsePage(page)];
  equals(rows.filter((r) => r.kind === "record").length, 2);
  assert(
    rows.some((r) =>
      r.kind === "error" && r.sourceRecordKey === "jeacs-v1:announcement:230" &&
      r.code === "source_http_failed"
    ),
  );
  f.detail = f.detail.replace(/<h1>[\s\S]*?<\/h1>/, "<h1>Published collection</h1>");
  assert(
    [...a.parsePage(journalPage(f))].some((r) =>
      r.kind === "error" && r.code === "stale_directory_entry"
    ),
  );
  f.detail = "<html><h1>New detail layout</h1></html>";
  const drift = [...a.parsePage(journalPage(f))];
  equals(drift.filter((r) => r.kind === "record").length, 2);
  assert(drift.some((r) => r.kind === "error" && r.code === "document_shape_changed"));
  const timeout = new BoundedHttpClient([m.endpoint, m.policyUrl, m.detailUrl], (u, i) => {
    if (String(u) === m.detailUrl) throw new ProcessingError("transport_timeout", true);
    return base(u, i);
  });
  const timed = [...a.parsePage(await a.collectPage(journalContext(timeout), null, {}))];
  equals(timed.filter((r) => r.kind === "record").length, 2);
  assert(timed.some((r) => r.kind === "error" && r.code === "transport_timeout"));
});
Deno.test("malformed sibling unsafe original URL and unexpected executable markup are isolated", async () => {
  const a = new JeacsAdapter(), f = await journalFixtures();
  f.html = f.html.replace(
    'href="https://journals.univie.ac.at/index.php/jeacs/announcement/view/224"',
    'href="javascript:alert(1)"',
  );
  const rows = [...a.parsePage(journalPage(f))];
  equals(rows.filter((r) => r.kind === "record").length, 3);
  assert(rows.some((r) => r.kind === "error" && r.code === "malformed_record"));
  f.detail = f.detail.replace(
    "<ul>",
    '<script>bad()</script><iframe src="https://unreviewed.invalid"></iframe><ul>',
  );
  const valid = [...a.parsePage(journalPage(f))].find((r) => r.kind === "record");
  assert(valid?.kind === "record");
  assert(!JSON.stringify(await normalize(valid.draft)).includes("bad()"));
});
Deno.test("HTML and framed budgets reject size tokens depth and entity declarations before unsafe work", async () => {
  const a = new JeacsAdapter(), f = await journalFixtures();
  await rejects(
    () => [...a.parsePage({ ...journalPage(f), payload: "x".repeat(m.maxBytes + 1) })],
    "response_too_large",
  );
  for (
    const html of [
      "<b>".repeat(m.maxTags + 1),
      "<div>".repeat(m.maxDepth + 5) + f.html + "</div>".repeat(m.maxDepth + 5),
      '<!ENTITY x SYSTEM "https://evil.invalid">' + f.html,
    ]
  ) {
    await rejects(() => [...a.parsePage(journalPage({ ...f, html }))]);
  }
  const empty = journalPage({
    ...f,
    html:
      '<div class="page_announcements"><h1>Announcements</h1><p>No announcements have been published.</p></div>',
    detail: null,
  });
  equals([...a.parsePage(empty)], []);
});
Deno.test("fixture provenance retains license links transformations and reproducible LF string checksums", async () => {
  const manifest = JSON.parse(await journalFixture("manifest.json"));
  equals(manifest.parser_version, m.parserVersion);
  assert(manifest.license_url.includes("creativecommons.org/licenses/by/4.0"));
  for (const file of manifest.files) {
    const body = (await journalFixture(file.path)).replaceAll("\r\n", "\n");
    equals(await digest(body), file.sha256_canonical_string);
    assert(!/mailto:|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(body));
  }
});
