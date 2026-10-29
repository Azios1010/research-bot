export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type ObjectValue = { [key: string]: Value };

export const opportunityTypes = [
  "phd",
  "postdoc",
  "research_assistant",
  "research_internship",
  "conference",
  "workshop",
  "conference_cfp",
  "journal_cfp",
  "journal_special_issue",
  "grant",
  "research_funding",
] as const;
export type OpportunityType = typeof opportunityTypes[number];
export type Family = "position" | "event" | "call" | "funding";
export function family(type: OpportunityType): Family {
  if (["phd", "postdoc", "research_assistant", "research_internship"].includes(type)) {
    return "position";
  }
  if (["conference", "workshop"].includes(type)) return "event";
  return ["grant", "research_funding"].includes(type) ? "funding" : "call";
}
export const deadlineKinds = [
  "application",
  "abstract",
  "submission",
  "registration",
  "rebuttal",
  "decision",
  "other",
] as const;
export type DeadlineKind = typeof deadlineKinds[number];
export type WorkMode = "onsite" | "hybrid" | "remote" | "unknown";
export type Lifecycle = "open" | "closed" | "withdrawn" | "unknown" | "merged";
export const qualityFlags = [
  "missing_organization",
  "incomplete_location",
  "missing_publication_time",
  "unknown_timezone",
  "ambiguous_time",
  "ambiguous_round",
  "conflicting_identity_candidate",
  "conflicting_deadline",
  "unknown_work_mode",
  "invalid_optional_date",
] as const;
export type QualityFlag = typeof qualityFlags[number];
export class DomainError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface TemporalEvidence {
  value: string | null;
  timezone?: string | null;
  basis?: "explicit" | "source_default" | "unknown";
  aoeSupported?: boolean;
}
export interface DeadlineDraft extends TemporalEvidence {
  kind: DeadlineKind;
  roundKey: string | null;
  label: string;
}
export interface Deadline {
  id?: string;
  kind: DeadlineKind;
  roundKey: string;
  label: string;
  dueAt: string | null;
  dueDate: string | null;
  timezone: string | null;
  rawValue: string | null;
  precision: "instant" | "date" | "unknown";
  basis: "explicit" | "source_default" | "unknown";
  status: "current" | "superseded" | "conflicted";
  revision?: number;
  sourceRecordId?: string | null;
}
export interface IdentityEvidence {
  kind: "listing_url";
  value: string;
  reviewed: boolean;
  listingSpecific: boolean;
}
export interface OpportunityDraft {
  type: string;
  title: string;
  organization?: string | null;
  description?: string | null;
  topics?: string[];
  qualificationTags?: string[];
  countryCodes?: string[];
  locationText?: string | null;
  workMode?: string | null;
  canonicalUrl?: string | null;
  publishedAt?: string | null;
  cycleKey?: string | null;
  trackKey?: string | null;
  eventStart?: string | null;
  eventEnd?: string | null;
  status?: string;
  attributes?: ObjectValue;
  deadlines?: DeadlineDraft[];
  identities?: IdentityEvidence[];
}
export interface Fields {
  type: OpportunityType;
  title: string;
  titleKey: string;
  organization: string | null;
  organizationKey: string | null;
  description: string | null;
  topics: string[];
  qualificationTags: string[];
  countryCodes: string[];
  locationText: string | null;
  workMode: WorkMode;
  canonicalUrl: string | null;
  publishedAt: string | null;
  cycleKey: string | null;
  trackKey: string | null;
  parentId: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  status: Lifecycle;
  attributes: ObjectValue;
  qualityFlags: QualityFlag[];
}
export interface Origin {
  sourceId: string;
  sourceSlug: string;
  sourceRecordKey: string;
  sourceRecordId?: string;
  parserVersion: string;
  observedAt: string;
  authority: number;
}
export type Provenance = Record<string, Origin>;
export interface StrongIdentity {
  kind: "listing_url" | "natural_key";
  version: number;
  value: string;
  evidence: ObjectValue;
}
export interface NormalizedOpportunity {
  fields: Fields;
  deadlines: Deadline[];
  fingerprint: string;
  fingerprintVersion: number;
  identities: StrongIdentity[];
}
export interface Opportunity extends NormalizedOpportunity {
  id: string;
  revision: number;
  evidenceVersion: string;
  firstSeenAt: string;
  provenance: Provenance;
}
export interface ParsedRecord {
  kind: "record";
  sourceRecordKey: string;
  sourceUrl: string;
  draft: OpportunityDraft;
  metadata: ObjectValue;
}
export interface RecordError {
  kind: "error";
  sourceRecordKey: string | null;
  code: string;
}
export interface CandidateSet {
  recordKey: string;
  observationId: string | null;
  observationOpportunityId: string | null;
  strongIds: string[];
  candidates: Opportunity[];
  truncated: boolean;
}
export interface Proposal {
  recordKey: string;
  sourceUrl: string;
  parserVersion: string;
  payloadHash: string;
  disposition: "accepted" | "quarantined" | "conflict";
  errorCode?: string;
  canonical?: NormalizedOpportunity;
  provenance?: Provenance;
  targetId?: string;
  expectedRevision?: number;
  expectedEvidenceVersion?: string;
  snapshot?: ObjectValue;
  metadata: ObjectValue;
}
export interface PageResult {
  replayed: boolean;
  runId: string;
  inserted: number;
  updated: number;
  duplicates: number;
  rejected: number;
}
