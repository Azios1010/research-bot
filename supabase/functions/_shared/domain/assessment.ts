import {
  DomainError,
  family,
  type ObjectValue,
  type Opportunity,
  type OpportunityType,
  opportunityTypes,
} from "./model.ts";
import { compare, key, ordered, tags } from "./primitives.ts";
import { calendarEnd, localDate, validZone } from "./temporal.ts";

export const rulesVersion = "deterministic-v1";
export interface Rules {
  enabledTypes: OpportunityType[];
  positiveTopics: { phrase: string; weight: number; aliases: string[] }[];
  blockedTopics: string[];
  ignoredTopics: string[];
  blockedInstitutions: string[];
  preferredInstitutions: string[];
  preferredCountries: string[];
  hardCountries: boolean;
  preferredWorkModes: string[];
  compatibleQualifications: string[];
  incompatibleQualifications: string[];
  unknownPolicy: "allow" | "exclude";
  typeWeights: Partial<Record<OpportunityType, number>>;
}
export interface Profile {
  id: string;
  revision: number;
  timezone: string | null;
  enabled: boolean;
  rules: Rules;
}
export interface Assessment {
  opportunityId: string;
  opportunityRevision: number;
  profileRevision: number;
  eligible: boolean;
  score: number | null;
  reasonCodes: string[];
  components: ObjectValue;
  rulesVersion: string;
  evaluatedAt: string;
  validUntil: string;
  nextDeadline: string | null;
  firstSeenAt: string;
}
export function parseRules(input: ObjectValue): Rules {
  const strings = (name: string): string[] => {
    const value = input[name] ?? [];
    if (!Array.isArray(value) || value.length > 100 || value.some((v) => typeof v !== "string")) {
      throw new DomainError("invalid_profile_rules");
    }
    return tags(value as string[]);
  };
  const positives = input.positive_topics ?? [];
  const enabledTypes = input.enabled_types ?? [...opportunityTypes];
  if (
    !Array.isArray(enabledTypes) ||
    enabledTypes.some((t) => !opportunityTypes.includes(t as OpportunityType))
  ) {
    throw new DomainError("invalid_enabled_types");
  }
  if (!Array.isArray(positives) || positives.length > 100) {
    throw new DomainError("invalid_profile_topics");
  }
  const positiveTopics = positives.map((v) => {
    if (typeof v === "string") return { phrase: key(v), weight: 1, aliases: [] };
    if (
      !v || Array.isArray(v) || typeof v !== "object" || typeof v.phrase !== "string" ||
      typeof v.weight !== "number" || !Number.isFinite(v.weight) || v.weight <= 0 || v.weight > 100
    ) throw new DomainError("invalid_profile_topics");
    const aliases = v.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== "string")) {
      throw new DomainError("invalid_topic_aliases");
    }
    return { phrase: key(v.phrase), weight: v.weight, aliases: tags(aliases as string[]) };
  });
  if (positiveTopics.some((t) => !t.phrase || t.phrase.length > 160)) {
    throw new DomainError("invalid_profile_topics");
  }
  const rawWeights = input.type_weights ?? {};
  if (!rawWeights || Array.isArray(rawWeights) || typeof rawWeights !== "object") {
    throw new DomainError("invalid_type_weights");
  }
  const typeWeights: Partial<Record<OpportunityType, number>> = {};
  for (const [type, weight] of Object.entries(rawWeights)) {
    if (
      !opportunityTypes.includes(type as OpportunityType) || typeof weight !== "number" ||
      !Number.isFinite(weight) || weight < 0 || weight > 1
    ) throw new DomainError("invalid_type_weights");
    typeWeights[type as OpportunityType] = weight;
  }
  if (
    input.unknown_policy != null && !["allow", "exclude"].includes(String(input.unknown_policy))
  ) throw new DomainError("invalid_unknown_policy");
  if (input.hard_countries != null && typeof input.hard_countries !== "boolean") {
    throw new DomainError("invalid_geography_rules");
  }
  return {
    enabledTypes: enabledTypes as OpportunityType[],
    positiveTopics,
    blockedTopics: strings("blocked_topics"),
    ignoredTopics: strings("ignored_topics"),
    blockedInstitutions: strings("blocked_institutions"),
    preferredInstitutions: strings("preferred_institutions"),
    preferredCountries: strings("preferred_countries").map((x) => x.toUpperCase()),
    hardCountries: input.hard_countries === true,
    preferredWorkModes: strings("preferred_work_modes"),
    compatibleQualifications: strings("compatible_qualifications"),
    incompatibleQualifications: strings("incompatible_qualifications"),
    unknownPolicy: input.unknown_policy === "exclude" ? "exclude" : "allow",
    typeWeights,
  };
}
export function phraseMatch(haystack: string, phrase: string): boolean {
  const escaped = key(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(escaped) &&
    new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u").test(key(haystack));
}
export function assess(
  opportunity: Opportunity,
  profile: Profile,
  state: { saved: boolean; ignored: boolean },
  now: string,
  enabledTypes: readonly string[] = opportunityTypes,
): Assessment {
  const f = opportunity.fields, r = profile.rules, t = Date.parse(now);
  if (!Number.isFinite(t)) throw new DomainError("invalid_clock");
  const corpus = [f.title, f.description ?? "", ...f.topics].join(" ");
  const reasons: string[] = [], warnings: string[] = [...f.qualityFlags];
  if (!enabledTypes.includes(f.type) || !r.enabledTypes.includes(f.type)) {
    reasons.push("disabled_type");
  }
  if (!profile.enabled) reasons.push("profile_disabled");
  if (state.ignored) reasons.push("ignored");
  if (["withdrawn", "closed", "merged"].includes(f.status)) reasons.push("closed_or_withdrawn");
  if (r.blockedTopics.some((x) => phraseMatch(corpus, x))) reasons.push("blocked_topic");
  if (r.ignoredTopics.some((x) => phraseMatch(corpus, x))) reasons.push("ignored_topic");
  if (f.organizationKey && r.blockedInstitutions.includes(f.organizationKey)) {
    reasons.push("blocked_institution");
  }
  if (
    r.hardCountries && r.preferredCountries.length && f.countryCodes.length &&
    !f.countryCodes.some((x) => r.preferredCountries.includes(x))
  ) reasons.push("hard_geography_mismatch");
  if (f.qualificationTags.some((x) => r.incompatibleQualifications.includes(x))) {
    reasons.push("qualification_conflict");
  }
  const unknowns = !f.countryCodes.length || !f.qualificationTags.length;
  if (r.unknownPolicy === "exclude" && unknowns) reasons.push("unknown_data_excluded");
  if (!f.countryCodes.length) warnings.push("unknown_geography");
  if (!f.qualificationTags.length) warnings.push("unknown_qualifications");
  const actionable = opportunity.deadlines.filter((d) =>
    ["application", "abstract", "submission", "registration"].includes(d.kind) &&
    d.status !== "superseded"
  );
  const expiry = (d: typeof actionable[number]) =>
    d.status === "conflicted"
      ? null
      : d.dueAt
      ? Date.parse(d.dueAt)
      : d.dueDate
      ? calendarEnd(d.dueDate)
      : null;
  const category = family(f.type);
  if (category === "event") {
    const end = f.eventEnd ?? f.eventStart;
    if (end && calendarEnd(end) <= t) reasons.push("event_expired");
  } else if (
    actionable.length > 0 && actionable.every((d) => expiry(d) !== null && expiry(d)! <= t)
  ) reasons.push("deadline_expired");
  const available = actionable.filter((d) => expiry(d) !== null && expiry(d)! > t).sort((a, b) =>
    expiry(a)! - expiry(b)!
  );
  const first = available[0];
  const zone = profile.timezone && validZone(profile.timezone) ? profile.timezone : "UTC";
  const days = first?.precision === "date"
    ? (Date.parse(`${first.dueDate}T00:00:00Z`) - Date.parse(`${localDate(now, zone)}T00:00:00Z`)) /
      86400000
    : first?.dueAt
    ? Math.floor((Date.parse(first.dueAt) - t) / 86400000)
    : null;
  const nextDeadline = first?.dueAt ??
    (first?.dueDate ? new Date(calendarEnd(first.dueDate)).toISOString() : null);
  const until = Math.min(
    t + 86400000,
    ...available.map((d) => expiry(d)!),
    ...(category === "event" && (f.eventEnd ?? f.eventStart)
      ? [calendarEnd((f.eventEnd ?? f.eventStart)!)]
      : []),
  );
  const base = {
    opportunityId: opportunity.id,
    opportunityRevision: opportunity.revision,
    profileRevision: profile.revision,
    rulesVersion,
    evaluatedAt: now,
    validUntil: new Date(Math.max(t + 1000, until)).toISOString(),
    nextDeadline,
    firstSeenAt: opportunity.firstSeenAt,
  };
  if (reasons.length) {
    return {
      ...base,
      eligible: false,
      score: null,
      reasonCodes: ordered(reasons),
      components: { exclusions: ordered(reasons), quality_flags: ordered(warnings) },
    };
  }
  const matched = r.positiveTopics.filter((topic) =>
    [topic.phrase, ...topic.aliases].some((x) => phraseMatch(corpus, x))
  );
  const total = r.positiveTopics.reduce((n, topic) => n + topic.weight, 0);
  const topic = total ? 40 * Math.min(1, matched.reduce((n, x) => n + x.weight, 0) / total) : 0;
  const freshnessDays = Math.max(0, (t - Date.parse(opportunity.firstSeenAt)) / 86400000);
  const components: ObjectValue = {
    topic_match: Math.round(topic * 100) / 100,
    type_preference: 15 * (r.typeWeights[f.type] ?? 0),
    geography_preference: f.countryCodes.some((x) => r.preferredCountries.includes(x)) ||
        r.preferredWorkModes.includes(f.workMode) && f.workMode !== "unknown"
      ? 10
      : 0,
    institution_preference: f.organizationKey && r.preferredInstitutions.includes(f.organizationKey)
      ? 10
      : 0,
    deadline_usefulness: days !== null && days >= 3 && days <= 30
      ? 10
      : days !== null && days >= 31 && days <= 90
      ? 6
      : days !== null && days >= 0 && days <= 2
      ? 3
      : 0,
    freshness: freshnessDays <= 7 ? 10 : freshnessDays <= 30 ? 5 : 0,
    qualification_match: f.qualificationTags.some((x) => r.compatibleQualifications.includes(x))
      ? 5
      : 0,
  };
  const score = Math.min(
    100,
    Math.round(
      Object.values(components).reduce<number>((sum, value) => sum + Number(value), 0) * 100,
    ) / 100,
  );
  components.matched_terms = matched.map((x) => x.phrase).sort();
  components.quality_flags = ordered(warnings);
  components.date_only_advisory = first?.precision === "date";
  if (!total) reasons.push("profile_topics_unconfigured");
  return {
    ...base,
    eligible: true,
    score,
    reasonCodes: ordered([
      ...reasons,
      ...Object.entries(components).filter(([, v]) => typeof v === "number" && v > 0).map(([k]) =>
        k
      ),
    ]),
    components,
  };
}
export function orderAssessments(values: Assessment[]): Assessment[] {
  return [...values].sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) || (b.score ?? -1) - (a.score ?? -1) ||
    compare(a.nextDeadline ?? "9999", b.nextDeadline ?? "9999") ||
    compare(b.firstSeenAt, a.firstSeenAt) || compare(a.opportunityId, b.opportunityId)
  );
}
