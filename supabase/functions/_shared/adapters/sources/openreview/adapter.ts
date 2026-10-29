import {
  type CollectContext,
  type CollectedPage,
  ProcessingError,
  type SourceAdapter,
} from "../../../application/ports.ts";
import type { ObjectValue, ParsedRecord, RecordError, Value } from "../../../domain/model.ts";
import { bytes, digest } from "../../../domain/primitives.ts";
import { openreviewManifest as manifest } from "./manifest.ts";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export class OpenreviewCallAdapter implements SourceAdapter {
  readonly slug = manifest.slug;
  readonly parserVersion = manifest.parserVersion;
  readonly supportedTypes = ["conference_cfp"] as const;
  async collectPage(
    context: CollectContext,
    cursor: Value,
    validators: ObjectValue,
  ): Promise<CollectedPage> {
    if (cursor !== null) throw new ProcessingError("invalid_source_cursor");
    const headers: Record<string, string> = { accept: "application/json" };
    const revision =
      typeof validators.revision === "string" && /^[a-f0-9]{64}$/.test(validators.revision)
        ? validators.revision
        : null;
    if (revision && typeof validators.etag === "string" && validators.etag.length <= 512) {
      headers["if-none-match"] = validators.etag;
    }
    const response = await context.http.request({
      url: manifest.endpoint,
      method: "GET",
      headers,
      signal: context.signal,
      maxBytes: Math.min(manifest.maxBytes, context.limits.maxBytes),
      timeoutMs: Math.min(manifest.timeoutMs, context.limits.timeoutMs),
    });
    const base = {
      format: "json",
      sourceUrl: manifest.endpoint,
      fetchedAt: context.clock.now(),
      nextCursor: null,
    };
    if (response.status === 304) {
      if (!revision || !headers["if-none-match"] || response.body) {
        throw new ProcessingError("invalid_not_modified_response");
      }
      return { ...base, payload: "", sourceRevision: revision, notModified: true, validators };
    }
    if (response.status !== 200) {
      const retryable = [408, 429].includes(response.status) || response.status >= 500;
      const delay = /^\d{1,5}$/.test(response.headers["retry-after"] ?? "")
        ? Math.min(3600, Number(response.headers["retry-after"]))
        : 60;
      throw new ProcessingError(
        "source_http_failed",
        retryable,
        retryable ? delay : 0,
      );
    }
    if (!/^application\/json(?:;|$)/i.test(response.contentType ?? "")) {
      throw new ProcessingError("source_content_type");
    }
    if (bytes(response.body) > manifest.maxBytes) throw new ProcessingError("response_too_large");
    const sourceRevision = await digest([this.parserVersion, response.body]);
    const next: ObjectValue = { revision: sourceRevision };
    if (response.headers.etag && response.headers.etag.length <= 512) {
      next.etag = response.headers.etag;
    }
    return {
      ...base,
      payload: response.body,
      sourceRevision,
      validators: next,
      notModified: false,
    };
  }
  *parsePage(page: CollectedPage): Iterable<ParsedRecord | RecordError> {
    if (bytes(page.payload) > manifest.maxBytes) throw new ProcessingError("response_too_large");
    let data: unknown;
    try {
      data = JSON.parse(page.payload);
    } catch {
      throw new ProcessingError("document_parse_failed");
    }
    if (!object(data) || !Array.isArray(data.invitations) || "error" in data || "name" in data) {
      throw new ProcessingError("document_shape_changed");
    }
    if (data.invitations.length > manifest.maxRecords) {
      throw new ProcessingError("page_record_limit");
    }
    if (data.count != null && data.count !== data.invitations.length) {
      throw new ProcessingError("document_shape_changed");
    }
    for (const item of data.invitations) {
      const sourceRecordKey = object(item) && item.id === manifest.invitationId
        ? `openreview-invitation-v1:${manifest.invitationId}`
        : null;
      try {
        if (
          !object(item) || !sourceRecordKey || !Array.isArray(item.readers) ||
          !item.readers.includes("everyone") ||
          item.nonreaders != null && (!Array.isArray(item.nonreaders) || item.nonreaders.length > 0)
        ) throw new ProcessingError("unapproved_invitation");
        if (item.ddate != null) throw new ProcessingError("withdrawn_invitation");
        const epoch = (value: unknown): number | null => {
          if (value == null) return null;
          if (
            !Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 8640000000000000
          ) throw new ProcessingError("malformed_deadline");
          return Number(value);
        };
        const due = epoch(item.duedate);
        const metadata: ObjectValue = {
          source_revision: page.sourceRevision,
          invitation_id: manifest.invitationId,
          cdate: epoch(item.cdate),
          mdate: epoch(item.mdate),
          expdate: epoch(item.expdate),
          license: "CC0 metadata",
          attribution: "OpenReview / ICLR 2027 Workshop Proposals",
        };
        yield {
          kind: "record",
          sourceRecordKey,
          sourceUrl: manifest.endpoint,
          metadata,
          draft: {
            type: "conference_cfp",
            title: manifest.title,
            canonicalUrl: manifest.officialUrl,
            organization: null,
            publishedAt: null,
            topics: ["machine learning"],
            countryCodes: [],
            workMode: "unknown",
            cycleKey: manifest.cycleKey,
            trackKey: manifest.trackKey,
            status: "unknown",
            attributes: {
              openreview: {
                invitation_id: manifest.invitationId,
                call_kind: "workshop_proposals",
                deadline_semantics: "api_submission_cutoff",
              },
            },
            deadlines: [{
              kind: "submission",
              roundKey: "workshop-proposals",
              label: "OpenReview proposal submission cutoff; confirm official call",
              value: due === null ? null : new Date(due).toISOString(),
              timezone: "UTC",
              basis: due === null ? "unknown" : "explicit",
            }],
            identities: [{
              kind: "listing_url",
              value: manifest.officialUrl,
              reviewed: true,
              listingSpecific: true,
            }],
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
