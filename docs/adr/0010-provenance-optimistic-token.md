# ADR 0010: Fence reconciliation evidence independently of content revision

Date: 2026-10-29

Status: accepted; extends ADR 0008 without changing its content-revision semantics.

## Context

Final Phase 03 review found a lost-update window: provenance/authority may change while canonical facts and content_revision remain unchanged. A weaker worker that read the previous authority could then submit changed facts with a still-current content revision and overwrite stronger evidence. Concurrent identical canonical creation could also replace stronger provenance with weaker provenance. Content revision alone cannot fence this decision.

## Decision

Add an opaque evidence-version token to the fixed opportunity context, computed as PostgreSQL SHA-256 over its current provenance JSON. The domain carries the opaque string; it does not implement PostgreSQL serialization. A reconciliation proposal that supplies explicit field provenance for an existing canonical must provide the matching expected token. A mismatch, including discovering a canonical created after the read, raises PT409 before canonical/observation mutation and rolls back the complete page. Application code re-reads/reconciles within the same bounded retry budget.

Forward migration `20261029000400_provenance_cas.sql` changes the existing private context/upsert helpers only. No table/column/public RPC/grant is added. Original SQL callers without explicit field-provenance proposals preserve the legacy contract; the application always supplies provenance and therefore always uses this gate for an existing canonical.

## Alternatives considered

Incrementing content_revision on every provenance refresh would invalidate unchanged facts/assessments on ordinary refetch and contradict its documented meaning. A second stored counter is unnecessary because provenance already has a bounded canonical representation. Reimplementing field authority in SQL would split domain policy between two implementations. Holding a transaction open across collection/parsing is prohibited.

## Consequences

Content revisions remain about canonical/deadline facts; evidence-only refreshes keep them stable but invalidate stale reconciliation proposals. This adds a fixed JSON token to read/proposal envelopes; generated SQL function signatures and 18 entities are unchanged. The token is not a secret or identity fingerprint. Application/deployment must apply the forward migration before using the updated context mapper. Stale tokens cause a full rollback, not a per-record rejection or partial cursor advance.

## Validation

Test direct SQL stale-token rejection with unchanged content revision. Through actual HTTPS, pause a weak worker after reading old authority, commit stronger identical facts without changing content_revision, then resume it. Require a PT409 re-read, stronger facts/provenance retained and retry-safe page accounting. Retain the existing simultaneous identity/task, replay, rollback and private-grant evidence.
