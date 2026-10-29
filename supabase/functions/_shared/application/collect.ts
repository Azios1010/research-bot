import {
  DomainError,
  type NormalizedOpportunity,
  type Origin,
  type ParsedRecord,
  type Proposal,
  type RecordError,
  type Value,
} from "../domain/model.ts";
import { normalize } from "../domain/normalize.ts";
import { boundedObject, bytes, digest, key, safeUrl, stable } from "../domain/primitives.ts";
import { reconcile } from "../domain/reconcile.ts";
import { instant } from "../domain/temporal.ts";
import {
  type Clock,
  collectionLimits,
  type HttpClient,
  type Lease,
  type Logger,
  ProcessingError,
  type Repository,
  type SourceAdapter,
} from "./ports.ts";

const json = (value: unknown): Value => JSON.parse(JSON.stringify(value));
export async function collect(
  lease: Lease,
  deps: {
    repository: Repository;
    adapters: ReadonlyMap<string, SourceAdapter>;
    clock: Clock;
    http: HttpClient;
    logger: Logger;
  },
  signal: AbortSignal,
) {
  const context = await deps.repository.collection(lease, signal);
  if (context.replayed) {
    return {
      replayed: true,
      runId: context.runId,
      inserted: 0,
      updated: 0,
      duplicates: 0,
      rejected: 0,
    };
  }
  const source = context.source, adapter = deps.adapters.get(source.slug);
  if (!source.enabled || !source.approved || context.paused) {
    throw new ProcessingError("source_disabled", false, 0, true);
  }
  if (!adapter || source.parserVersion !== adapter.parserVersion) {
    throw new ProcessingError("source_adapter_mismatch", false, 0, true);
  }
  const renewed = await deps.repository.renew(lease, signal);
  const page = await adapter.collectPage(
    { source, http: deps.http, clock: deps.clock, signal, limits: collectionLimits },
    context.cursor,
    context.validators,
  );
  safeUrl(page.sourceUrl);
  instant(page.fetchedAt);
  if (bytes(page.payload) > collectionLimits.maxBytes) {
    throw new ProcessingError("response_too_large");
  }
  boundedObject(page.validators, 4096);
  if (page.notModified) {
    if (page.payload || page.nextCursor !== null || context.sequence !== 0) {
      throw new ProcessingError("invalid_not_modified_page");
    }
    return await deps.repository.commit(renewed, context, page, [], signal);
  }
  const parsed: (ParsedRecord | RecordError)[] = [];
  try {
    for (const item of adapter.parsePage(page)) {
      if (parsed.length >= collectionLimits.maxRecords) {
        throw new ProcessingError("page_record_limit");
      }
      parsed.push(item);
    }
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ProcessingError("document_parse_failed");
  }
  const prepared: { proposal: Proposal; normalized?: NormalizedOpportunity }[] = [];
  const seen = new Set<string>();
  const aliases = source.config.organization_aliases ?? {};
  boundedObject(aliases, 2048);
  const aliasMap = Object.fromEntries(
    Object.entries(aliases).map(([a, b]) => {
      if (typeof b !== "string") throw new ProcessingError("invalid_source_aliases");
      return [key(a), b];
    }),
  );
  for (const [index, record] of parsed.entries()) {
    const recordKey = record.sourceRecordKey ??
      `rejected:${page.sourceRevision ?? "snapshot"}:${context.sequence}:${index}`;
    if (seen.has(recordKey)) continue;
    seen.add(recordKey);
    const proposal: Proposal = {
      recordKey,
      sourceUrl: page.sourceUrl,
      parserVersion: adapter.parserVersion,
      payloadHash: await digest([recordKey, record.kind]),
      disposition: "quarantined",
      metadata: {},
    };
    try {
      if (!recordKey.trim() || recordKey.length > 1024 || bytes(recordKey) > 2000) {
        throw new DomainError("invalid_source_key");
      }
      if (record.kind === "error") {
        throw new DomainError(/^[a-z_]{1,80}$/.test(record.code) ? record.code : "invalid_record");
      }
      proposal.sourceUrl = safeUrl(record.sourceUrl);
      if (
        !adapter.supportedTypes.includes(record.draft.type as typeof adapter.supportedTypes[number])
      ) throw new DomainError("source_type_not_supported");
      boundedObject(record.metadata, 2048);
      const normalized = await normalize(record.draft, { organizationAliases: aliasMap });
      const snapshot = json({
        schema_version: 1,
        fields: normalized.fields,
        deadlines: normalized.deadlines,
        deadline_evidence: record.draft.deadlines ?? [],
      });
      boundedObject(snapshot, 12000);
      proposal.snapshot = snapshot;
      proposal.metadata = { ...record.metadata, normalization_version: 1 };
      proposal.payloadHash = await digest(json({ draft: record.draft, metadata: record.metadata }));
      proposal.disposition = "accepted";
      prepared.push({ proposal, normalized });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      proposal.errorCode = /^[a-z_]{1,80}$/.test(error.code) ? error.code : "invalid_record";
      proposal.sourceUrl = page.sourceUrl;
      prepared.push({ proposal });
    }
  }
  const authorities = source.config.field_authority ?? {};
  boundedObject(authorities, 4096);
  if (
    Object.values(authorities).some((v) =>
      typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100
    )
  ) throw new ProcessingError("invalid_source_authority");
  for (let attempt = 0; attempt < 2; attempt++) {
    const accepted = prepared.filter((p) => p.normalized);
    const matches = await deps.repository.candidates(
      renewed,
      accepted.map(({ proposal, normalized }) => ({
        recordKey: proposal.recordKey,
        fingerprint: normalized!.fingerprint,
        fingerprintVersion: normalized!.fingerprintVersion,
        identities: normalized!.identities,
      })),
      signal,
    );
    const byKey = new Map(matches.map((m) => [m.recordKey, m]));
    const records: Proposal[] = [];
    for (const { proposal, normalized } of prepared) {
      if (!normalized) {
        records.push(proposal);
        continue;
      }
      const match = byKey.get(proposal.recordKey);
      if (!match) throw new ProcessingError("missing_candidate_context");
      const origin: Origin = {
        sourceId: source.id,
        sourceSlug: source.slug,
        sourceRecordKey: proposal.recordKey,
        ...(match.observationId ? { sourceRecordId: match.observationId } : {}),
        parserVersion: adapter.parserVersion,
        observedAt: page.fetchedAt,
        authority: 0,
      };
      const resolved = await reconcile(
        normalized,
        match,
        origin,
        authorities as Record<string, number>,
      );
      const next: Proposal = {
        ...proposal,
        canonical: resolved.canonical,
        provenance: resolved.provenance,
        ...(resolved.targetId
          ? {
            targetId: resolved.targetId,
            expectedRevision: resolved.expectedRevision,
            expectedEvidenceVersion: resolved.expectedEvidenceVersion,
          }
          : {}),
        metadata: {
          ...proposal.metadata,
          ...(resolved.candidateIds.length
            ? { identity_candidate_ids: resolved.candidateIds }
            : {}),
        },
      };
      if (bytes(stable(json(next))) > 32768) {
        records.push({
          ...proposal,
          disposition: "quarantined",
          errorCode: "proposal_too_large",
          snapshot: undefined,
          metadata: {},
        });
      } else records.push(next);
    }
    // A record can have many legitimate rounds/provenance entries. Bound the page separately
    // rather than making a per-record budget implicitly assume 100 identical-size records.
    if (bytes(stable(json(records))) > 1048576) {
      throw new ProcessingError("page_proposals_too_large");
    }
    try {
      const result = await deps.repository.commit(renewed, context, page, records, signal);
      deps.logger.log("page_committed", {
        sourceSlug: source.slug,
        runId: context.runId,
        taskId: lease.id,
        pageSequence: context.sequence,
        inserted: result.inserted,
        updated: result.updated,
        duplicates: result.duplicates,
        rejected: result.rejected,
      });
      return result;
    } catch (error) {
      if (
        !(error instanceof ProcessingError) || error.code !== "reconciliation_stale" ||
        attempt === 1
      ) throw error;
    }
  }
  throw new ProcessingError("reconciliation_stale", true);
}
