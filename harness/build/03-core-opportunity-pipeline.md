# Phase 03 — Core opportunity pipeline

## Goal

Implement a source-neutral, fixture-proven path from collected drafts to durable canonical opportunities and deterministic assessments, with bounded recoverable task execution.

## Context

Phase 02 supplies secure persistence and transaction primitives. Real sources must plug into this core without importing their formats into the domain or using Telegram to drive collection.

## Dependencies

02 complete and 03 explicitly active; hosted test configuration and database tasks working; accepted ADRs and exact RPC contracts inspected.

## Non-goals

No real website collector, Telegram command/transport, production deployment, Cron, automatic digest/reminder, LLM or semantic deduplication.

## Implementation scope

- Define domain Opportunity/Draft/Deadline/temporal evidence, attributes/type validation, shared text/URL/location/tag normalization and quality errors.
- Define focused application ports and implement fake source/clock/HTTP/repositories plus real Supabase RPC adapters. Keep database DTO mapping out of domain.
- Implement source contract, per-record errors, page processing and canonical reconciliation/identity proposal policy. Stable record keys and fingerprints must be versioned.
- Implement deterministic filtering and baseline score from ARCHITECTURE.md; persist assessment reasons/revisions. No researcher tuning UI yet.
- Implement fenced `collect_page`/`assess_batch` execution and `job-worker` composition root with internal-secret verification from its first version. There is no unauthenticated worker even before scheduling exists.
- Commit source page and cursor/accounting/continuation atomically; support safe re-fetch, duplicates, partial valid pages, quarantine, source disable and capped retry.
- Implement bounded HTTP/redirect handling and parser safety interfaces. If robust DNS validation is infeasible, restrict to fixed approved endpoints and document/test residual risk before any real adapter fetches.

## Expected files/modules

`_shared/domain/`, `_shared/application/`, `_shared/infrastructure/supabase/`, `_shared/infrastructure/http/`, `_shared/infrastructure/observability/`, `job-worker/index.ts`; `tests/unit/`, `tests/contract/`, `tests/integration/`, synthetic fixture source data; unit/contract/integration tasks. Add corrective migrations only where demonstrated invariants require them.

## Acceptance criteria

- Fixture data across every type can normalize/persist without external services; incomplete data stays honest.
- Duplicate source records and confident cross-source identities converge atomically. Different cycles/tracks and ambiguous fingerprints remain separate; changed deadline preserves identity.
- One bad record/source does not drop valid siblings or block another task. Changed document shape is not successful empty collection.
- Replaying pages, crashing before commit, reclaiming leases and running workers concurrently preserves counts/cursor and prevents stale commits/orphan canonical rows.
- Baseline exclusions precede scoring; ordering/reasons are reproducible under a frozen clock and no LLM configuration.
- Core imports point inward; normal unit/contract tests cannot call a website or read credentials. Worker auth rejects missing/wrong secrets before database work.

## Validation commands

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:verify
deno task test:integration
```

Create the three test tasks and fail on unexpected empty discovery. Database/integration tasks use the verified isolated hosted target and fake external boundaries.

## Manual verification

Trace one accepted, rejected, merged-candidate and conflicted item through source record, canonical/deadline, run and assessment rows. Inspect stable identity inputs and source field precedence. Simulate stale lease and source disable during a page. Verify logs are useful and redacted, module imports obey the architecture and no external network is required for deterministic tests.

## Known risks

Duplicate logic split inconsistently between application proposals and SQL guards; changing deadlines/round indexes used as identity; URL normalization erasing identity queries; unbounded payload/CPU; accidental network in parsers; retry multiplication. Resolve with behavior tests and one documented policy, not another framework.

## Exit criteria

All replay/concurrency/temporal/filter/failure/auth checks pass, transaction behavior is documented, and 03 is complete with active phase none. Stop before implementing the CCFDDL or any other real source.
