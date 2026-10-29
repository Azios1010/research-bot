# ADR 0007: Database primitives and guarded hosted verification

Date: 2026-10-29

Status: accepted

## Context

Phase 02 makes the conceptual database executable while preserving the Supabase/Edge/Opportunity architecture. No isolated ref or credentials are configured in this session; authored implementation must remain distinct from hosted verification.

## Decision

- Use PostgreSQL 15+ without an extra extension dependency. Keep the 18 private `radar` tables and twelve backend-only `public.rr_*` persistence RPCs, all `SECURITY INVOKER` with empty search paths.
- Revoke public execution in each wrapper's introducing migration. Restrict defaults inside `radar`, avoiding global public-schema default changes that affect unrelated applications. Runtime gets SELECT/INSERT/UPDATE, no DELETE/TRUNCATE/schema CREATE, and read-only type lookup.
- Use SHA-256 of canonical `jsonb::text` (`null` for no cursor) and a run page sequence for cursor CAS. Commit records/counters/cursor/task/continuation atomically. Serialize short canonical/assessment writes with a transaction advisory lock for the initial single user; fetching/parsing remains independent.
- Require current task/owner/generation and profile/kind context for worker mutations, including feedback and notification preparation. Persist sending before IO and preserve uncertain attempts/claims. Automatic uncertain resend is unavailable; operator resolution tooling belongs to Phase 09.
- Resolve the conceptual optional attempt/task foreign key to required so every send attempt has a fenced task/generation. This tightens provenance without introducing another entity.
- Add bounded `opportunity_identities.evidence` for the normalized components already required conceptually. Bound indexed source/identity keys to 2,000 UTF-8 bytes; longer identity inputs use a versioned strong digest plus evidence. No entity/type model is removed or duplicated.
- Use pinned Deno operator tooling with direct TLS hosted SQL, read-only Supabase Management API identity/exposure checks, explicit isolation attestation, data/history inspection, reviewed plan hash, rollback SQL tests, real concurrent clients and scoped cleanup. Generate types only from the actual verified schema.

## Alternatives considered

Required local Postgres/Supabase/Docker violates the remote-first contract. Mocks or offline parsing cannot prove real catalog binding, grants, transactions or RLS. An evaluated offline parser was unsuitable for these schema-bound routines and is not retained as a dependency or a substitute gate. Generic SQL application RPCs widen the backend boundary. Global public-schema default-privilege changes can affect unrelated objects.

## Consequences

SQL/PL/pgSQL compilation and database behavior remain unverified until hosted execution. The verification-only PostgreSQL driver must never become the application persistence adapter. Migration metadata uses CLI-compatible version/name/statements; mixing history writers requires review. No generated type file is supplied while hosted verification is blocked.

Completed runs with quarantined siblings are degraded successful checks; interrupted runs with committed pages retain partial status and failure health. This clarifies existing failure isolation so one malformed sibling does not cause automatic cooldown.

## Validation

Run `deno task check`, `deno task db:plan`, `deno task db:verify`, documentation validation and credential scan. Actual SQL/concurrent-client assertions, grant denial, cursor/fence/inbox/feedback/notification behavior, reapply and cleanup must pass before completeness. See [workflow](../DATABASE_WORKFLOW.md), [database contract](../../DATABASE.md) and [phase specification](../../harness/build/02-supabase-database.md).

Follow-up on 2026-10-29: the isolated hosted gate passed on PostgreSQL 17.11 with actual type generation, 70 SQL assertions, ten bounded query-plan checks, concurrent-client tests and scoped cleanup. [Verification evidence](../verification/phase02-database.md) records the target, immutable hashes, TLS/tooling corrections and plan/recovery limitations. The earlier blocked statements above describe this ADR's original context; they are preserved as history.
