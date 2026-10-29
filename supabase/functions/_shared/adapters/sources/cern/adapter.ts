import {
  type CollectContext,
  type CollectedPage,
  ProcessingError,
  type SourceAdapter,
} from "../../../application/ports.ts";
import type { ObjectValue, ParsedRecord, RecordError, Value } from "../../../domain/model.ts";
import { bytes, digest } from "../../../domain/primitives.ts";
import { object, plain, rssItems } from "../shared/rss.ts";
import { cernManifest as manifest } from "./manifest.ts";
import { mapCernItem } from "./mapping.ts";
import { sourceRetryAfter } from "../shared/retry.ts";

export function items(feed: string) {
  return rssItems(feed, {
    maxBytes: manifest.maxFeedBytes,
    maxRecords: manifest.maxRecords,
    titleContains: "careers.cern",
  });
}
export class CernAdapter implements SourceAdapter {
  readonly slug = manifest.slug;
  readonly parserVersion = manifest.parserVersion;
  readonly supportedTypes = manifest.supportedTypes;
  async collectPage(
    context: CollectContext,
    cursor: Value,
    _validators: ObjectValue,
  ): Promise<CollectedPage> {
    const index = cursor === null
      ? 0
      : object(cursor) && Object.keys(cursor).join(",") === "page" && Number.isInteger(cursor.page)
      ? Number(cursor.page)
      : -1;
    if (index < 0 || index >= manifest.maxPages) throw new ProcessingError("invalid_source_cursor");
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(manifest.timeoutMs)]),
      sourceUrl = manifest.feeds[index];
    const r = await context.http.request({
      url: sourceUrl,
      method: "GET",
      headers: { accept: "application/rss+xml" },
      timeoutMs: manifest.timeoutMs,
      maxBytes: manifest.maxFeedBytes,
      signal,
    });
    if (r.status !== 200) {
      throw new ProcessingError(
        "source_http_failed",
        [408, 429].includes(r.status) || r.status >= 500,
        sourceRetryAfter(r.headers["retry-after"], context.clock.now()),
      );
    }
    if (!/^application\/(?:rss\+xml|xml)(?:;|$)/i.test(r.contentType ?? "")) {
      throw new ProcessingError("source_content_type");
    }
    const rows = items(r.body);
    let detail: string | null = null, detailError: string | null = null;
    if (
      rows.some((row) => {
        if (!object(row) || row.link !== manifest.internshipUrl) return false;
        try {
          return plain(row.title, 1024) === "Short-Term Internship";
        } catch {
          return false;
        } // A malformed sibling is a parser disposition, not a document failure.
      })
    ) {
      try {
        const d = await context.http.request({
          url: manifest.internshipUrl,
          method: "GET",
          headers: { accept: "text/html" },
          timeoutMs: manifest.timeoutMs,
          maxBytes: manifest.maxDetailBytes,
          signal,
        });
        if (d.status !== 200) throw new ProcessingError("detail_http_failed");
        if (!/^text\/html(?:;|$)/i.test(d.contentType ?? "")) {
          throw new ProcessingError("detail_content_type");
        }
        if (bytes(d.body) > manifest.maxDetailBytes) {
          throw new ProcessingError("response_too_large");
        }
        detail = d.body;
      } catch (error) {
        detailError = error instanceof ProcessingError ? error.code : "detail_fetch_failed";
      }
    }
    if (rows.length === manifest.maxRecords && index === manifest.maxPages - 1) {
      throw new ProcessingError("source_page_limit");
    }
    const payload = JSON.stringify({
      schemaVersion: 1,
      feed: r.body,
      detail,
      detailError,
      page: index,
    });
    if (bytes(payload) > manifest.maxBytes || bytes(payload) > context.limits.maxBytes) {
      throw new ProcessingError("response_too_large");
    }
    return {
      payload,
      sourceUrl,
      format: "cern-rss-envelope-v1",
      sourceRevision: null,
      fetchedAt: context.clock.now(),
      validators: { document_hash: await digest([this.parserVersion, payload]) },
      notModified: false,
      nextCursor: rows.length === manifest.maxRecords ? { page: index + 1 } : null,
    };
  }
  *parsePage(page: CollectedPage): Iterable<ParsedRecord | RecordError> {
    if (bytes(page.payload) > manifest.maxBytes) throw new ProcessingError("response_too_large");
    let envelope: unknown;
    try {
      envelope = JSON.parse(page.payload);
    } catch {
      throw new ProcessingError("document_parse_failed");
    }
    if (
      !object(envelope) || envelope.schemaVersion !== 1 || typeof envelope.feed !== "string" ||
      !(envelope.detail === null || typeof envelope.detail === "string") ||
      !(envelope.detailError === null || typeof envelope.detailError === "string") ||
      !Number.isInteger(envelope.page)
    ) throw new ProcessingError("document_shape_changed");
    for (const item of items(envelope.feed)) {
      yield mapCernItem(
        item,
        page,
        envelope.detail as string | null,
        envelope.detailError as string | null,
      );
    }
  }
}
