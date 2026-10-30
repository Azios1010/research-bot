import {
  type CollectContext,
  type CollectedPage,
  ProcessingError,
  type SourceAdapter,
} from "../../../application/ports.ts";
import type { ObjectValue, ParsedRecord, RecordError, Value } from "../../../domain/model.ts";
import { bytes, digest } from "../../../domain/primitives.ts";
import { type Card, cards, journalContext } from "./html.ts";
import { mapCall } from "./mapping.ts";
import { jeacsManifest as m } from "./manifest.ts";
import { sourceRetryAfter } from "../shared/retry.ts";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export class JeacsAdapter implements SourceAdapter {
  readonly slug = m.slug;
  readonly parserVersion = m.parserVersion;
  readonly supportedTypes = m.supportedTypes;
  async collectPage(
    context: CollectContext,
    cursor: Value,
    _validators: ObjectValue,
  ): Promise<CollectedPage> {
    if (cursor !== null) throw new ProcessingError("invalid_source_cursor");
    const signal = AbortSignal.any([
      context.signal,
      AbortSignal.timeout(Math.min(m.timeoutMs, context.limits.timeoutMs)),
    ]);
    const read = async (url: string, maxBytes: number) => {
      const r = await context.http.request({
        url,
        method: "GET",
        headers: { accept: "text/html" },
        maxBytes,
        timeoutMs: m.timeoutMs,
        signal,
      });
      if (r.status !== 200) {
        throw new ProcessingError(
          "source_http_failed",
          [408, 429].includes(r.status) || r.status >= 500,
          sourceRetryAfter(r.headers["retry-after"], context.clock.now()),
        );
      }
      if (!/^text\/html(?:;|$)/i.test(r.contentType ?? "")) {
        throw new ProcessingError("source_content_type");
      }
      if (bytes(r.body) > maxBytes) throw new ProcessingError("response_too_large");
      return r.body;
    };
    const html = await read(m.endpoint, m.maxDirectoryBytes),
      policy = await read(m.policyUrl, m.maxPolicyBytes);
    let detail: string | null = null, detailError: string | null = null;
    if (cards(html).some((c) => c.id === m.detailId)) {
      try {
        detail = await read(m.detailUrl, m.maxDetailBytes);
      } catch (e) {
        detailError = e instanceof ProcessingError ? e.code : "detail_fetch_failed";
      }
    }
    const payload = JSON.stringify({
      schemaVersion: 1,
      documentUrl: m.endpoint,
      html,
      policy,
      detail,
      detailError,
    });
    if (bytes(payload) > Math.min(m.maxBytes, context.limits.maxBytes)) {
      throw new ProcessingError("response_too_large");
    }
    return {
      payload,
      format: "jeacs-html-v1",
      sourceUrl: m.endpoint,
      fetchedAt: context.clock.now(),
      sourceRevision: await digest([m.parserVersion, payload]),
      nextCursor: null,
      validators: {},
      notModified: false,
    };
  }
  *parsePage(page: CollectedPage): Iterable<ParsedRecord | RecordError> {
    if (bytes(page.payload) > m.maxBytes) throw new ProcessingError("response_too_large");
    let d: unknown;
    try {
      d = JSON.parse(page.payload);
    } catch {
      throw new ProcessingError("document_parse_failed");
    }
    if (
      !object(d) || d.schemaVersion !== 1 || typeof d.documentUrl !== "string" ||
      typeof d.html !== "string" || typeof d.policy !== "string" ||
      !(d.detail === null || typeof d.detail === "string") ||
      !(d.detailError === null || typeof d.detailError === "string")
    ) throw new ProcessingError("document_shape_changed");
    const journal = journalContext(d.policy),
      parsed = cards(d.html, d.documentUrl),
      groups = new Map<string, typeof parsed>();
    let details: Card[] = [], detailError = d.detailError as string | null;
    if (d.detail !== null) {
      try {
        details = cards(d.detail, m.detailUrl);
        if (details.length !== 1) throw new ProcessingError("detail_shape_changed");
      } catch (error) {
        detailError = error instanceof ProcessingError ? error.code : "detail_shape_changed";
      }
    }
    for (const [i, c] of parsed.entries()) {
      const k = c.id ? (m.aliases[c.id] ?? c.id) : `malformed:${i}`;
      const group = groups.get(k) ?? [];
      group.push(c);
      groups.set(k, group);
    }
    for (const [k, group] of groups) {
      yield mapCall(
        group,
        journal,
        page,
        k === m.detailId ? details[0] ?? null : null,
        k === m.detailId ? detailError : null,
      );
    }
  }
}
