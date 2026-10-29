import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types.ts";
import type { Assessment } from "../../domain/assessment.ts";
import { parseRules } from "../../domain/assessment.ts";
import { instant } from "../../domain/temporal.ts";
import {
  type CandidateSet,
  type Deadline,
  type Fields,
  type ObjectValue,
  type Opportunity,
  opportunityTypes,
  type Origin,
  type PageResult,
  type Proposal,
  type Provenance,
  qualityFlags,
  type Value,
} from "../../domain/model.ts";
import {
  type AssessmentContext,
  type CollectedPage,
  type CollectionContext,
  type Lease,
  type LookupRequest,
  ProcessingError,
  type Repository,
  type TaskKind,
} from "../../application/ports.ts";

type Tables = Database["radar"]["Tables"];
type Functions = Database["public"]["Functions"];
type RpcName = keyof Functions;
const encode = (value: unknown): Json => JSON.parse(JSON.stringify(value));
const object = (value: unknown): Record<string, unknown> => {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ProcessingError("persistence_shape_invalid");
  }
  return value as Record<string, unknown>;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new ProcessingError("persistence_shape_invalid");
  return value;
};
const jsonObject = (value: unknown): ObjectValue => object(value) as ObjectValue;
const string = (value: unknown): string => {
  if (typeof value !== "string") throw new ProcessingError("persistence_shape_invalid");
  return value;
};
const integer = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ProcessingError("persistence_integer_invalid");
  }
  return Number(value);
};
const fence = (lease: Lease) => ({
  p_task: lease.id,
  p_owner: lease.owner,
  p_generation: lease.generation,
});
const names = {
  type: "type_code",
  title: "title",
  titleKey: "title_key",
  organization: "organization",
  organizationKey: "organization_key",
  description: "description",
  topics: "topics",
  qualificationTags: "qualification_tags",
  countryCodes: "country_codes",
  locationText: "location_text",
  workMode: "work_mode",
  canonicalUrl: "canonical_url",
  publishedAt: "published_at",
  cycleKey: "cycle_key",
  trackKey: "track_key",
  parentId: "parent_opportunity_id",
  eventStart: "event_start",
  eventEnd: "event_end",
  status: "status",
  attributes: "attributes",
  qualityFlags: "quality_flags",
} as const;
const toColumns = (fields: Fields) =>
  Object.fromEntries(
    Object.entries(names).map(([field, column]) => [column, fields[field as keyof Fields]]),
  );

function provenance(provenance: Provenance): Json {
  return encode(
    Object.fromEntries(
      Object.entries(provenance).map(([field, origin]) => [names[field as keyof Fields] ?? field, {
        source_id: origin.sourceId,
        source_record_key: origin.sourceRecordKey,
        source_slug: origin.sourceSlug,
        ...(origin.sourceRecordId ? { source_record_id: origin.sourceRecordId } : {}),
        parser_version: origin.parserVersion,
        observed_at: origin.observedAt,
        authority: origin.authority,
      }]),
    ),
  );
}
export function proposalRow(proposal: Proposal): Json {
  return encode({
    source_record_key: proposal.recordKey,
    source_url: proposal.sourceUrl,
    parser_version: proposal.parserVersion,
    payload_hash: proposal.payloadHash,
    record_status: proposal.disposition === "quarantined" ? "quarantined" : "accepted",
    error_code: proposal.errorCode,
    metadata: proposal.metadata,
    normalized_snapshot: proposal.snapshot ?? {},
    ...(proposal.canonical
      ? {
        canonical: {
          ...toColumns(proposal.canonical.fields),
          fingerprint: proposal.canonical.fingerprint,
          fingerprint_version: proposal.canonical.fingerprintVersion,
          field_provenance: provenance(proposal.provenance ?? {}),
        },
        identities: proposal.canonical.identities.map((i) => ({
          kind: i.kind,
          key_version: i.version,
          value: i.value,
          evidence: i.evidence,
        })),
        deadlines: proposal.canonical.deadlines.map((d) => ({
          kind: d.kind,
          round_key: d.roundKey,
          label: d.label,
          due_at: d.dueAt,
          due_date: d.dueDate,
          timezone: d.timezone,
          raw_value: d.rawValue,
          precision: d.precision,
          basis: d.basis,
          status: d.status,
        })),
        quality_flags: proposal.canonical.fields.qualityFlags,
      }
      : {}),
    ...(proposal.targetId
      ? {
        target_opportunity_id: proposal.targetId,
        expected_revision: proposal.expectedRevision,
        expected_provenance_token: proposal.expectedEvidenceVersion,
      }
      : {}),
  });
}

