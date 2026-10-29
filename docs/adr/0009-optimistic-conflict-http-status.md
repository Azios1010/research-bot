# ADR 0009: Return HTTP 409 for optimistic revision conflicts

Date: 2026-10-29

Status: accepted; supersedes ADR 0007's use of SQLSTATE 40001 for intentional revision mismatch only.

## Context

The real Phase 03 Supabase-js rollback test repeatedly timed out at the controlled stale-revision rejection, despite SDK retries being disabled. SQL verification passed because a direct PostgreSQL client immediately receives 40001; the hosted Data API did not. This reveals a contradiction between the prior error code and the bounded retry contract, not a schema/domain redesign.

Supabase's [official troubleshooting article](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions), reviewed 2026-10-29, documents automatic transaction retry loops when custom business logic raises 40001 on affected PostgREST 14 versions. The observed timeout matches that behavior; we do not infer the target's exact PostgREST version. [PostgREST error documentation](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes) supports PT-prefixed HTTP status errors.

## Decision

Forward migration `20261029000200_revision_conflicts.sql` changes only the three intentional revision-mismatch raises in canonical/deadline reconciliation and assessment storage to SQLSTATE `PT409`. PostgREST returns HTTP 409 and the same sanitized business error name. Full transaction rollback remains mandatory; no record/page cursor or assessment batch may partially commit.

The persistence adapter maps PT409 to `reconciliation_stale`. Collection makes at most one re-read/reconcile/commit attempt without refetching; further failure uses the durable task budget. Genuine PostgreSQL serialization failures remain 40001 and are not relabeled by a blanket exception handler. SDK retries stay disabled. No function signature, privilege, table, identity rule or task state changes.

## Alternatives considered

Increasing HTTP timeout would hide an unbounded retry bug. Returning success with an error object could accidentally commit preceding writes. Editing applied migrations violates immutability. Requiring a platform upgrade or switching to the operator SQL client at runtime would break the remote Supabase-js contract.

## Consequences

Existing Phase 02/early Phase 03 evidence is historical; current intentional optimistic errors use PT409, including direct SQL callers. Actual HTTP tests must prove status/code, rollback and bounded retry. Inspect/stop only verified test-owned hanging requests if needed; do not restart a project or terminate unrelated backends. Test cleanup removes its task, causing any older retried transaction to fail its live-fence check. No production project is involved.

## Validation

Run the reviewed-plan migration workflow, SQL/security/concurrency suites and actual hosted pipeline. Require a deliberately late stale-revision error to return PT409/409, prove no preceding canonical/observation or cursor survives, and retry successfully after re-reading once. Verify stale assessment revisions similarly; regenerate types from the verified schema.
