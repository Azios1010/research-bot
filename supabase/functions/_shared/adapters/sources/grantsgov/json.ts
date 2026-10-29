import { ProcessingError } from "../../../application/ports.ts";
import { bytes } from "../../../domain/primitives.ts";
export const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function apiData(body: string, maxBytes: number): Record<string, unknown> {
  if (bytes(body) > maxBytes) throw new ProcessingError("response_too_large");
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    throw new ProcessingError("document_parse_failed");
  }
  if (!object(envelope) || envelope.errorcode !== 0 || !object(envelope.data)) {
    throw new ProcessingError("source_api_error");
  }
  return envelope.data;
}
export function searchData(body: string, maxBytes: number) {
  const data = apiData(body, maxBytes);
  if (
    !Array.isArray(data.oppHits) || data.oppHits.length > 1 || !Number.isInteger(data.hitCount) ||
    Number(data.hitCount) < data.oppHits.length || data.startRecord !== 0
  ) throw new ProcessingError("document_shape_changed");
  return { hits: data.oppHits, hitCount: Number(data.hitCount) };
}
function document(value: unknown): unknown {
  if (!object(value)) return value ?? null;
  const fields = [
    "agencyCode",
    "agencyName",
    "postingDateStr",
    "responseDateStr",
    "responseDateDesc",
    "applicantEligibilityDesc",
    "version",
    "estApplicationResponseDateStr",
    "fiscalYear",
    "fundingDescLinkUrl",
  ];
  const kept = Object.fromEntries(
    fields.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
  );
  for (const field of ["applicantTypes", "fundingInstruments", "fundingActivityCategories"]) {
    const list = value[field];
    kept[field] = Array.isArray(list)
      ? list.map((item) => object(item) ? { id: item.id, description: item.description } : item)
      : list ?? null;
  }
  return kept;
}
// Transport projection strips credentials, contacts, attachments and unrelated raw prose BEFORE framing.
export function publicDetail(data: Record<string, unknown>) {
  const fields = [
    "id",
    "revision",
    "opportunityNumber",
    "opportunityTitle",
    "owningAgencyCode",
    "docType",
  ];
  return {
    ...Object.fromEntries(fields.map((k) => [k, data[k]])),
    synopsis: document(data.synopsis),
    forecast: document(data.forecast),
  };
}
export function publicHit(value: unknown): unknown {
  if (!object(value)) return value;
  return Object.fromEntries(
    [
      "id",
      "number",
      "title",
      "agencyCode",
      "agency",
      "openDate",
      "closeDate",
      "oppStatus",
      "docType",
    ].filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
  );
}