// JSON context RPCs have no generated composite return type. Validate the envelope here,
// map its database-owned rows once, and never expose persistence DTOs to the application.
export function opportunityContext(value: unknown): Opportunity {
  const context = object(value),
    row = object(context.opportunity) as unknown as Tables["opportunities"]["Row"];
  if (
    !opportunityTypes.includes(row.type_code as Fields["type"]) || !row.id ||
    !Array.isArray(row.topics) || !Array.isArray(row.quality_flags)
  ) throw new ProcessingError("persistence_shape_invalid");
  const fields = Object.fromEntries(
    Object.entries(names).map(([field, column]) => [field, row[column as keyof typeof row]]),
  ) as unknown as Fields;
  const evidenceVersion = string(context.evidence_version);
  if (!/^[a-f0-9]{64}$/.test(evidenceVersion)) {
    throw new ProcessingError("persistence_shape_invalid");
  }
  fields.qualityFlags = row.quality_flags.filter((flag): flag is Fields["qualityFlags"][number] =>
    qualityFlags.includes(flag as Fields["qualityFlags"][number])
  );
  fields.publishedAt = row.published_at ? instant(row.published_at) : null;
  const origins = new Map<string, Origin>();
  for (const value of list(context.origins)) {
    const origin = object(value);
    origins.set(string(origin.record_id), {
      sourceId: string(origin.source_id),
      sourceSlug: string(origin.source_slug),
      sourceRecordKey: string(origin.record_key),
      sourceRecordId: string(origin.record_id),
      parserVersion: string(origin.parser_version),
      observedAt: instant(string(origin.observed_at)),
      authority: 0,
    });
  }
  const result: Provenance = {};
  for (const [column, value] of Object.entries(object(row.field_provenance))) {
    const field = Object.entries(names).find(([, name]) => name === column)?.[0] ?? column,
      p = object(value);
    const actual = origins.get(String(p.source_record_id));
    if (actual) {
      result[field] = {
        ...actual,
        parserVersion: typeof p.parser_version === "string"
          ? p.parser_version
          : actual.parserVersion,
        observedAt: typeof p.observed_at === "string" ? instant(p.observed_at) : actual.observedAt,
        authority: typeof p.authority === "number" ? p.authority : 0,
      };
    }
  }
  const deadlines = list(context.deadlines).map((value): Deadline => {
    const d = object(value) as unknown as Tables["opportunity_deadlines"]["Row"];
    return {
      id: d.id,
      kind: d.kind as Deadline["kind"],
      roundKey: d.round_key,
      label: d.label,
      dueAt: d.due_at ? instant(d.due_at) : null,
      dueDate: d.due_date,
      timezone: d.timezone,
      rawValue: d.raw_value,
      precision: d.precision as Deadline["precision"],
      basis: d.basis as Deadline["basis"],
      status: d.status as Deadline["status"],
      revision: integer(d.revision),
      sourceRecordId: d.source_record_id,
    };
  });
  return {
    id: row.id,
    revision: integer(row.content_revision),
    evidenceVersion,
    firstSeenAt: instant(row.first_seen_at),
    fields,
    deadlines,
    fingerprint: row.fingerprint,
    fingerprintVersion: integer(row.fingerprint_version),
    identities: [],
    provenance: result,
  };
}

