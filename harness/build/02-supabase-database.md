# Phase 02 — Supabase database and verification foundation

## Goal

Translate DATABASE.md into executable namespaced migrations, secure transactional primitives and a repeatable isolated hosted verification path.

## Context

There is no schema or Deno tooling yet. Existing production Supabase resources are unknown and must be inventoried read-only. The application is Telegram-only, so no anonymous database access or Supabase Auth signup is required.

## Dependencies

01 complete, explicit Phase 02 activation, safe Git boundary awareness, Deno/Supabase/SQL tooling availability, verified read-only project access, and an explicitly designated isolated hosted test database/project/branch with no production data. Use PLANS' Phase 02 readiness checklist.

## Non-goals

No production migration, function deployment, collector, Telegram handler, Cron activation, ranking implementation, LLM or mandatory local database/Docker. No broad privilege changes to existing unrelated project objects.

## Implementation scope

1. Inventory target/version/plan/extensions/schema/grants/migration history read-only; record non-secret findings and isolate the test target.
2. Add pinned Deno tooling/lockfile and supported-version notes; implement `check`, `db:plan`, `db:verify` with target identity guards and redacted output.
3. Create the 18 conceptual tables, typed constraints, unique/partial indexes, private-schema grants/RLS and backend-only RPCs. Seed types and non-secret defaults; no fabricated personal profile or credential values.
4. Define narrow RPC inputs/outputs for leases, runs/page commit, identity/source upsert, feedback, inbox enqueue and notification claims/attempts. Use handwritten normalized fixtures to test database invariants. Pure parsing/scoring remains Phase 03. Identity conflicts must return a retry/conflict outcome instead of silently accepting stale proposals; SQL must not recreate source-specific parsing rules.
5. Fix executable cursor compare-and-swap/page replay representation, null-safe reminder/item constraints, composite profile/target/deadline consistency, and restrictive function default grants. Test with concurrent clients.
6. Generate persistence-only types and document RPC transaction boundaries. Any schema refinement is reflected in DATABASE.md and a new migration, not hidden in adapter code.

## Expected files/modules

`deno.json`, `deno.lock`, `supabase/config.toml`, `supabase/migrations/`, `supabase/tests/database/`, `supabase/functions/_shared/infrastructure/supabase/database.types.ts`, guarded database/validation scripts, sanitized SQL fixtures, updated DATABASE/DEPLOYMENT/PLANS/CHANGELOG. Do not create empty application layers.

## Acceptance criteria

- All tables/relationships and current temporal/identity/notification invariants are executable and documented.
- Fresh isolated migration application succeeds; a second migration-run invocation is a no-op through migration history, not destructive reinitialization.
- Concurrent identity claims, active-source coalescing, duplicate inbox/task creation, notification claims and stale lease writes behave correctly.
- Anonymous/authenticated roles cannot read private data or execute backend RPCs; backend role works through intended calls. Secrets are absent from DDL/config/logs.
- Validation refuses production/default/ambiguous targets. An unavailable hosted target fails visibly; mocks are not substituted for required SQL evidence.
- Production project remains unchanged.

## Validation commands

Create and run these tasks during this phase:

```text
deno task check
deno task db:plan
deno task db:verify
```

Tasks read safe local configuration for the explicitly supplied target, never committed credentials. `db:plan` is read-only. `db:verify` has hosted test writes and guards; record that target class and successful assertions.

## Manual verification

Inspect migration SQL/RPC grants, generated types and representative query plans. Verify private schema is not exposed, default EXECUTE revoked, no accidental `SECURITY DEFINER` escalation, no fake profile interests and no source secrets in settings. Confirm namespace isolation and test cleanup. Review actual project key format and document backend/internal endpoint authentication constraints for later phases.

## Known risks

Existing schema collisions, insufficient isolated test privileges, paid branch availability, Supabase key/grant differences, Postgres null uniqueness behavior and incorrectly fenced multi-statement writes. Eighteen small purpose-driven tables do not justify a general ORM/workflow framework.

## Exit criteria

All acceptance and hosted concurrency/privilege checks pass with sanitized evidence; docs reflect exact schema/RPC contracts; 02 is complete and active phase becomes none. If hosted isolation is missing, keep 02 active/incomplete and record the gate. Stop before core implementation or production apply.
