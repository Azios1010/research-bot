import {
  type CollectContext,
  type CollectedPage,
  ProcessingError,
  type SourceAdapter,
} from "../../../application/ports.ts";
import type { ObjectValue, ParsedRecord, RecordError, Value } from "../../../domain/model.ts";
import { bytes, digest } from "../../../domain/primitives.ts";
import { ccfddlManifest, type ConferenceManifest } from "./manifest.ts";
import { mapEdition, object } from "./mapping.ts";
import { safeYaml } from "./yaml.ts";

export class CcfddlAdapter implements SourceAdapter {
  readonly slug: string;
  readonly parserVersion = ccfddlManifest.parserVersion;
  readonly supportedTypes;
  constructor(readonly manifest: ConferenceManifest = ccfddlManifest) {
    this.slug = manifest.slug;
    this.supportedTypes = [manifest.type];
  }
  async collectPage(
    context: CollectContext,
    cursor: Value,
    validators: ObjectValue,
  ): Promise<CollectedPage> {
    if (cursor !== null) throw new ProcessingError("invalid_source_cursor");
    const headers: Record<string, string> = { accept: "text/plain, application/yaml, text/yaml" };
    const priorRevision =
      typeof validators.revision === "string" && /^[a-f0-9]{64}$/.test(validators.revision)
        ? validators.revision
        : null;
    if (priorRevision) {
      if (typeof validators.etag === "string" && validators.etag.length <= 512) {
        headers["if-none-match"] = validators.etag;
      } else if (
        typeof validators.last_modified === "string" && validators.last_modified.length <= 128
      ) headers["if-modified-since"] = validators.last_modified;
    }
    const response = await context.http.request({
      url: this.manifest.endpoint,
      method: "GET",
      headers,
      timeoutMs: Math.min(context.limits.timeoutMs, this.manifest.timeoutMs),
      maxBytes: Math.min(context.limits.maxBytes, this.manifest.maxBytes),
      signal: context.signal,
    });
    if (response.status === 304) {
      if (
        !priorRevision || !(headers["if-none-match"] || headers["if-modified-since"]) ||
        response.body
      ) throw new ProcessingError("invalid_not_modified_response");
      return {
        payload: "",
        format: "yaml",
        sourceUrl: this.manifest.endpoint,
        fetchedAt: context.clock.now(),
        sourceRevision: priorRevision,
        validators,
        notModified: true,
        nextCursor: null,
      };
    }
    if (response.status !== 200) {
      const retryable = [408, 429].includes(response.status) || response.status >= 500;
      const delay = /^\d{1,5}$/.test(response.headers["retry-after"] ?? "")
        ? Math.min(3600, Number(response.headers["retry-after"]))
        : 60;
      throw new ProcessingError("source_http_failed", retryable, retryable ? delay : 0);
    }
    if (
      !/^(text\/plain|application\/(?:x-)?yaml|text\/(?:x-)?yaml)(?:;|$)/i.test(
        response.contentType ?? "",
      )
    ) throw new ProcessingError("source_content_type");
    if (bytes(response.body) > this.manifest.maxBytes) {
      throw new ProcessingError("response_too_large");
    }
    const revision = await digest([this.parserVersion, response.body]);
    const nextValidators: ObjectValue = { revision };
    if (response.headers.etag && response.headers.etag.length <= 512) {
      nextValidators.etag = response.headers.etag;
    }
    if (response.headers["last-modified"] && response.headers["last-modified"].length <= 128) {
      nextValidators.last_modified = response.headers["last-modified"];
    }
    return {
      payload: response.body,
      format: "yaml",
      sourceUrl: this.manifest.endpoint,
      fetchedAt: context.clock.now(),
      sourceRevision: revision,
      nextCursor: null,
      validators: nextValidators,
      notModified: false,
    };
  }
  *parsePage(page: CollectedPage): Iterable<ParsedRecord | RecordError> {
    const data = safeYaml(page.payload, this.manifest.maxBytes);
    if (!Array.isArray(data) || data.length > 1) {
      throw new ProcessingError("document_shape_changed");
    }
    if (!data.length) return; // Explicit empty sequence only. Empty body/null is not success.
    const series = data[0];
    if (
      !object(series) || series.title !== this.manifest.series ||
      series.sub !== this.manifest.category || typeof series.description !== "string" ||
      !object(series.rank) || typeof series.dblp !== "string" || !Array.isArray(series.confs)
    ) throw new ProcessingError("document_shape_changed");
    if (series.confs.length > this.manifest.maxRecords) {
      throw new ProcessingError("page_record_limit");
    }
    for (const edition of series.confs) {
      const id =
        object(edition) && typeof edition.id === "string" && /^[a-z0-9'-]{1,120}$/.test(edition.id)
          ? edition.id
          : null;
      const sourceRecordKey = id ? `ccfddl-v1:${series.sub}:${series.title}:${id}:main` : null;
      try {
        if (!object(edition) || !id) throw new ProcessingError("malformed_record");
        const draft = mapEdition(series, edition, this.manifest);
        yield {
          kind: "record",
          sourceRecordKey: sourceRecordKey!,
          sourceUrl: page.sourceUrl,
          draft,
          metadata: {
            upstream_path: this.manifest.upstreamPath,
            source_revision: page.sourceRevision,
            schema: "CCFDDL-3.0.X",
          },
        };
      } catch (error) {
        yield {
          kind: "error",
          sourceRecordKey,
          code: error instanceof ProcessingError ? error.code : "malformed_record",
        };
      }
    }
  }
}
