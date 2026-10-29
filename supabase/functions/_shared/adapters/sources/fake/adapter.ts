import {
  type CollectContext,
  type CollectedPage,
  collectionLimits,
  ProcessingError,
  type SourceAdapter,
} from "../../../application/ports.ts";
import {
  type DeadlineDraft,
  type IdentityEvidence,
  type ObjectValue,
  opportunityTypes,
  type ParsedRecord,
  type RecordError,
  type Value,
} from "../../../domain/model.ts";
import { boundedObject, bytes } from "../../../domain/primitives.ts";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export class FakeSourceAdapter implements SourceAdapter {
  readonly parserVersion = "fake-json-v1";
  readonly supportedTypes = opportunityTypes;
  constructor(readonly slug = "fake") {}
  // deno-lint-ignore require-await -- memory transport implements the asynchronous source port.
  async collectPage(
    context: CollectContext,
    cursor: Value,
    validators: ObjectValue,
  ): Promise<CollectedPage> {
    context.signal.throwIfAborted();
    const config = context.source.config;
    if (config.fault === "timeout") throw new ProcessingError("transport_timeout", true);
    if (config.fault === "503") throw new ProcessingError("transport_unavailable", true, 60);
    if (config.fault === "401") throw new ProcessingError("transport_unauthorized");
    if (
      !Array.isArray(config.pages) || config.pages.length < 1 || config.pages.length > 20 ||
      typeof config.revision !== "string" || config.revision.length > 128
    ) throw new ProcessingError("invalid_fake_configuration");
    const page = cursor === null
      ? 0
      : object(cursor) && Number.isSafeInteger(cursor.page)
      ? Number(cursor.page)
      : -1;
    if (page < 0 || page >= config.pages.length || typeof config.pages[page] !== "string") {
      throw new ProcessingError("invalid_fake_cursor");
    }
    const payload = config.pages[page] as string;
    if (bytes(payload) > context.limits.maxBytes) throw new ProcessingError("response_too_large");
    const notModified = page === 0 && validators.etag === config.revision;
    return {
      payload: notModified ? "" : payload,
      format: "json",
      fetchedAt: context.clock.now(),
      sourceRevision: config.revision,
      sourceUrl: `https://fixtures.example.invalid/${this.slug}/page/${page}`,
      validators: { etag: config.revision },
      notModified,
      nextCursor: notModified || page + 1 >= config.pages.length ? null : { page: page + 1 },
    };
  }
  *parsePage(page: CollectedPage): Iterable<ParsedRecord | RecordError> {
    if (bytes(page.payload) > collectionLimits.maxBytes) {
      throw new ProcessingError("response_too_large");
    }
    let data: unknown;
    try {
      data = JSON.parse(page.payload);
    } catch {
      throw new ProcessingError("document_parse_failed");
    }
    if (!object(data) || data.schema_version !== 1 || !Array.isArray(data.items)) {
      throw new ProcessingError("document_shape_changed");
    }
    if (data.items.length > 100) throw new ProcessingError("page_record_limit");
    for (const item of data.items) {
      let recordKey: string | null = null;
      try {
        if (!object(item) || typeof item.id !== "string" || !item.id.trim()) {
          throw new Error("record");
        }
        recordKey = `fake-v1:${item.id}`;
        if (
          typeof item.heading !== "string" || typeof item.category !== "string" ||
          typeof item.link !== "string"
        ) throw new Error("required");
        const optionalText = (name: string): string | null => {
          if (item[name] == null) return null;
          if (typeof item[name] !== "string") throw new Error("optional");
          return item[name] as string;
        };
        const array = (name: string): string[] => {
          const value = item[name] ?? [];
          if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
            throw new Error("optional");
          }
          return value;
        };
        const calls = item.calls ?? [];
        if (!Array.isArray(calls) || calls.some((v) => !object(v))) throw new Error("calls");
        const deadlines: DeadlineDraft[] = calls.map((v) => {
          if (
            typeof v.kind !== "string" || typeof v.label !== "string" ||
            v.round != null && typeof v.round !== "string" ||
            v.value != null && typeof v.value !== "string" ||
            v.zone != null && typeof v.zone !== "string"
          ) throw new Error("deadline");
          return {
            kind: v.kind as DeadlineDraft["kind"],
            label: v.label,
            roundKey: v.round ?? null,
            value: v.value ?? null,
            timezone: v.zone ?? null,
            basis: v.zone_basis === "source_default" ? "source_default" : "explicit",
            aoeSupported: v.aoe_supported === true,
          };
        });
        const attributes = item.attributes ?? { schema_version: 1 };
        boundedObject(attributes, 8192);
        const identities: IdentityEvidence[] = item.reviewed_listing === true
          ? [{ kind: "listing_url", value: item.link, reviewed: true, listingSpecific: true }]
          : [];
        yield {
          kind: "record",
          sourceRecordKey: recordKey,
          sourceUrl: item.link,
          metadata: { fixture_format: "fake-json-v1" },
          draft: {
            type: item.category,
            title: item.heading,
            organization: optionalText("provider"),
            description: optionalText("summary"),
            topics: array("subjects"),
            qualificationTags: array("qualifications"),
            countryCodes: array("countries"),
            locationText: optionalText("place"),
            workMode: optionalText("work_mode"),
            canonicalUrl: optionalText("official_url"),
            publishedAt: optionalText("published"),
            cycleKey: optionalText("edition"),
            trackKey: optionalText("track"),
            eventStart: optionalText("event_start"),
            eventEnd: optionalText("event_end"),
            status: optionalText("state") ?? "unknown",
            attributes,
            deadlines,
            identities,
          },
        };
      } catch {
        yield { kind: "error", sourceRecordKey: recordKey, code: "malformed_record" };
      }
    }
  }
}