export class SupabaseRepository implements Repository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  private async rpc<K extends RpcName>(
    name: K,
    args: Functions[K]["Args"],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const query = this.client.rpc(name, args);
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    if (error) {
      // Only inspect known SQL messages for classification; never log/return arbitrary details.
      if (error.code === "PT409" || error.code === "40001") {
        throw new ProcessingError("reconciliation_stale", true);
      }
      if (
        error.code === "55000" &&
        ["source_run_not_current", "source_not_collectible"].includes(error.message)
      ) throw new ProcessingError("source_disabled", false, 0, true);
      if (error.code === "55000" && /lease/.test(error.message)) {
        throw new ProcessingError("lease_stale");
      }
      if (error.code === "57014" || ["08006", "53300", "40P01"].includes(error.code)) {
        throw new ProcessingError("backend_temporarily_unavailable", true);
      }
      if (!error.code || error.code.startsWith("PGRST") || error.code === "") {
        throw new ProcessingError("backend_transport_failed", true);
      }
      throw new ProcessingError("persistence_rejected");
    }
    return data;
  }
  private lease(value: unknown): Lease | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw || object(raw).id === null) return null;
    const row = object(raw) as unknown as Tables["job_tasks"]["Row"];
    if (
      !["collect_page", "assess_batch"].includes(row.kind) || !row.lease_owner || !row.lease_until
    ) throw new ProcessingError("persistence_shape_invalid");
    return {
      id: row.id,
      owner: row.lease_owner,
      generation: integer(row.lease_generation),
      kind: row.kind as TaskKind,
      attempt: integer(row.attempts),
      leaseUntil: row.lease_until,
      runId: row.collection_run_id,
    };
  }
  async createRun(
    sourceId: string,
    requestKey: string,
    trigger: "manual" | "test",
    signal?: AbortSignal,
  ) {
    const data = await this.rpc("rr_create_collection_run", {
      p_source_id: sourceId,
      p_request_key: requestKey,
      p_trigger_kind: trigger,
    }, signal);
    return string(object(Array.isArray(data) ? data[0] : data).id);
  }
  async claim(owner: string, kinds: readonly TaskKind[], signal?: AbortSignal, leaseSeconds = 90) {
    return this.lease(
      await this.rpc("rr_claim_task", {
        p_owner: owner,
        p_kinds: [...kinds],
        p_lease_seconds: leaseSeconds,
      }, signal),
    );
  }
  async renew(lease: Lease, signal?: AbortSignal) {
    const renewed = this.lease(
      await this.rpc("rr_renew_task", { ...fence(lease), p_lease_seconds: 90 }, signal),
    );
    if (!renewed) throw new ProcessingError("lease_stale");
    return renewed;
  }
  async finish(
    lease: Lease,
    outcome: "failed" | "retry" | "canceled",
    code: string,
    delay: number,
    signal?: AbortSignal,
  ) {
    await this.rpc("rr_finish_task", {
      ...fence(lease),
      p_result: outcome,
      p_error_code: code,
      p_retry_seconds: delay,
    }, signal);
  }
  async collection(lease: Lease, signal?: AbortSignal): Promise<CollectionContext> {
    const context = object(await this.rpc("rr_read_collection_context", fence(lease), signal));
    const source = object(context.source) as unknown as Tables["sources"]["Row"],
      run = object(context.run);
    return {
      source: {
        id: source.id,
        slug: source.slug,
        enabled: source.enabled,
        approved: source.approved_at !== null,
        parserVersion: source.adapter_version,
        configVersion: source.config_version,
        config: jsonObject(source.config),
      },
      runId: string(run.id),
      sequence: integer(context.page_sequence),
      cursorHash: string(context.cursor_hash),
      cursor: (run.cursor ?? null) as Value,
      validators: jsonObject(context.validators),
      sourceRevision: run.source_revision as string | null,
      replayed: context.replayed === true,
      paused: context.paused === true,
    };
  }
  async candidates(
    lease: Lease,
    records: readonly LookupRequest[],
    signal?: AbortSignal,
  ): Promise<CandidateSet[]> {
    const result: CandidateSet[] = [];
    for (let offset = 0; offset < records.length; offset += 20) {
      const data = await this.rpc("rr_read_candidates", {
        ...fence(lease),
        p_records: encode(
          records.slice(offset, offset + 20).map((r) => ({
            record_key: r.recordKey,
            fingerprint: r.fingerprint,
            fingerprint_version: r.fingerprintVersion,
            identities: r.identities.map((i) => ({
              kind: i.kind,
              key_version: i.version,
              value: i.value,
            })),
          })),
        ),
      }, signal);
      for (const item of list(data)) {
        const row = object(item);
        result.push({
          recordKey: string(row.record_key),
          observationId: row.observation_id as string | null,
          observationOpportunityId: row.observation_opportunity_id as string | null,
          strongIds: list(row.strong_ids).map(string),
          candidates: list(row.matches).map(opportunityContext),
          truncated: row.truncated === true,
        });
      }
    }
    return result;
  }
  async commit(
    lease: Lease,
    context: CollectionContext,
    page: CollectedPage,
    records: readonly Proposal[],
    signal?: AbortSignal,
  ): Promise<PageResult> {
    const row = object(
      await this.rpc("rr_commit_source_page", {
        ...fence(lease),
        p_sequence: context.sequence,
        p_cursor_hash: context.cursorHash,
        p_page_url: page.sourceUrl,
        p_records: records.map((record) => ({
          ...object(proposalRow(record)),
          source_revision: page.sourceRevision,
        })) as Json,
        p_next_cursor: encode(page.nextCursor),
        p_not_modified: page.notModified,
        p_source_revision: page.sourceRevision ?? undefined,
        p_validators: page.validators,
      }, signal),
    );
    return {
      replayed: row.replayed === true,
      runId: string(row.run_id),
      inserted: integer(row.inserted ?? 0),
      updated: integer(row.updated ?? 0),
      duplicates: integer(row.duplicates ?? 0),
      rejected: integer(row.rejected ?? 0),
    };
  }
  async assessment(lease: Lease, signal?: AbortSignal): Promise<AssessmentContext> {
    const context = object(await this.rpc("rr_read_assessment_context", fence(lease), signal));
    const row = object(context.profile) as unknown as Tables["research_profiles"]["Row"],
      items = list(context.items).map(object);
    const opportunities = items.map((i) => opportunityContext(i.context));
    return {
      profile: {
        id: row.id,
        revision: integer(row.revision),
        timezone: row.timezone,
        enabled: row.enabled,
        rules: parseRules(jsonObject(row.rules)),
      },
      opportunities,
      enabledTypes: list(context.enabled_types).map(string),
      states: Object.fromEntries(items.map((i, index) => {
        const state = object(i.state);
        return [opportunities[index].id, {
          saved: state.saved === true,
          ignored: state.ignored === true,
        }];
      })),
    };
  }
  async storeAssessments(lease: Lease, assessments: readonly Assessment[], signal?: AbortSignal) {
    return integer(
      await this.rpc("rr_store_assessments", {
        ...fence(lease),
        p_assessments: encode(assessments.map((a) => ({
          opportunity_id: a.opportunityId,
          opportunity_revision: a.opportunityRevision,
          profile_revision: a.profileRevision,
          eligible: a.eligible,
          score: a.score,
          reason_codes: a.reasonCodes,
          components: a.components,
          rules_version: a.rulesVersion,
          valid_until: a.validUntil,
        }))),
      }, signal),
    );
  }
}
