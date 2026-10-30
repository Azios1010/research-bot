import type { Assessment } from "../domain/assessment.ts";
import type { ObjectValue } from "../domain/model.ts";

const reasons: Record<string, string> = {
  disabled_type: "Opportunity type is disabled",
  profile_disabled: "Profile is disabled",
  ignored: "Explicitly ignored",
  closed_or_withdrawn: "Closed or withdrawn",
  blocked_topic: "Blocked topic",
  ignored_topic: "Ignored topic",
  blocked_institution: "Excluded institution",
  hard_geography_mismatch: "Outside required geography",
  excluded_country: "Hard-excluded country",
  qualification_conflict: "Known qualification conflict",
  eligibility_conflict: "Known eligibility conflict",
  unknown_data_excluded: "Unknown facts excluded by your policy",
  event_expired: "Event has ended",
  deadline_expired: "Actionable deadlines have passed",
  topic_match: "Matched research topics",
  type_preference: "Preferred opportunity type",
  geography_preference: "Preferred country or work mode",
  institution_preference: "Preferred institution",
  deadline_usefulness: "Useful deadline window",
  freshness: "Recently first seen",
  qualification_match: "Explicit compatible qualification evidence",
  unknown_geography: "Country unknown",
  unknown_qualifications: "Qualification evidence unknown",
  unknown_work_mode: "Work mode unknown",
  eligibility_requires_confirmation: "Additional eligibility needs confirmation",
  unknown_deadline: "No confirmed upcoming deadline",
  conflicting_deadline: "Deadline evidence conflicts",
};
export function explainAssessment(codes: string[], components: ObjectValue): string[] {
  const terms = Array.isArray(components.matched_terms)
    ? components.matched_terms.filter((t): t is string => typeof t === "string").slice(0, 3)
    : [];
  const priority = [
    "ignored",
    "disabled_type",
    "profile_disabled",
    "blocked_topic",
    "ignored_topic",
    "blocked_institution",
    "excluded_country",
    "hard_geography_mismatch",
    "qualification_conflict",
    "eligibility_conflict",
    "unknown_data_excluded",
    "closed_or_withdrawn",
    "event_expired",
    "deadline_expired",
    "topic_match",
    "type_preference",
    "geography_preference",
    "institution_preference",
    "deadline_usefulness",
    "freshness",
    "qualification_match",
  ];
  const result = codes.filter((c) => reasons[c]).sort((a, b) =>
    priority.indexOf(a) - priority.indexOf(b)
  ).slice(0, 5).map((c) =>
    c === "topic_match" && terms.length ? `Topics: ${terms.join(", ")}` : reasons[c]
  );
  if (components.date_only_advisory === true) {
    result.push("Date-only deadline; exact closing time unknown");
  }
  const warnings = Array.isArray(components.quality_flags) ? components.quality_flags : [];
  result.push(
    ...warnings.filter((c): c is string => typeof c === "string" && Boolean(reasons[c])).slice(0, 2)
      .map((c) => `Note: ${reasons[c]}`),
  );
  return result.slice(0, 8);
}

// Future extension contract only. A caller must supply <=50 deterministically eligible
// assessments and validate a permutation of those IDs; failure retains deterministic order.
// No provider, credentials, embeddings or calls are implemented in Phase 08.
export interface ShortlistReranker {
  rerank(shortlist: readonly Assessment[], signal: AbortSignal): Promise<readonly string[]>;
}
