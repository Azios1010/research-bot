import {
  deadlineKinds,
  DomainError,
  type Fields,
  type NormalizedOpportunity,
  type ObjectValue,
  type OpportunityDraft,
  type OpportunityType,
  opportunityTypes,
  type QualityFlag,
  type Value,
} from "./model.ts";
import {
  boundedObject,
  countryCodes,
  key,
  nullableText,
  ordered,
  safeUrl,
  stable,
  tags,
  text,
} from "./primitives.ts";
import { dateOnly, instant, normalizeDeadline } from "./temporal.ts";
import { identitiesFor } from "./identity.ts";

export interface NormalizationPolicy {
  organizationAliases?: Record<string, string>;
}
function attributes(input: ObjectValue | undefined, type: OpportunityType): ObjectValue {
  const result = { schema_version: 1, ...input };
  boundedObject(result, 8192);
  if (result.schema_version !== 1) throw new DomainError("unsupported_attributes_version");
  if ("journal" in result) {
    if (!["journal_cfp", "journal_special_issue"].includes(type)) {
      throw new DomainError("attributes_type_mismatch");
    }
    boundedObject(result.journal, 2048);
    for (const k of ["name", "issn"]) {
      if (result.journal[k] != null && typeof result.journal[k] !== "string") {
        throw new DomainError("invalid_journal_attributes");
      }
    }
    if (result.journal.issn && !/^\d{4}-\d{3}[\dX]$/i.test(String(result.journal.issn))) {
      throw new DomainError("invalid_journal_issn");
    }
  }
  if ("funding_amount" in result) {
    if (!["grant", "research_funding"].includes(type)) {
      throw new DomainError("attributes_type_mismatch");
    }
    boundedObject(result.funding_amount, 1024);
    const amount = result.funding_amount;
    if (
      typeof amount.value !== "number" || amount.value < 0 || typeof amount.currency !== "string" ||
      !/^[A-Z]{3}$/.test(amount.currency)
    ) throw new DomainError("invalid_funding_amount");
  }
  return result;
}
export async function normalize(
  draft: OpportunityDraft,
  policy: NormalizationPolicy = {},
): Promise<NormalizedOpportunity> {
  if (!opportunityTypes.includes(draft.type as OpportunityType)) {
    throw new DomainError("unsupported_type");
  }
  const type = draft.type as OpportunityType;
  const title = text(draft.title);
  if (!title) throw new DomainError("missing_title");
  if (/<\/?[a-z][^>]*>/i.test(title)) throw new DomainError("markup_in_title");
  const flags: QualityFlag[] = [];
  let organization = nullableText(draft.organization);
  const alias = organization && policy.organizationAliases?.[key(organization)];
  if (alias) organization = text(alias);
  if (!organization) flags.push("missing_organization");
  const description = nullableText(draft.description, 16000);
  if (description && /<\/?[a-z][^>]*>/i.test(description)) {
    throw new DomainError("markup_in_description");
  }
  const mode = draft.workMode ? key(draft.workMode).replace(/[ -]/g, "") : "unknown";
  const workMode = ["onsite", "hybrid", "remote"].includes(mode)
    ? mode as Fields["workMode"]
    : "unknown";
  if (workMode === "unknown") flags.push("unknown_work_mode");
  const countries = countryCodes(draft.countryCodes ?? []);
  const location = nullableText(draft.locationText);
  if (!countries.length && !location && workMode !== "remote") flags.push("incomplete_location");
  const attrs = attributes(draft.attributes, type);
  let publishedAt: string | null = null;
  if (draft.publishedAt) {
    try {
      publishedAt = instant(draft.publishedAt);
    } catch {
      if (/^\d{4}-\d{2}-\d{2}$/.test(draft.publishedAt)) {
        try {
          attrs.publication_date = dateOnly(draft.publishedAt);
        } catch {
          flags.push("invalid_optional_date");
        }
      } else flags.push("invalid_optional_date");
    }
  }
  if (!publishedAt) flags.push("missing_publication_time");
  const eventDate = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    try {
      return dateOnly(raw);
    } catch {
      flags.push("invalid_optional_date");
      return null;
    }
  };
  const eventStart = eventDate(draft.eventStart), eventEnd = eventDate(draft.eventEnd);
  if (eventStart && eventEnd && eventEnd < eventStart) throw new DomainError("event_date_order");
  const status = draft.status ?? "unknown";
  if (!["open", "closed", "withdrawn", "unknown"].includes(status)) {
    throw new DomainError("invalid_lifecycle");
  }
  const fields: Fields = {
    type,
    title,
    titleKey: key(title),
    organization,
    organizationKey: organization ? key(organization) : null,
    description,
    topics: tags(draft.topics),
    qualificationTags: tags(draft.qualificationTags),
    countryCodes: countries,
    locationText: location,
    workMode,
    canonicalUrl: draft.canonicalUrl ? safeUrl(draft.canonicalUrl) : null,
    publishedAt,
    cycleKey: draft.cycleKey == null ? null : key(draft.cycleKey) || null,
    trackKey: draft.trackKey == null ? null : key(draft.trackKey),
    parentId: null,
    eventStart,
    eventEnd,
    status: status as Fields["status"],
    attributes: attrs,
    qualityFlags: [],
  };
  if ((draft.deadlines?.length ?? 0) > 30) throw new DomainError("too_many_deadlines");
  const deadlines = new Map<string, ReturnType<typeof normalizeDeadline>["deadline"]>();
  for (const item of draft.deadlines ?? []) {
    if (!deadlineKinds.includes(item.kind)) throw new DomainError("invalid_deadline_kind");
    if (!item.roundKey || !key(item.roundKey)) {
      flags.push("ambiguous_round");
      continue;
    }
    let normalized: ReturnType<typeof normalizeDeadline>;
    try {
      normalized = normalizeDeadline(item);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      normalized = {
        deadline: {
          kind: item.kind,
          roundKey: key(item.roundKey),
          label: text(item.label),
          dueAt: null,
          dueDate: null,
          timezone: item.timezone ?? null,
          rawValue: nullableText(item.value, 2048),
          precision: "unknown",
          basis: "unknown",
          status: "conflicted",
        },
        flags: ["invalid_optional_date"],
      };
    }
    if (normalized.deadline.roundKey.length > 256) throw new DomainError("round_key_too_long");
    flags.push(...normalized.flags);
    const id = `${item.kind}:${normalized.deadline.roundKey}`, old = deadlines.get(id);
    if (
      old && stable(old as unknown as Value) !== stable(normalized.deadline as unknown as Value)
    ) {
      flags.push("conflicting_deadline");
      deadlines.set(id, {
        ...old,
        dueAt: null,
        dueDate: null,
        precision: "unknown",
        basis: "unknown",
        status: "conflicted",
        rawValue: "Conflicting source evidence",
      });
    } else deadlines.set(id, normalized.deadline);
  }
  fields.qualityFlags = ordered(flags) as QualityFlag[];
  const identity = await identitiesFor(fields, draft.identities ?? []);
  return {
    fields,
    deadlines: [...deadlines.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, d]) => d),
    ...identity,
  };
}
