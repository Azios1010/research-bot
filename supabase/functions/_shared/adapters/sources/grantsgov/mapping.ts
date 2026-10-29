import type { CollectedPage } from "../../../application/ports.ts";
import { ProcessingError } from "../../../application/ports.ts";
import type { ParsedRecord, RecordError, Value } from "../../../domain/model.ts";
import { dateOnly } from "../../../domain/temporal.ts";
import { bytes, safeUrl } from "../../../domain/primitives.ts";
import { plain } from "../shared/rss.ts";
import { object } from "./json.ts";
import { grantsManifest as manifest } from "./manifest.ts";

export function calendar(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ProcessingError("funding_date_invalid");
  const m = /^(\d{4}-\d{2}-\d{2})(?:-00-00-00)?$/.exec(value);
  if (m) return dateOnly(m[1]);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (us) return dateOnly(`${us[3]}-${us[1]}-${us[2]}`);
  if (/^(rolling|open until filled|TBD)$/i.test(value)) return null;
  throw new ProcessingError("funding_date_invalid");
}
function labels(value: unknown, max: number): { id: string; description: string }[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new ProcessingError("funding_taxonomy_changed");
  }
  return value.map((item) => {
    if (
      !object(item) || typeof item.id !== "string" || !/^[A-Z0-9]{1,8}$/.test(item.id) ||
      typeof item.description !== "string"
    ) throw new ProcessingError("funding_taxonomy_changed");
    return { id: item.id, description: plain(item.description, 512) };
  });
}
function excerpt(value: unknown) {
  if (value == null) return { text: null, truncated: false };
  const full = plain(value, 32768);
  let text = "", size = 0;
  for (const c of full) {
    size += bytes(c);
    if (size > 2048) break;
    text += c;
  }
  return { text, truncated: text.length < full.length };
}
export function mapFunding(item: unknown, page: CollectedPage): ParsedRecord | RecordError {
  let recordKey: string | null = null;
  try {
    if (!object(item) || !object(item.hit)) throw new ProcessingError("malformed_record");
    const hit = item.hit,
      id = String(hit.id ?? ""),
      number = typeof hit.number === "string" ? hit.number : "";
    if (!/^\d{1,10}$/.test(id) || !number || number.length > 160) {
      throw new ProcessingError("funding_identity_missing");
    }
    recordKey = `grants-v1:${id}:${number}`;
    if (item.error) {
      throw new ProcessingError(
        typeof item.error === "string" && /^[a-z_]{1,80}$/.test(item.error)
          ? item.error
          : "detail_fetch_failed",
      );
    }
    if (!object(item.detail)) throw new ProcessingError("detail_missing");
    const data = item.detail;
    if (
      String(data.id) !== id || data.opportunityNumber !== number ||
      data.opportunityTitle !== hit.title
    ) throw new ProcessingError("funding_identity_mismatch");
    if (
      data.owningAgencyCode !== manifest.scope.agency || hit.agencyCode !== manifest.scope.agency
    ) throw new ProcessingError("excluded_agency_scope");
    const sourceStatus = hit.oppStatus;
    if (!["posted", "forecasted", "closed", "archived", "unknown"].includes(String(sourceStatus))) {
      throw new ProcessingError("funding_status_changed");
    }
    const forecast = sourceStatus === "forecasted", doc = forecast ? data.forecast : data.synopsis;
    if (!object(doc) || data.docType !== (forecast ? "forecast" : "synopsis")) {
      throw new ProcessingError("funding_document_changed");
    }
    const instruments = labels(doc.fundingInstruments, 8),
      categories = labels(doc.fundingActivityCategories, 40),
      applicants = labels(doc.applicantTypes, 40);
    if (!categories.some((c) => c.id === manifest.scope.category)) {
      throw new ProcessingError("excluded_nonresearch_funding_category");
    }
    const type = instruments.some((i) => i.id === "G")
      ? "grant"
      : instruments.length === 1 && instruments[0].id === "CA"
      ? "research_funding"
      : null;
    if (!type) throw new ProcessingError("excluded_funding_instrument");
    const title = plain(data.opportunityTitle, 1024),
      eligibility = excerpt(doc.applicantEligibilityDesc),
      closing = forecast ? doc.estApplicationResponseDateStr : doc.responseDateStr;
    const due = calendar(closing),
      posted = calendar(doc.postingDateStr ?? hit.openDate),
      url = `https://www.grants.gov/search-results-detail/${id}`;
    const official = typeof doc.fundingDescLinkUrl === "string" && doc.fundingDescLinkUrl
      ? safeUrl(doc.fundingDescLinkUrl)
      : null;
    const attrs: { [key: string]: Value } = {
      schema_version: 1,
      portal_id: id,
      opportunity_number: number,
      source_status: String(sourceStatus),
      instruments,
      categories,
      posted_date: posted,
      deadline_estimated: forecast,
      eligibility: {
        schema_version: 1,
        applicant_types: applicants,
        additional_information: eligibility.text,
        additional_information_truncated: eligibility.truncated,
        nationality: null,
        residency: null,
        career_stage: null,
      },
      official_funder_url: official,
    };
    return {
      kind: "record",
      sourceRecordKey: recordKey,
      sourceUrl: url,
      metadata: {
        source_revision: page.sourceRevision,
        upstream_revision: typeof data.revision === "number" ? data.revision : null,
        document_version: typeof doc.version === "number" ? doc.version : null,
        opportunity_id: id,
        opportunity_number: number,
      },
      draft: {
        type,
        title,
        organization: typeof doc.agencyName === "string"
          ? plain(doc.agencyName, 512)
          : "U.S. National Science Foundation",
        description: `${title}. ${
          instruments.map((i) => i.description).join(" / ")
        } for research; consult official applicant and institutional requirements.`,
        topics: categories.map((c) => c.description),
        qualificationTags: [],
        countryCodes: [],
        locationText: null,
        workMode: "unknown",
        canonicalUrl: url,
        publishedAt: null,
        cycleKey: `${number}:${id}`,
        trackKey: "main",
        status: sourceStatus === "posted"
          ? "open"
          : ["closed", "archived"].includes(String(sourceStatus))
          ? "closed"
          : "unknown",
        attributes: { funding: attrs },
        deadlines: [{
          kind: "application",
          roundKey: "application",
          label: forecast
            ? "Estimated portal closing date (forecast)"
            : due
            ? "Portal application closing date"
            : typeof closing === "string" && /rolling|filled/i.test(closing)
            ? "Rolling application"
            : "Deadline unknown",
          value: due ??
            (typeof closing === "string" && /rolling|TBD|filled/i.test(closing) ? closing : null),
          timezone: null,
          basis: due ? "explicit" : "unknown",
        }],
        identities: [{ kind: "listing_url", value: url, reviewed: true, listingSpecific: true }],
      },
    };
  } catch (error) {
    return {
      kind: "error",
      sourceRecordKey: recordKey,
      code: error instanceof ProcessingError ? error.code : "malformed_record",
    };
  }
}
