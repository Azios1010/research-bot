import { type Assessment, type Profile } from "../domain/assessment.ts";
import {
  type CandidateSet,
  type ObjectValue,
  type Opportunity,
  type OpportunityType,
  type PageResult,
  type ParsedRecord,
  type Proposal,
  type RecordError,
  type StrongIdentity,
  type Value,
} from "../domain/model.ts";

export interface Clock {
  now(): string;
}
export type TaskKind = "collect_page" | "assess_batch" | "telegram_command" | "send_notification";
export interface Lease {
  id: string;
  owner: string;
  generation: number;
  kind: TaskKind;
  attempt: number;
  leaseUntil: string;
  runId: string | null;
}
export interface HttpRequest {
  url: string;
  method: "GET" | "HEAD" | "POST";
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}
export interface HttpResponse {
  status: number;
  body: string;
  contentType: string | null;
  headers: Readonly<Record<string, string>>;
}
export interface HttpClient {
  request(input: HttpRequest): Promise<HttpResponse>;
}
export interface Source {
  id: string;
  slug: string;
  enabled: boolean;
  approved: boolean;
  parserVersion: string;
  configVersion: number;
  config: ObjectValue;
}
export interface CollectionContext {
  source: Source;
  runId: string;
  sequence: number;
  cursorHash: string;
  cursor: Value;
  validators: ObjectValue;
  sourceRevision: string | null;
  replayed: boolean;
  paused: boolean;
}
export interface CollectionLimits {
  timeoutMs: number;
  maxBytes: number;
  maxRecords: number;
}
export const collectionLimits: Readonly<CollectionLimits> = {
  timeoutMs: 15000,
  maxBytes: 2097152,
  maxRecords: 100,
};
export interface CollectContext {
  http: HttpClient;
  clock: Clock;
  signal: AbortSignal;
  limits: Readonly<CollectionLimits>;
  source: Source;
}
export interface CollectedPage {
  payload: string;
  format: string;
  sourceUrl: string;
  fetchedAt: string;
  sourceRevision: string | null;
  nextCursor: Value;
  validators: ObjectValue;
  notModified: boolean;
}
export interface SourceAdapter {
  readonly slug: string;
  readonly parserVersion: string;
  readonly supportedTypes: readonly OpportunityType[];
  collectPage(
    context: CollectContext,
    cursor: Value,
    validators: ObjectValue,
  ): Promise<CollectedPage>;
  parsePage(page: CollectedPage): Iterable<ParsedRecord | RecordError>;
}
export interface LookupRequest {
  recordKey: string;
  fingerprint: string;
  fingerprintVersion: number;
  identities: StrongIdentity[];
}
export interface AssessmentContext {
  profile: Profile;
  opportunities: Opportunity[];
  states: Readonly<Record<string, { saved: boolean; ignored: boolean }>>;
  enabledTypes: string[];
}
export interface Repository {
  createRun(
    sourceId: string,
    requestKey: string,
    trigger: "manual" | "test",
    signal?: AbortSignal,
  ): Promise<string>;
  claim(
    owner: string,
    kinds: readonly TaskKind[],
    signal?: AbortSignal,
    leaseSeconds?: number,
  ): Promise<Lease | null>;
  renew(lease: Lease, signal?: AbortSignal): Promise<Lease>;
  finish(
    lease: Lease,
    outcome: "failed" | "retry" | "canceled",
    code: string,
    delay: number,
    signal?: AbortSignal,
  ): Promise<void>;
  collection(lease: Lease, signal?: AbortSignal): Promise<CollectionContext>;
  candidates(
    lease: Lease,
    records: readonly LookupRequest[],
    signal?: AbortSignal,
  ): Promise<CandidateSet[]>;
  commit(
    lease: Lease,
    context: CollectionContext,
    page: CollectedPage,
    records: readonly Proposal[],
    signal?: AbortSignal,
  ): Promise<PageResult>;
  assessment(lease: Lease, signal?: AbortSignal): Promise<AssessmentContext>;
  storeAssessments(
    lease: Lease,
    assessments: readonly Assessment[],
    signal?: AbortSignal,
  ): Promise<number>;
}
export type LogEvent =
  | "task_started"
  | "page_committed"
  | "assessment_stored"
  | "task_failed"
  | "lease_lost"
  | "worker_finished";
export interface LogContext {
  sourceSlug?: string;
  runId?: string;
  taskId?: string;
  pageSequence?: number;
  leaseGeneration?: number;
  inserted?: number;
  updated?: number;
  duplicates?: number;
  rejected?: number;
  count?: number;
  durationMs?: number;
  errorCode?: string;
}
export interface Logger {
  log(event: LogEvent, context: LogContext): void;
}
export class ProcessingError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
    public readonly retryAfter = 0,
    public readonly canceled = false,
  ) {
    super(code);
  }
}
