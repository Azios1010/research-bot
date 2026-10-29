import {
  type CollectContext,
  type CollectedPage,
  ProcessingError,
  type SourceAdapter,
} from "../../../application/ports.ts";
import type { ObjectValue, ParsedRecord, RecordError, Value } from "../../../domain/model.ts";
import { bytes, digest } from "../../../domain/primitives.ts";
import { bathManifest as manifest } from "./manifest.ts";
import { rssItems } from "./rss.ts";
import { mapItem } from "./mapping.ts";
import { sourceRetryAfter } from "../shared/retry.ts";

export class BathAdapter implements SourceAdapter {
  readonly slug = manifest.slug;
  readonly parserVersion = manifest.parserVersion;
  readonly supportedTypes = manifest.supportedTypes;
  async collectPage(
    context: CollectContext,
    cursor: Value,
    validators: ObjectValue,
  ): Promise<CollectedPage> {
    if (cursor !== null) throw new ProcessingError("invalid_source_cursor");
    const headers: Record<string, string> = {
      accept: "application/rss+xml, text/xml, application/xml",
    };
    const revision =
      typeof validators.revision === "string" && /^[a-f0-9]{64}$/.test(validators.revision)
        ? validators.revision
        : null;
    if (revision && typeof validators.etag === "string" && validators.etag.length <= 512) {
      headers["if-none-match"] = validators.etag;
    } else if (
      revision && typeof validators.last_modified === "string" &&
      validators.last_modified.length <= 128
    ) headers["if-modified-since"] = validators.last_modified;
    const r = await context.http.request({
      url: manifest.endpoint,
      method: "GET",
      headers,
      signal: context.signal,
      maxBytes: Math.min(manifest.maxBytes, context.limits.maxBytes),
      timeoutMs: Math.min(manifest.timeoutMs, context.limits.timeoutMs),
    });
    const base = {
      format: "rss",
      sourceUrl: manifest.endpoint,
      fetchedAt: context.clock.now(),
      nextCursor: null,
    };
    if (r.status === 304) {
      if (!revision || !(headers["if-none-match"] || headers["if-modified-since"]) || r.body) {
        throw new ProcessingError("invalid_not_modified_response");
      }
      return { ...base, payload: "", sourceRevision: revision, validators, notModified: true };
    }
    if (r.status !== 200) {
      throw new ProcessingError(
        "source_http_failed",
        [408, 429].includes(r.status) || r.status >= 500,
        sourceRetryAfter(r.headers["retry-after"], context.clock.now()),
      );
    }
    if (!/^(text\/xml|application\/(rss\+xml|xml))(?:;|$)/i.test(r.contentType ?? "")) {
      throw new ProcessingError("source_content_type");
    }
    if (bytes(r.body) > manifest.maxBytes) throw new ProcessingError("response_too_large");
    const sourceRevision = await digest([this.parserVersion, r.body]),
      next: ObjectValue = { revision: sourceRevision };
    if (r.headers.etag && r.headers.etag.length <= 512) next.etag = r.headers.etag;
    if (r.headers["last-modified"] && r.headers["last-modified"].length <= 128) {
      next.last_modified = r.headers["last-modified"];
    }
    return { ...base, payload: r.body, sourceRevision, validators: next, notModified: false };
  }
  *parsePage(page: CollectedPage): Iterable<ParsedRecord | RecordError> {
    for (const item of rssItems(page.payload)) yield mapItem(item, page);
  }
}
