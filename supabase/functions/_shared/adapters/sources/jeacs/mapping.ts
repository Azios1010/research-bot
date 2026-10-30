import type { CollectedPage } from "../../../application/ports.ts";
import { ProcessingError } from "../../../application/ports.ts";
import type {
  DeadlineDraft,
  ObjectValue,
  ParsedRecord,
  RecordError,
  TemporalEvidence,
  Value,
} from "../../../domain/model.ts";
import { calendarEnd, dateOnly, normalizeTime } from "../../../domain/temporal.ts";
import { bytes, ordered, stable, text } from "../../../domain/primitives.ts";
import type { Card, JournalContext } from "./html.ts";
import { feeEvidence } from "./html.ts";
import { jeacsManifest as m } from "./manifest.ts";

const monthNames = [
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
const monthPattern = monthNames.flatMap((s) => [s, s.slice(0, 3)]).join("|");
const datePattern =
  `(?:20\\d{2}-\\d{2}-\\d{2}(?:[ T]\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:\\d{2})?(?: (?:UTC|[A-Za-z_]+/[A-Za-z_]+|CST))?)?|(?:${monthPattern}) \\d{1,2}(?:st|nd|rd|th)?,? 20\\d{2}|\\d{1,2}(?:st|nd|rd|th)? (?:${monthPattern}) 20\\d{2})`;
export function temporal(raw: string): TemporalEvidence {
  const value = text(raw).replace(/[.]$/, "");
  if (/^(rolling|TBD|unknown|ongoing)$/i.test(value)) {
    return { value: value.toLowerCase(), basis: "unknown", timezone: null };
  }
  if (/^20\d{2}-\d{2}-\d{2}/.test(value)) {
    const match = /^(.*?)(?: (UTC|[A-Za-z_]+\/[A-Za-z_]+|CST))?$/.exec(value)!;
    const v = match[1].replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) dateOnly(v);
    else normalizeTime({ value: v, timezone: match[2] ?? null, basis: "explicit" });
    return { value: v, timezone: match[2] ?? null, basis: "explicit" };
  }
  const english = new RegExp(
    `^(?:(${monthPattern}) (\\d{1,2})(?:st|nd|rd|th)?,?|(\\d{1,2})(?:st|nd|rd|th)? (${monthPattern})) (20\\d{2})$`,
    "i",
  ).exec(value);
  if (!english) throw new ProcessingError("journal_date_invalid");
  const token = (english[1] ?? english[4]).toLowerCase(),
    month = monthNames.findIndex((n) => n === token || n.slice(0, 3) === token) + 1;
  const date = dateOnly(
    `${english[5]}-${String(month).padStart(2, "0")}-${
      String(english[2] ?? english[3]).padStart(2, "0")
    }`,
  );
  return { value: date, timezone: null, basis: "explicit" };
}
export interface CallDates {
  deadlines: DeadlineDraft[];
  opening: TemporalEvidence | null;
  closed: boolean;
  withdrawn: boolean;
  upcoming: boolean;
  explicitOpen: boolean;
}
export function callDates(body: string, now: string): CallDates {
  const deadlines: DeadlineDraft[] = [];
  let opening: TemporalEvidence | null = null;
  for (const raw of body.split("\n")) {
    const line = text(raw);
    if (!/deadline|abstract|submission|full articles|papers|manuscripts|acceptance/i.test(line)) {
      continue;
    }
    if (/publication date|published on|issue publication/i.test(line)) continue;
    const matches = [...line.matchAll(new RegExp(datePattern, "gi"))];
    if (!matches.length) continue;
    if (/submission window/i.test(line) && matches.length === 2) {
      opening = temporal(matches[0][0]);
      deadlines.push({
        kind: "submission",
        roundKey: "manuscript",
        label: "Full article submission",
        ...temporal(matches[1][0]),
      });
      continue;
    }
    if (/submissions? opens?|opening date/i.test(line)) {
      opening = temporal(matches[0][0]);
      continue;
    }
    const kind = /notification|acceptance/i.test(line) && !/deadline/i.test(line)
      ? "decision"
      : /abstract/i.test(line) &&
          !/full articles|final deadline for papers|complete articles/i.test(line)
      ? "abstract"
      : "submission";
    // A date in prose about a paper is insufficient: explicit closing/notification evidence is required.
    if (
      !/deadline|no later than|due by|submission of full articles|notification of abstract acceptance/i
        .test(line)
    ) continue;
    for (const match of matches) {
      deadlines.push({
        kind,
        roundKey: kind === "abstract"
          ? "abstract"
          : kind === "decision"
          ? "abstract-decision"
          : "manuscript",
        label: kind === "abstract"
          ? "Abstract submission"
          : kind === "decision"
          ? "Abstract acceptance notification"
          : "Full article submission",
        ...temporal(match[0]),
      });
    }
  }
  if (!deadlines.some((d) => d.kind === "submission")) {
    const rolling =
      /(?:submission(?:s| deadline)?|call)\s*:\s*(rolling|ongoing|TBD)|submissions (?:are )?accepted on a rolling basis/i
        .exec(body);
    deadlines.push({
      kind: "submission",
      roundKey: "manuscript",
      label: rolling ? "Rolling or unspecified submission" : "Submission deadline unknown",
      value: rolling ? (rolling[1]?.toLowerCase() ?? "rolling") : null,
      timezone: null,
      basis: "unknown",
    });
  }
  const closed =
      /\b(?:call is closed|submissions (?:are )?closed|no longer accepting submissions)\b/i.test(
        body,
      ),
    withdrawn = /\b(?:call (?:is )?withdrawn|call (?:is )?cancelled)\b/i.test(body),
    start = opening ? normalizeTime(opening) : null,
    upcoming = Boolean(
      start &&
        (start.dueAt
          ? Date.parse(start.dueAt) > Date.parse(now)
          : start.dueDate
          ? start.dueDate > now.slice(0, 10)
          : false),
    ),
    explicitOpen =
      /\b(?:open for submissions|currently accepting submissions|submissions accepted on a rolling basis)\b/i
        .test(body);
  return { deadlines, opening, closed, withdrawn, upcoming, explicitOpen };
}
function editors(card: Card): string[] {
  let selected: string | null = null;
  for (let i = 0; i < card.paragraphs.length; i++) {
    const p = card.paragraphs[i], inline = /\bguest editors?\s*[:,]\s*(.+)$/i.exec(p);
    if (inline) {
      selected = inline[1];
      break;
    }
    if (/^Guest editors?:?$/i.test(p.trim())) {
      selected = card.paragraphs.slice(i + 1, i + 3).join(", ");
      break;
    }
  }
  if (!selected) return [];
  const clean = selected.replace(/\([^)]*\)/g, "").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "")
    .replace(/\s+and\s+/g, ",");
  const names = clean.split(/[,;]/).map((n) => text(n.replace(/[.\s]+$/, ""), 160)).filter(Boolean);
  if (
    names.length > 8 || names.some((n) => /[:@/]|\b(?:submit|contact|deadline|abstract)\b/i.test(n))
  ) throw new ProcessingError("editor_evidence_ambiguous");
  return ordered(names);
}
function theme(card: Card): string | null {
  const heading = /special issue\s*:?\s*(.+)$/i.exec(card.heading)?.[1];
  const paragraph = card.paragraphs.find((p) => /^Special [Ii]ssue\s*:/i.test(p));
  const raw = heading ?? paragraph?.replace(/^Special [Ii]ssue\s*:\s*/, "");
  return raw ? text(raw.replace(/^["“”']+|["“”'.]+$/g, "").trim(), 512) : null;
}
function edition(card: Card) {
  const full = `${card.heading}\n${card.body}`,
    numbered = /(?:JEACS(?:\s+issue)?|Issue|Studies)\s+(\d{1,2}\.\d{1,2})/i.exec(full)?.[1] ?? null,
    year = /\d{1,2}\.\d{1,2}\s*\((20\d{2})\)/.exec(full)?.[1] ??
      /(?:second issue of|to be published in)\s+(20\d{2})/i.exec(full)?.[1] ?? null;
  return {
    number: numbered,
    year,
  };
}
function known(e: DeadlineDraft) {
  const n = normalizeTime(e);
  return n.precision !== "unknown";
}
function combine(primary: DeadlineDraft[], other: DeadlineDraft[]): DeadlineDraft[] {
  const result = [...primary];
  for (const d of other) {
    const matches = result.filter((p) => p.kind === d.kind && p.roundKey === d.roundKey);
    if (!matches.length) {
      result.push(d);
      continue;
    }
    if (!known(d)) continue;
    const index = result.indexOf(matches[0]);
    if (!known(matches[0])) {
      result[index] = d;
      continue;
    }
    if (
      matches.some((p) =>
        stable(normalizeTime(p) as unknown as Value) ===
          stable(normalizeTime(d) as unknown as Value)
      )
    ) continue;
    // Equal-day directory evidence cannot contradict an explicit detail clock; retain the more precise fact.
    const a = normalizeTime(matches[0]), b = normalizeTime(d);
    if (a.dueDate && a.dueDate === b.dueDate && a.precision !== b.precision) {
      if (b.precision === "instant") result[index] = d;
      continue;
    }
    result.push(d); // Existing domain normalization marks one stable round conflicted, never invents a winner.
  }
  return result;
}
export function mapCall(
  group: Card[],
  journal: JournalContext,
  page: CollectedPage,
  detail: Card | null = null,
  detailError: string | null = null,
): ParsedRecord | RecordError {
  const first = group[0],
    canonicalId = first.id ? (m.aliases[first.id] ?? first.id) : null,
    recordKey = canonicalId ? `jeacs-v1:announcement:${canonicalId}` : null;
  try {
    if (!canonicalId || group.some((c) => c.malformed)) {
      throw new ProcessingError("malformed_record");
    }
    const sorted = group.toSorted((a, b) =>
      (b.publicationDate ?? "").localeCompare(a.publicationDate ?? "") ||
      String(a.id).localeCompare(String(b.id))
    );
    const dir = sorted[0];
    if (/\b(?:proposals?|guest.editor applications?)\b/i.test(dir.heading)) {
      throw new ProcessingError("excluded_proposal_invitation");
    }
    if (
      /\b(?:is (?:now )?online|are (?:now )?online|publication of|published collection)\b/i.test(
        dir.heading,
      )
    ) throw new ProcessingError("excluded_published_collection");
    if (/list of.*PhD dissertations|list of recent.*dissertations/i.test(dir.heading)) {
      throw new ProcessingError("excluded_nonmanuscript_call");
    }
    if (!/call for (?:papers|abstracts|contributions)|deadline approaching/i.test(dir.heading)) {
      throw new ProcessingError("excluded_not_author_call");
    }
    if (/deadline approaching/i.test(dir.heading) && !m.aliases[dir.id!]) {
      throw new ProcessingError("ambiguous_call_identity");
    }
    if (detailError) {
      throw new ProcessingError(
        /^[a-z_]{1,80}$/.test(detailError) ? detailError : "detail_fetch_failed",
      );
    }
    const selected = detail ?? dir;
    if (detail && (detail.malformed || detail.id !== canonicalId)) {
      throw new ProcessingError("detail_identity_mismatch");
    }
    if (detail && /is (?:now )?online|published collection/i.test(detail.heading)) {
      throw new ProcessingError("stale_directory_entry");
    }
    const issueTheme = theme(selected) ?? theme(dir),
      type = issueTheme
        ? "journal_special_issue"
        : /\bunthemed\b/i.test(`${selected.heading} ${selected.body} ${dir.heading} ${dir.body}`)
        ? "journal_cfp"
        : null;
    if (!type) throw new ProcessingError("ambiguous_call_kind");
    if (
      !/invite submissions|welcome submissions|invite original research|submit (?:an abstract|original|manuscript|complete articles)|call for (?:papers|contributions)/i
        .test(selected.body)
    ) throw new ProcessingError("missing_author_submission_evidence");
    const ed = edition(selected),
      dates = callDates(selected.body, page.fetchedAt),
      others = group.filter((c) => c !== selected).flatMap((c) =>
        callDates(c.body, page.fetchedAt).deadlines
      ),
      deadlines = combine(dates.deadlines, others),
      actionable = deadlines.filter((d) => d.kind !== "decision"),
      expiration = actionable.map((d) => normalizeTime(d)),
      expired = expiration.length > 0 &&
        expiration.every((d) =>
          d.precision !== "unknown" &&
          (d.dueAt
            ? Date.parse(d.dueAt) <= Date.parse(page.fetchedAt)
            : d.dueDate
            ? calendarEnd(d.dueDate) <= Date.parse(page.fetchedAt)
            : false)
        ),
      conflicting = deadlines.some((d, i) =>
        deadlines.slice(0, i).some((p) =>
          p.kind === d.kind && p.roundKey === d.roundKey && known(p) && known(d) &&
          stable(normalizeTime(p) as unknown as Value) !==
            stable(normalizeTime(d) as unknown as Value)
        )
      ),
      status = dates.withdrawn
        ? "withdrawn"
        : dates.closed || expired
        ? "closed"
        : dates.upcoming || conflicting
        ? "unknown"
        : dates.explicitOpen || expiration.some((d) => d.dueAt || d.dueDate)
        ? "open"
        : "unknown";
    if (status === "unknown" && !dates.upcoming && !conflicting) {
      throw new ProcessingError("unverified_current_call");
    }
    if (
      group.some((c) => {
        const other = edition(c);
        return Boolean(
          ed.year && other.year && ed.year !== other.year ||
            ed.number && other.number && ed.number !== other.number,
        );
      })
    ) throw new ProcessingError("conflicting_identity_evidence");
    const url = `${m.endpoint}/view/${canonicalId}`,
      title = issueTheme ??
        `JEACS ${ed.number ?? "regular issue"}${
          ed.year ? ` (${ed.year})` : ""
        } — unthemed manuscript call`,
      scope = selected.paragraphs.find((p) =>
        /^We invite original research|^This special issue welcomes|^The chief goal|^Submissions should examine/i
          .test(p)
      ) ?? null,
      topics = selected.lists.filter((l) =>
        l.length <= 160 && !/@|https?:\/\/|mailto:/i.test(l)
      ).slice(0, 16),
      published = group.map((c) => ({
        announcement_id: c.id,
        date: c.publicationDate,
      }));
    const callFee = feeEvidence(selected.body, url);
    if (
      callFee && journal.fee &&
      (callFee.amount !== journal.fee.amount || callFee.currency !== journal.fee.currency)
    ) {
      throw new ProcessingError("conflicting_fee_evidence");
    }
    const detailDocument = page.sourceUrl !== m.endpoint;
    const metadata: ObjectValue = {
      source_revision: page.sourceRevision,
      announcement_ids: group.map((c) => c.id!),
      publication_dates: published,
      documents: {
        directory: detailDocument ? null : m.endpoint,
        policy: m.policyUrl,
        detail: detail || detailDocument ? url : null,
      },
      field_documents: {
        journal: "policy",
        title: detail || detailDocument ? "detail" : "directory",
        deadlines: detail ? "directory+detail" : detailDocument ? "detail" : "directory",
        fees: callFee
          ? (detail || detailDocument ? "detail" : "directory")
          : journal.fee
          ? "policy"
          : null,
      },
    };
    const call: ObjectValue = {
      schema_version: 1,
      announcement_id: canonicalId,
      theme: issueTheme,
      edition: ed.number,
      year: ed.year,
      source_status: dates.withdrawn
        ? "withdrawn"
        : dates.closed
        ? "closed"
        : expired
        ? "expired"
        : conflicting
        ? "conflicted"
        : dates.upcoming
        ? "upcoming"
        : status,
      submission_opening: dates.opening as unknown as Value,
      scope: scope ? [...text(scope, m.maxCardBytes)].slice(0, 1024).join("") : null,
      scope_truncated: Boolean(scope && [...text(scope, m.maxCardBytes)].length > 1024),
      guest_editors: editors(selected),
      article_types: /original research|research papers/i.test(selected.body)
        ? ["research_paper"]
        : [],
      eligibility: {
        career_stage: /scholars at all career stages/i.test(selected.body)
          ? "all_career_stages"
          : null,
        subject: /working in Sinophone studies/i.test(selected.body) ? "Sinophone studies" : null,
        original_research_required: /original research/i.test(selected.body) ? true : null,
      },
      abstract_required:
        /required to submit an abstract|prior to preparing the full article/i.test(selected.body)
          ? true
          : null,
      language: /\bLanguage:\s*([^\n]+)/i.exec(selected.body)?.[1] ?? null,
      word_count_guidance:
        /\b(?:Article length|Length):\s*([^\n]{1,160})/i.exec(selected.body)?.[1] ?? null,
      book_reviews_solicited_only:
        /book reviews are to be submitted on a solicited basis only/i.test(selected.body)
          ? true
          : null,
      fees: (callFee ?? journal.fee) as unknown as Value,
    };
    const record: ParsedRecord = {
      kind: "record",
      sourceRecordKey: recordKey!,
      sourceUrl: url,
      metadata,
      draft: {
        type,
        title,
        organization: journal.publisher,
        description: `${title}. Author manuscript call in ${journal.name}.`,
        topics,
        workMode: "unknown",
        countryCodes: [],
        publishedAt: group.find((c) => c.id === canonicalId)?.publicationDate ?? null,
        canonicalUrl: url,
        cycleKey: ed.year ? `${m.journalNamespace}:${canonicalId}:${ed.year}` : null,
        trackKey: "author-manuscripts",
        status,
        attributes: {
          journal: {
            name: journal.name,
            publisher: journal.publisher,
            issn: journal.issn,
            url: journal.url,
          },
          journal_call: call,
        },
        deadlines,
        identities: [{ kind: "listing_url", value: url, reviewed: true, listingSpecific: true }],
      },
    };
    if (bytes(JSON.stringify(record.metadata)) > 2048) {
      throw new ProcessingError("metadata_too_large");
    }
    return record;
  } catch (error) {
    return {
      kind: "error",
      sourceRecordKey: recordKey,
      code: error instanceof ProcessingError ? error.code : "malformed_record",
    };
  }
}
