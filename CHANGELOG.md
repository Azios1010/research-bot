# Changelog

## 2026-10-29 — Phase 02 database foundation

- Applied three immutable migrations to the isolated development project, defining the 18 private entities, constraints/indexes, 12 backend RPCs, fenced transactions and explicit RLS/grants.
- Added pinned Deno/CLI tooling, dependency lockfile, isolated-target/ref/TLS/history/plan guards, five offline guard tests, hosted SQL and concurrent-client test scripts, scoped cleanup and real type-generation workflow.
- Added a credential-free `.env.example` and ignored local `.env`; database tasks load `.env` through Deno without overriding existing process environment values. Offline checks do not load credentials.
- Updated database/architecture/testing/deployment/operations guidance and recorded ADR 0007. Verified that Git is now correctly scoped to this repository.
- Verified 70 hosted SQL assertions, ten query-plan checks, real concurrent clients, no-op reapply and scoped cleanup; generated persistence types from the actual hosted schema. Fixed Management API path, exact Deno driver permissions, optional CA trust and generated-file formatting; receipts bind schema/history and verification-suite hashes.
- Repository checks, documentation validation and credential scan pass. Recorded sanitized hosted evidence and limited billing-plan visibility; production recovery/plan suitability remains a release gate. Phase 02 is complete, active phase is none, Phase 03 remains pending. No application feature, production deployment, commit or push was created.

## 2026-10-28 — Phase 01 project foundation

- Specified Research Radar's product, Supabase/Edge architecture, shared opportunity model, database, security, testing, deployment and operations.
- Evaluated public source candidates with primary evidence and explicit permission/format/freshness uncertainties.
- Added the persistent engineering contract, accepted ADRs, ten bounded build specifications and an offline documentation validator.
- No application features, migrations, collectors, Telegram integration, schedules or deployment were implemented. Nothing was committed or pushed.
