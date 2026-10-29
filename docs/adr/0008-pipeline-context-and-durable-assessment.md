# ADR 0008: Bounded pipeline reads and durable assessment handoff

Date: 2026-10-29

Status: accepted

## Context

Phase 03 inspection found that the twelve Phase 02 public RPCs only mutate state. The approved `supabase-js` application adapter cannot read source/run context, identity candidates or profile/opportunity state from `radar`, because that schema is deliberately excluded from the Data API. Exposing it or using the operator PostgreSQL client in application code would violate the architecture.

A second crash window exists if application code commits a collection page and then separately enqueues its assessment work. The page task is already terminal; a crash can lose that handoff. Finally, a new source observation's UUID is allocated inside `radar.upsert_record`, while application-selected field provenance needs to refer to that same observation. Preserving old provenance after choosing a new source field would be incorrect.

## Decision

Add three bounded, backend-only, fenced read RPCs: `rr_read_collection_context`, `rr_read_candidates`, and `rr_read_assessment_context`. They return fixed context JSON, not arbitrary SQL, table names, predicates or unrestricted pagination. Candidate batches have at most twenty records and a bounded response; assessment reads are limited to the task's existing batch. Keep `radar` private and the 18 entities unchanged. Use invoker security, empty search paths and deliberate service-role grants.

In an append-only forward migration, bind the current observation's stable `(source_id, source_record_key)` provenance references to its actual UUID inside upsert. Keep provenance-only refreshes from incrementing canonical content revisions. Atomically enqueue idempotent `assess_batch` tasks for accepted page opportunities and the configured enabled profile before page completion commits. More than one enabled profile is an explicit unsupported runtime configuration in the initial product, not a one-row database schema constraint.

Allow the existing task terminal state `canceled` through the fenced finish RPC so a manually disabled source can stop without becoming a source failure. No new task kind or table is introduced. Domain policies remain in TypeScript; SQL continues to validate revisions/identities and commit page/task handoffs atomically.

## Alternatives considered

Exposing `radar`, broad public read policies, generic read/SQL RPCs or a direct SQL runtime bypass the existing security/platform contract. Separately enqueuing after page completion depends on process survival. Inventing an observation UUID in the application without a transactional binding cannot provide reliable provenance. Editing already-applied Phase 02 migrations would rewrite shared history.

## Consequences

Generate persistence types again from the verified hosted schema. Existing mutation signatures remain compatible, and all new functions must deny PUBLIC/anon/authenticated. Reads validate the current lease; no transaction spans external HTTP. Collection/profile batching and source field authority remain bounded, with no real-source precedence configured in this phase. Production migration/deployment remains Phase 10.

## Validation

Phase 03 follow-up: final review found that conditional validators must come only from the latest terminal run when it fully processed its snapshot (`cursor IS NULL`) and matches both parser/config versions. Filtering for any older complete run could skip a newer interrupted snapshot or reuse an ETag after a configuration/parser change. Forward migration `20261029000300_validator_scope.sql` corrects this implementation detail without changing the RPC signature/security/architecture. Fully processed partial runs with quarantines remain eligible; failed continuations and newer failures invalidate cache reuse. SQL and actual pipeline regressions cover these cases.

Rerun the existing hosted SQL/grant/concurrency checks and add context/bounds/stale-fence tests. Through actual `supabase-js` HTTP RPCs, prove all eleven synthetic types, conservative reconciliation, source UUID provenance, atomic assessment handoff, page replay, concurrent identity convergence, disabled-source cancellation, and full rollback after a controlled stale-revision error. Record generated types and sanitized Phase 03 evidence before completion.
