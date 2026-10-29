import type { ParsedRecord, RecordError, Value } from "../../../domain/model.ts";
import type { CollectedPage } from "../../../application/ports.ts";
import { ProcessingError } from "../../../application/ports.ts";
import { dateOnly, instant } from "../../../domain/temporal.ts";
import { bytes } from "../../../domain/primitives.ts";
import { object, plain } from "./rss.ts";
import { bathManifest } from "./manifest.ts";

export function vacancyReference(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const url = new URL(value);
    const ref = url.searchParams.get("ref");
    return url.origin === "https://www.bath.ac.uk" && url.pathname === "/jobs/rss/click.aspx" &&
        [...url.searchParams.keys()].join(",") === "ref" && ref &&
        /^[A-Z]{2}\d{5}(?:R\d?)?$/.test(ref)
      ? ref
      : null;
  } catch {
    return null;
  }
}
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const fullMonths = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
export function closingDate(value: string | null): string | null {
  if (!value) return null;
  if (/^(open until filled|rolling|until filled)$/i.test(value.trim())) return "rolling";
  const match = /^(\d{1,2}) (\w{3,9}) (\d{4})$/.exec(value.trim());
  if (!match) throw new ProcessingError("malformed_closing_date");
  const token = match[2].toLowerCase();
  const month = (months.includes(token) ? months.indexOf(token) : fullMonths.indexOf(token)) + 1;
  if (!month) throw new ProcessingError("malformed_closing_date");
  return dateOnly(`${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`);
}
function publication(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\w{3}, \d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2} (?:GMT|[+-]\d{4})$/.test(value)
  ) throw new ProcessingError("malformed_publication_date");
  const m = /^\w{3}, (\d{1,2}) (\w{3}) (\d{4}) (\d{2}:\d{2}:\d{2}) (GMT|[+-]\d{4})$/.exec(value)!;
  const month = months.indexOf(m[2].toLowerCase()) + 1;
  const date = dateOnly(`${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  const offset = m[5] === "GMT" ? "Z" : `${m[5].slice(0, 3)}:${m[5].slice(3)}`;
  return instant(`${date}T${m[4]}${offset}`);
}
export function mapItem(item: unknown, page: CollectedPage): ParsedRecord | RecordError {
  const ref = object(item) ? vacancyReference(item.guid) : null;
  const sourceRecordKey = ref ? `bath-v1:${ref}` : null;
  try {
    if (
      !object(item) || !ref || vacancyReference(item.link) !== ref ||
      bytes(JSON.stringify(item)) > bathManifest.maxItemBytes
    ) throw new ProcessingError("malformed_record");
    const heading = plain(item.title, 1024),
      title = heading.replace(/\s*\([A-Z]{2}\d{5}(?:R\d?)?\)\s*$/, "");
    if (!heading.endsWith(`(${ref})`)) throw new ProcessingError("source_identity_mismatch");
    if (plain(item.category, 200) !== "Education & Research") {
      throw new ProcessingError("excluded_nonresearch_category");
    }
    const body = plain(item.description);
    const field = (name: string): string | null => {
      const match = new RegExp(`(?:^|\\n)\\s*${name}:\\s*([^\\n]+)`, "i").exec(body);
      return match?.[1].trim() ?? null;
    };
    const postdocTitle = /^post[- ]?doctoral research (?:associate|assistant|fellow)\b/i.test(
      title,
    );
    const associate = /^research associate(?:\/fellow)?\b/i.test(title);
    const degreeEvidence =
      /(?:\b(?:you|applicants?|successful candidate)\s+(?:should|must|will|need to)\s+(?:have|hold)[^.\n]{0,100}\bPhD\b|\ba PhD \(completed or nearing completion\))/i
        .exec(body)?.[0] ?? null;
    const explicitPostdoc =
      /\b(?:appoint|recruit(?:ing)?|seeking|invited for)[^.\n]{0,150}\bpostdoctoral (?:research(?:er| associate)|position)/i
        .test(body);
    const type = postdocTitle || associate && (degreeEvidence !== null || explicitPostdoc)
      ? "postdoc"
      : /^research assistant\b/i.test(title)
      ? "research_assistant"
      : null;
    if (!type) {
      throw new ProcessingError(
        associate ? "ambiguous_research_level" : "excluded_role_out_of_scope",
      );
    }
    const closing = field("Closing Date"), location = field("Location"), mode = field("Work Mode");
    const due = closingDate(closing), url = `https://www.bath.ac.uk/jobs/Vacancy.aspx?ref=${ref}`;
    const locations = location ? location.split(/\s*;\s*/).slice(0, 8) : [];
    const countries = [
      ...(location?.matchAll(/\b(United Kingdom|UK|Japan|France|Germany)\b/g) ?? []),
    ].map(
      (
        m,
      ) => ({ "United Kingdom": "GB", UK: "GB", Japan: "JP", France: "FR", Germany: "DE" }[m[1]]!),
    );
    const degree = degreeEvidence !== null;
    const nearing = degree &&
      /nearing|close to completing|within six months|not yet|will be promoted/i.test(body);
    const equivalent = degree &&
      /equivalent/i.test(
        body.slice(Math.max(0, body.indexOf(degreeEvidence!)), body.indexOf(degreeEvidence!) + 300),
      );
    const eligibility: { [key: string]: Value } = {
      schema_version: 1,
      degree_level: degree ? "doctoral" : null,
      degree_completion: degree ? (nearing ? "completed_or_nearing" : "completed") : null,
      equivalence_accepted: equivalent ? true : null,
      nationality: null,
      residency: null,
      student_status: null,
    };
    return {
      kind: "record",
      sourceRecordKey: sourceRecordKey!,
      sourceUrl: String(item.link),
      metadata: {
        source_revision: page.sourceRevision,
        feed_url: bathManifest.endpoint,
        job_reference: ref,
        source_family: "Education & Research",
        encoding_note: "HTTP UTF-8; feed prolog ISO-8859-1",
      },
      draft: {
        type,
        title,
        organization: "University of Bath",
        description: `${title}. Research vacancy at the University of Bath.`,
        topics: [],
        qualificationTags: degree
          ? [
            nearing ? "doctoral_completed_or_nearing" : "doctoral",
            ...(equivalent ? ["equivalence_accepted"] : []),
          ]
          : [],
        countryCodes: countries,
        locationText: location,
        workMode: mode && /^(onsite|hybrid|remote)$/i.test(mode) ? mode.toLowerCase() : "unknown",
        canonicalUrl: url,
        publishedAt: publication(item.pubDate),
        cycleKey: ref,
        trackKey: "main",
        status: "unknown",
        attributes: {
          position: {
            schema_version: 1,
            vacancy_reference: ref,
            classification_evidence: postdocTitle
              ? "explicit_postdoctoral_title"
              : associate
              ? "associate_with_explicit_postdoctoral_or_degree_evidence"
              : "research_assistant_title",
            eligibility,
            locations,
            closing_label: closing,
          },
        },
        deadlines: [{
          kind: "application",
          roundKey: "application",
          label: due === "rolling" ? "Open until filled" : closing ?? "Deadline unknown",
          value: due,
          timezone: null,
          basis: "explicit",
        }],
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
