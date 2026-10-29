import { assert, equals, rejects } from "../support.ts";
import { ProcessingError } from "../../supabase/functions/_shared/application/ports.ts";
import { context, response } from "../ccfddl_support.ts";
import { OpenreviewCallAdapter } from "../../supabase/functions/_shared/adapters/sources/openreview/adapter.ts";
import { openreviewManifest } from "../../supabase/functions/_shared/adapters/sources/openreview/manifest.ts";
import {
  approvedEndpoints,
  approvedSources,
} from "../../supabase/functions/_shared/adapters/sources/registry.ts";

const fixture = (name: string) =>
  Deno.readTextFile(new URL(`../fixtures/openreview/${name}`, import.meta.url));
Deno.test("reviewed registry has three narrow paths across two providers and all phase types", () => {
  const adapters = new Map(
    [...approvedSources()].filter(([slug]) =>
      ["ccfddl", "ccfddl-hotos", "openreview-workshop-call"].includes(slug)
    ),
  );
  equals([...adapters.keys()], ["ccfddl", "ccfddl-hotos", "openreview-workshop-call"]);
  assert(approvedEndpoints.length >= 3);
  equals([...new Set([...adapters.values()].flatMap((a) => [...a.supportedTypes]))].sort(), [
    "conference",
    "conference_cfp",
    "workshop",
  ]);
});
Deno.test("scoped API fetch and conditional replay are bounded and errors cannot look empty", async () => {
  const adapter = new OpenreviewCallAdapter(), body = await fixture("invitation.json");
  const ctx = context({ ...response(body), contentType: "application/json" });
  const first = await adapter.collectPage(ctx, null, {});
  assert(first.sourceRevision?.length === 64);
  equals(first.sourceUrl, openreviewManifest.endpoint);
  const cached = context({ ...response("", 304), contentType: "application/json" });
  assert((await adapter.collectPage(cached, null, first.validators)).notModified);
  await rejects(() => adapter.collectPage(cached, null, {}), "invalid_not_modified_response");
  await rejects(() => adapter.collectPage(ctx, { page: 1 }, {}), "invalid_source_cursor");
  for (const status of [400, 403, 429, 503]) {
    await rejects(
      () => adapter.collectPage(context(response("", status)), null, {}),
      "source_http_failed",
    );
  }
  await rejects(
    () => adapter.collectPage(context(response(body)), null, {}),
    "source_content_type",
  );
  await rejects(
    () =>
      adapter.collectPage(
        context({ ...response("x".repeat(65537)), contentType: "application/json" }),
        null,
        {},
      ),
    "response_too_large",
  );
});
Deno.test("OpenReview fixture provenance is sanitized public metadata with reproducible checksum", async () => {
  const manifest = JSON.parse(await fixture("manifest.json"));
  equals(manifest.original_url, openreviewManifest.endpoint);
  const body = await fixture("invitation.json");
  const hash = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body.replaceAll("\r\n", "\n")),
      ),
    ),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
  equals(hash, manifest.sha256_lf);
  assert(
    !body.includes("@") && !body.includes("instructions") && !body.includes("users_to_notify"),
  );
});

Deno.test("public API rate response remains a retryable source failure with bounded retry delay", async () => {
  const adapter = new OpenreviewCallAdapter();
  try {
    await adapter.collectPage(
      context({ ...response("", 429), headers: { "retry-after": "120" } }),
      null,
      {},
    );
    throw new Error("rate response unexpectedly succeeded");
  } catch (error) {
    assert(error instanceof ProcessingError && error.retryable && error.retryAfter === 120);
  }
});
