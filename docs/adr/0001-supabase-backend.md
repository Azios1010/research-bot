# ADR 0001: Supabase as the backend platform

Date: 2026-10-28

Status: accepted

## Context

The final system must be a real unattended personal Telegram research tool deployed to an existing remote Supabase project. A separate server and local production-equivalent database are outside the user's platform strategy. Durable state and operations must outlive code deployments.

## Decision

Use Supabase PostgreSQL for canonical data, provenance, profiles, feedback, task/inbox/outbox state and idempotency. Use Supabase Edge Functions, Cron, Secrets, Logs and Vault for application execution and scheduling. Do not add a separate backend host or external queue. Keep application tables in private `radar` with reviewed backend-only RPC access. Phase 02 defines schema/tooling; Phase 10 deploys production.

## Alternatives considered

A VPS/Railway server introduces a persistent runtime and deployment model explicitly excluded by the project. A local scheduled script fails the unattended remote-product goal. An event-bus/Redis stack adds operational systems without current need.

## Consequences

Postgres constraints and atomic RPCs are correctness boundaries; backend credentials remain privileged. Resource/plan limits and remote test availability must be measured. A hosted isolated database is required for integration evidence but not for offline parser tests. Port abstractions reduce coupling in core code, while migrations/RPCs deliberately use PostgreSQL features.

## Validation

Phase 02 inventories the existing project read-only and tests private-schema/grant/RPC behavior on an isolated hosted target. Phase 10 verifies plan, costs, backup restore, Cron and persistence across deployments. Exact account details are deferred because no project access is part of Phase 01. See [deployment model](../../DEPLOYMENT.md).
