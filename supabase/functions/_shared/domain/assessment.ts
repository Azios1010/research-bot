import {
  DomainError,
  family,
  type ObjectValue,
  type Opportunity,
  opportunityTypes,
} from "./model.ts";
import { compare, ordered, text } from "./primitives.ts";
import { calendarEnd, localDate, validZone } from "./temporal.ts";

import { type Rules } from "./profile.ts";
export { parseRules, type Rules } from "./profile.ts";
export const rulesVersion = "deterministic-v2";
export const provisionalThreshold = 40;
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
export function phraseMatch(haystack: string, phrase: string): boolean {
  // Hyphenation/punctuation separate phrase tokens; technical symbols (C++) remain literal.
  // The bounded canonical corpus includes a 16,000-unit description plus title/topics.
  // The general short-key limit (1,024) must never reject an otherwise valid opportunity.
  const normalize = (s: string) =>
    text(s.normalize("NFKC").toLowerCase(), 200000).replace(/[\p{Pd}\s,;:!?()[\]{}"“”]+/gu, " ")
      .trim();
  const escaped = normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(escaped) &&
    new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])`, "u").test(
      normalize(haystack),
    );
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
  if (f.countryCodes.some((c) => r.excludedCountries.includes(c))) reasons.push("excluded_country");
  if (
    r.hardCountries && r.preferredCountries.length && f.countryCodes.length &&
    !f.countryCodes.some((x) => r.preferredCountries.includes(x))
  ) reasons.push("hard_geography_mismatch");
  if (f.qualificationTags.some((x) => r.incompatibleQualifications.includes(x))) {
    reasons.push("qualification_conflict");
  }
  const position = f.attributes.position;
  const evidence = position && !Array.isArray(position) && typeof position === "object"
    ? position.eligibility
    : null;
  const eligibility = evidence && !Array.isArray(evidence) && typeof evidence === "object"
    ? evidence
    : {};
  if (eligibility.student_full_time === true && r.eligibilityFacts.studentFullTime === false) {
    reasons.push("eligibility_conflict");
  }
  const excluded = Array.isArray(eligibility.excluded_nationalities)
    ? eligibility.excluded_nationalities
    : [];
  // Multiple citizenships may permit eligibility; only all known citizenships excluded is definite.
  if (
    r.eligibilityFacts.nationalities.length &&
    r.eligibilityFacts.nationalities.every((c) => excluded.includes(c))
  ) {
    reasons.push("eligibility_conflict");
  }
  if (
    eligibility.student_full_time === true && r.eligibilityFacts.studentFullTime === null ||
    eligibility.nationality_group || eligibility.degree_level || eligibility.degree_levels
  ) {
    warnings.push("eligibility_requires_confirmation");
  }
  const unknowns = !f.countryCodes.length || !f.qualificationTags.length ||
    f.workMode === "unknown";
  if (r.unknownPolicy === "exclude" && unknowns) reasons.push("unknown_data_excluded");
  if (!f.countryCodes.length) warnings.push("unknown_geography");
  if (!f.qualificationTags.length) warnings.push("unknown_qualifications");
  if (f.workMode === "unknown") warnings.push("unknown_work_mode");
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
  if (!first) warnings.push("unknown_deadline");
  const zone = profile.timezone && validZone(profile.timezone) ? profile.timezone : "UTC";
  const days = first?.precision === "date"
    ? (Date.parse(`${first.dueDate}T00:00:00Z`) - Date.parse(`${localDate(now, zone)}T00:00:00Z`)) /
      86400000
    : first?.dueAt
    ? Math.floor((Date.parse(first.dueAt) - t) / 86400000)
    : null;
  const nextDeadline = first?.dueAt ??
    (first?.dueDate ? new Date(calendarEnd(first.dueDate)).toISOString() : null);
  const changes: number[] = [];
  for (const days of [7, 30]) {
    changes.push(Date.parse(opportunity.firstSeenAt) + days * 86400000 + 1);
  }
  // floor(remaining days) crosses these score boundaries just after the exact instant.
  if (first?.dueAt) {
    for (const days of [3, 31, 91]) changes.push(Date.parse(first.dueAt) - days * 86400000 + 1);
  }
  if (first?.precision === "date") {
    const date = localDate(now, zone);
    let low = t, high = t + 36 * 3600000;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (localDate(new Date(mid).toISOString(), zone) === date) low = mid;
      else high = mid;
    }
    changes.push(high);
  }
  const until = Math.min(
    t + 86400000,
    ...changes.filter((n) => n > t),
    ...available.map((d) => expiry(d)!),
    ...(category === "event" && (f.eventEnd ?? f.eventStart)
      ? [calendarEnd((f.eventEnd ?? f.eventStart)!)].filter((n) => n > t)
      : []),
  );
  const base = {
    opportunityId: opportunity.id,
    opportunityRevision: opportunity.revision,
    profileRevision: profile.revision,
    rulesVersion,
    evaluatedAt: now,
    validUntil: new Date(until).toISOString(),
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
  components.deadline_days = days;
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
