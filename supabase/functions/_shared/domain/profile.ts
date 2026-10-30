import { DomainError, type ObjectValue, type OpportunityType, opportunityTypes } from "./model.ts";
import { boundedObject, countryCodes, key, ordered } from "./primitives.ts";

export const profileSchemaVersion = 1;
export interface Rules {
  enabledTypes: OpportunityType[];
  positiveTopics: { phrase: string; weight: number; aliases: string[] }[];
  blockedTopics: string[];
  ignoredTopics: string[];
  blockedInstitutions: string[];
  preferredInstitutions: string[];
  preferredCountries: string[];
  excludedCountries: string[];
  hardCountries: boolean;
  preferredWorkModes: string[];
  compatibleQualifications: string[];
  incompatibleQualifications: string[];
  eligibilityFacts: { studentFullTime: boolean | null; nationalities: string[] };
  unknownPolicy: "allow" | "exclude";
  typeWeights: Partial<Record<OpportunityType, number>>;
  reminderOffsets: number[];
  threshold: number;
}
export const ruleFields = [
  "enabled_types",
  "positive_topics",
  "blocked_topics",
  "ignored_topics",
  "blocked_institutions",
  "preferred_institutions",
  "preferred_countries",
  "excluded_countries",
  "hard_countries",
  "preferred_work_modes",
  "compatible_qualifications",
  "incompatible_qualifications",
  "eligibility_facts",
  "unknown_policy",
  "type_weights",
  "reminder_offsets",
  "digest_threshold",
] as const;

// Absent fields are unknown/empty legacy settings, never invented researcher facts.
// Duplicate lists normalize deterministically; malformed/unsupported fields are errors.
export function parseRules(input: ObjectValue): Rules {
  boundedObject(input, 16384);
  if (Object.keys(input).some((k) => !(ruleFields as readonly string[]).includes(k))) {
    throw new DomainError("unsupported_profile_field");
  }
  const strings = (value: unknown, maximum = 20, length = 160): string[] => {
    if (
      !Array.isArray(value) || value.length > maximum ||
      value.some((v) => typeof v !== "string" || !v.trim() || v.length > length)
    ) {
      throw new DomainError("invalid_profile_list");
    }
    const result = ordered(value.map((v) => key(v)));
    if (result.some((v) => v.length > length)) throw new DomainError("invalid_profile_list");
    return result;
  };
  const list = (name: string) => strings(input[name] ?? []);
  const enabled = strings(input.enabled_types ?? [...opportunityTypes], 11);
  if (enabled.some((t) => !opportunityTypes.includes(t as OpportunityType))) {
    throw new DomainError("invalid_enabled_types");
  }
  const positives = input.positive_topics ?? [];
  if (!Array.isArray(positives) || positives.length > 20) {
    throw new DomainError("invalid_profile_topics");
  }
  const positiveTopics = positives.map((v) => {
    if (typeof v === "string") return { phrase: strings([v])[0], weight: 1, aliases: [] };
    if (
      !v || Array.isArray(v) || typeof v !== "object" ||
      Object.keys(v).some((k) => !["phrase", "weight", "aliases"].includes(k)) ||
      typeof v.weight !== "number" || !Number.isFinite(v.weight) || v.weight <= 0 || v.weight > 100
    ) {
      throw new DomainError("invalid_profile_topics");
    }
    return {
      phrase: strings([v.phrase])[0],
      weight: v.weight,
      aliases: strings(v.aliases ?? [], 10),
    };
  });
  if (new Set(positiveTopics.map((x) => x.phrase)).size !== positiveTopics.length) {
    throw new DomainError("duplicate_positive_topic");
  }
  const rawWeights = input.type_weights ?? {};
  if (!rawWeights || Array.isArray(rawWeights) || typeof rawWeights !== "object") {
    throw new DomainError("invalid_type_weights");
  }
  const typeWeights: Rules["typeWeights"] = {};
  for (const [type, weight] of Object.entries(rawWeights)) {
    if (
      !opportunityTypes.includes(type as OpportunityType) || typeof weight !== "number" ||
      !Number.isFinite(weight) || weight < 0 || weight > 1
    ) {
      throw new DomainError("invalid_type_weights");
    }
    typeWeights[type as OpportunityType] = weight;
  }
  if (
    input.unknown_policy !== undefined &&
    !["allow", "exclude"].includes(String(input.unknown_policy))
  ) {
    throw new DomainError("invalid_unknown_policy");
  }
  if (input.hard_countries !== undefined && typeof input.hard_countries !== "boolean") {
    throw new DomainError("invalid_geography_rules");
  }
  const preferredWorkModes = list("preferred_work_modes");
  if (preferredWorkModes.some((v) => !["onsite", "hybrid", "remote"].includes(v))) {
    throw new DomainError("invalid_work_mode");
  }
  const facts = input.eligibility_facts ?? {};
  if (
    !facts || Array.isArray(facts) || typeof facts !== "object" ||
    Object.keys(facts).some((k) => !["student_full_time", "nationalities"].includes(k)) ||
    facts.student_full_time != null && typeof facts.student_full_time !== "boolean"
  ) {
    throw new DomainError("invalid_eligibility_facts");
  }
  const offsets = input.reminder_offsets ?? [];
  if (
    input.digest_threshold !== undefined && (typeof input.digest_threshold !== "number" ||
      !Number.isFinite(input.digest_threshold) || input.digest_threshold < 0 ||
      input.digest_threshold > 100)
  ) {
    throw new DomainError("invalid_threshold");
  }
  if (
    !Array.isArray(offsets) || offsets.length > 12 ||
    offsets.some((n) => typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 365)
  ) {
    throw new DomainError("invalid_reminder_offsets");
  }
  return {
    enabledTypes: enabled as OpportunityType[],
    positiveTopics,
    blockedTopics: list("blocked_topics"),
    ignoredTopics: list("ignored_topics"),
    blockedInstitutions: list("blocked_institutions"),
    preferredInstitutions: list("preferred_institutions"),
    preferredCountries: countryCodes(list("preferred_countries")),
    excludedCountries: countryCodes(list("excluded_countries")),
    hardCountries: input.hard_countries === true,
    preferredWorkModes,
    compatibleQualifications: list("compatible_qualifications"),
    incompatibleQualifications: list("incompatible_qualifications"),
    eligibilityFacts: {
      studentFullTime: facts.student_full_time as boolean | null ?? null,
      nationalities: countryCodes(strings(facts.nationalities ?? [])),
    },
    unknownPolicy: input.unknown_policy === "exclude" ? "exclude" : "allow",
    typeWeights,
    reminderOffsets: [...new Set(offsets as number[])].sort((a, b) => b - a),
    threshold: typeof input.digest_threshold === "number" ? input.digest_threshold : 40,
  };
}
