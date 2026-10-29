import {
  type CollectContext,
  type CollectedPage,
  ProcessingError,
  type SourceAdapter,
} from "../../../application/ports.ts";
import type { ObjectValue, ParsedRecord, RecordError, Value } from "../../../domain/model.ts";
import { bytes, digest } from "../../../domain/primitives.ts";
import { grantsManifest as manifest } from "./manifest.ts";
import { apiData, object, publicDetail, publicHit, searchData } from "./json.ts";
import { mapFunding } from "./mapping.ts";
import { sourceRetryAfter } from "../shared/retry.ts";

export class GrantsAdapter implements SourceAdapter {
  readonly slug = manifest.slug;
  readonly parserVersion = manifest.parserVersion;
  readonly supportedTypes = manifest.supportedTypes;
  async collectPage(
    context: CollectContext,
    cursor: Value,
    _validators: ObjectValue,
  ): Promise<CollectedPage> {
    if (cursor !== null) throw new ProcessingError("invalid_source_cursor");
    const timeout = Math.min(context.limits.timeoutMs, manifest.timeoutMs),
      signal = AbortSignal.any([context.signal, AbortSignal.timeout(timeout)]);
    const read = async (url: string, body: Record<string, unknown>, maxBytes: number) => {
      const r = await context.http.request({
        url,
        method: "POST",
        body: JSON.stringify(body),
        headers: { accept: "application/json" },
        maxBytes,
        timeoutMs: timeout,
        signal,
      });
      if (r.status !== 200) {
        throw new ProcessingError(
          "source_http_failed",
          r.status === 429 || r.status >= 500,
          sourceRetryAfter(r.headers["retry-after"], context.clock.now()),
        );
      }
      if (!/^application\/json(?:;|$)/i.test(r.contentType ?? "")) {
        throw new ProcessingError("source_content_type");
      }
      return r.body;
    };
    const records: unknown[] = [], scope: unknown[] = [];
    for (const instrument of manifest.scope.instruments) {
      const result = searchData(
        await read(manifest.search, {
          rows: 1,
          keyword: manifest.scope.keyword,
          fundingCategories: manifest.scope.category,
          oppStatuses: "posted|forecasted",
          fundingInstruments: instrument,
          agencies: manifest.scope.agency,
          sortBy: "openDate|desc",
        }, manifest.maxSearchBytes),
        manifest.maxSearchBytes,
      );
      scope.push({ instrument, hitCount: result.hitCount, selected: result.hits.length });
      for (const hit of result.hits) {
        let detail: unknown = null, error: string | null = null;
        const id = object(hit) && /^\d{1,10}$/.test(String(hit.id)) ? Number(hit.id) : null;
        if (id === null) error = "funding_identity_missing";
        else {try {
            detail = publicDetail(
              apiData(
                await read(manifest.detail, { opportunityId: id }, manifest.maxDetailBytes),
                manifest.maxDetailBytes,
              ),
            );
          } catch (failure) {
            error = failure instanceof ProcessingError ? failure.code : "detail_fetch_failed";
          }}
        records.push({ hit: publicHit(hit), detail, error });
      }
    }
    const payload = JSON.stringify({ schemaVersion: 1, records, scope });
    if (bytes(payload) > Math.min(manifest.maxBytes, context.limits.maxBytes)) {
      throw new ProcessingError("response_too_large");
    }
    return {
      payload,
      format: "grants-projection-v1",
      sourceUrl: manifest.search,
      sourceRevision: await digest([this.parserVersion, payload]),
      fetchedAt: context.clock.now(),
      validators: {},
      nextCursor: null,
      notModified: false,
    };
  }
  *parsePage(page: CollectedPage): Iterable<ParsedRecord | RecordError> {
    if (bytes(page.payload) > manifest.maxBytes) throw new ProcessingError("response_too_large");
    let document: unknown;
    try {
      document = JSON.parse(page.payload);
    } catch {
      throw new ProcessingError("document_parse_failed");
    }
    if (
      !object(document) || document.schemaVersion !== 1 || !Array.isArray(document.records) ||
      document.records.length > manifest.maxRecords || !Array.isArray(document.scope) ||
      document.scope.length !== 2
    ) throw new ProcessingError("document_shape_changed");
    for (const item of document.records) yield mapFunding(item, page);
  }
}
