import type { CollectedPage } from "../../../application/ports.ts";
import { ProcessingError } from "../../../application/ports.ts";
import type { OpportunityDraft, ParsedRecord, RecordError } from "../../../domain/model.ts";
import { dateOnly } from "../../../domain/temporal.ts";
import { bytes, safeUrl } from "../../../domain/primitives.ts";
import { object, plain, rssDate } from "../shared/rss.ts";
import { cernManifest } from "./manifest.ts";

function cmsId(item: unknown): string | null {
  if (!object(item) || !object(item.guid) || typeof item.guid["#text"] !== "string") return null;
  try {
    const url = new URL(plain(item.guid["#text"], 512));
    return url.origin === "https://careers.cern" && url.pathname === "/" &&
        url.searchParams.get("post_type") === "job_offer" &&
        /^\d{1,12}$/.test(url.searchParams.get("p") ?? "")
      ? url.searchParams.get("p")
      : null;
  } catch {
    return null;
  }
}
export function internship(html: string): { reference: string; facts: Partial<OpportunityDraft> } {
  if (bytes(html) > cernManifest.maxDetailBytes) throw new ProcessingError("response_too_large");
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html),
    reference = /<span\b[^>]*class=["']ref["'][^>]*>([^<]+)<\/span>/i.exec(html)?.[1].trim();
  if (
    !heading || plain(heading[1], 1024) !== "Short-Term Internship" || !reference ||
    !/^STAG \d{4}$/.test(reference)
  ) throw new ProcessingError("detail_schema_changed");
  const block = /<div\b[^>]*class=["']block eligibility["'][^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i
    .exec(html);
  if (!block) throw new ProcessingError("eligibility_schema_changed");
  const evidence = [...block[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) =>
    plain(m[1], 4096)
  );
  if (evidence.length < 1 || evidence.length > 12) {
    throw new ProcessingError("eligibility_schema_changed");
  }
  const eligibility = evidence.join(" "),
    restriction = /cannot consider applications from ([^.]+?nationals)/i.exec(eligibility)?.[1] ??
      null;
  const excluded = Object.entries({
    Pakistani: "PK",
    Lithuanian: "LT",
    Latvian: "LV",
    Cypriot: "CY",
    Croatian: "HR",
    Turkish: "TR",
  }).filter(([name]) => restriction?.includes(name)).map(([, code]) => code);
  const student = /remain enrolled as a full-time student/i.test(eligibility);
  const degreeLevels = [
    ...(/post-secondary|(?:Technical|Administrative)[^.]{0,30}diploma/i.test(eligibility)
      ? ["post_secondary_diploma"]
      : []),
    ...(/\bBachelor/i.test(eligibility) ? ["bachelor"] : []),
    ...(/\bMaster/i.test(eligibility) ? ["masters"] : []),
  ];
  if (restriction && restriction.length > 512) {
    throw new ProcessingError("eligibility_schema_changed");
  }
  const local = /<div\b[^>]*class=["']before["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1],
    label = local ? plain(local, 1024) : null;
  let value: string | null = null, zone: string | null = null;
  if (label && !/^Applications? closed$/i.test(label)) {
    const m = /^Before (\d{2})\/(\d{2})\/(\d{4}) at (\d{2}:\d{2}) \(Geneva Time\)$/i.exec(label);
    if (!m) throw new ProcessingError("deadline_schema_changed");
    value = `${dateOnly(`${m[3]}-${m[2]}-${m[1]}`)}T${m[4]}:00`;
    zone = "Europe/Zurich";
  }
  const location = /<span\b[^>]*class=["']location["'][^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1],
    locationText = location ? plain(location, 1024) : null;
  const flexibility =
    /<div\b[^>]*class=["']job-flexibility item has-icon["'][^>]*>[\s\S]*?<span>([^<]+)<\/span>/i
      .exec(html)?.[1].trim();
  const facts: Partial<OpportunityDraft> = {
    locationText,
    countryCodes: locationText?.endsWith("Switzerland") ? ["CH"] : [],
    workMode: flexibility === "Fully Onsite"
      ? "onsite"
      : flexibility === "Hybrid"
      ? "hybrid"
      : flexibility === "Fully Remote"
      ? "remote"
      : "unknown",
    qualificationTags: [
      ...(student ? ["student_full_time"] : []),
      ...(degreeLevels.includes("bachelor") && degreeLevels.includes("masters")
        ? ["undergraduate_or_masters"]
        : []),
    ],
    status: label && /closed/i.test(label) ? "closed" : "unknown",
    attributes: {
      position: {
        schema_version: 1,
        programme_reference: reference,
        classification_evidence: "reviewed_scientific_technical_programme",
        assignment_scope:
          "scientific_technical_and_administrative; research_assignment_not_guaranteed",
        eligibility: {
          schema_version: 1,
          student_full_time: student ? true : null,
          degree_levels: degreeLevels,
          nationality_group:
            /national of a CERN Member State or Associate Member State/i.test(eligibility)
              ? "cern_member_or_associate_state"
              : null,
          excluded_nationalities: excluded,
          exclusion_evidence: restriction,
          languages: /English or French/i.test(eligibility) ? ["en_or_fr"] : [],
          residency: null,
        },
      },
    },
    deadlines: [{
      kind: "application",
      roundKey: "application",
      label: label ?? "Deadline unknown",
      value,
      timezone: zone,
      basis: zone ? "explicit" : "unknown",
    }],
  };
  return { reference, facts };
}
export function mapCernItem(
  item: unknown,
  page: CollectedPage,
  detail: string | null,
  detailError: string | null,
): ParsedRecord | RecordError {
  const cms = cmsId(item);
  let sourceRecordKey = cms ? `cern-rss:${cms}` : null;
  try {
    if (!object(item) || !cms || bytes(JSON.stringify(item)) > 8192) {
      throw new ProcessingError("malformed_record");
    }
    const title = plain(item.title, 1024), url = safeUrl(String(item.link));
    if (
      new URL(url).origin !== "https://careers.cern" ||
      !/^\/jobs\/[a-z0-9-]{1,150}\/$/.test(new URL(url).pathname) || new URL(url).search
    ) throw new ProcessingError("source_url_unreviewed");
    let draft: OpportunityDraft;
    const doctoral = /^Doctoral Student Programme (\d{4}-[1-9])$/.exec(title);
    if (doctoral) {
      sourceRecordKey = `cern-v1:doctoral:${doctoral[1]}:${cms}`;
      draft = {
        type: "phd",
        title,
        cycleKey: doctoral[1],
        qualificationTags: [],
        attributes: {
          position: {
            schema_version: 1,
            programme: "doctoral_research_placement",
            classification_evidence: "reviewed_doctoral_programme_and_explicit_edition",
            eligibility: {
              schema_version: 1,
              student_status: null,
              nationality: null,
              residency: null,
            },
          },
        },
        deadlines: [{
          kind: "application",
          roundKey: "application",
          label: "Deadline absent from RSS",
          value: null,
          basis: "unknown",
        }],
      };
    } else if (title === "Short-Term Internship" && url === cernManifest.internshipUrl) {
      if (detailError) {
        throw new ProcessingError(
          /^[a-z_]{1,80}$/.test(detailError) ? detailError : "detail_fetch_failed",
        );
      }
      if (detail === null) throw new ProcessingError("detail_missing");
      const mapped = internship(detail);
      sourceRecordKey = `cern-v1:${mapped.reference}`;
      draft = { type: "research_internship", title, cycleKey: mapped.reference, ...mapped.facts };
    } else throw new ProcessingError("excluded_role_out_of_scope");
    return {
      kind: "record",
      sourceRecordKey: sourceRecordKey!,
      sourceUrl: url,
      metadata: {
        document_hash: page.validators.document_hash ?? null,
        feed_url: page.sourceUrl,
        cms_post_id: cms,
      },
      draft: {
        organization: "CERN",
        topics: [],
        trackKey: "main",
        countryCodes: [],
        locationText: null,
        workMode: "unknown",
        status: "unknown",
        ...draft,
        canonicalUrl: url,
        publishedAt: rssDate(item.pubDate),
        description:
          `${title}. CERN research/student recruitment programme; consult official eligibility and assignment scope.`,
        identities: [{ kind: "listing_url", value: url, reviewed: true, listingSpecific: true }],
      },
    };
  } catch (error) {
    return {
      kind: "error",
      sourceRecordKey,
      code: error instanceof ProcessingError ? error.code : "malformed_record",
    };
  }
}
