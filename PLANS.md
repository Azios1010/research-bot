# Research Radar execution plan

This file is the primary roadmap and execution source of truth. Read [AGENTS.md](AGENTS.md) and the active build specification before work. The documents specify an intended production system; only Phase 01 documentation currently exists.

Active phase: none

Phase statuses: `pending`, `active`, `complete`. At most one phase is active. Once a phase is complete, set active phase to `none`; leave all successors pending until the user activates the next one. Do not roll directly into database implementation.

## Roadmap

| Phase | Status | Goal | Dependencies | Major deliverables | Completion criteria |
| --- | --- | --- | --- | --- | --- |
| 01-project-foundation | complete | Fix product, architecture, data model and execution contract. | Empty-project inspection and user requirements. | Ten root documents, ADRs/template, ten phase specs, testing contract, offline doc check. [Specification](harness/build/01-project-foundation.md). | Required content and cross-document audit pass; no application/deployment work. |
| 02-supabase-database | pending | Establish namespaced schema, constraints, RPCs and hosted verification. | 01 complete; explicit activation; safe isolated hosted test target. | Migrations, grants/RLS, generated persistence types, Deno/SQL validation tooling, read-only target inventory. [Specification](harness/build/02-supabase-database.md). | Apply/reapply behavior, concurrency keys, lease/inbox/outbox primitives and anonymous-denial tests pass on isolated hosted Postgres; existing production project unchanged. |
| 03-core-opportunity-pipeline | pending | Build source-neutral processing and durable bounded execution. | 02 complete. | Domain, ports, RPC adapters, fake source/HTTP fixtures, normalization, reconciliation, deduplication, baseline filter/score, task worker. [Specification](harness/build/03-core-opportunity-pipeline.md). | Replay/concurrency/partial-failure/lease tests pass; no real collector, Telegram or Cron. |
| 04-conference-sources | pending | Prove evaluated conference/workshop/CFP ingestion. | 03 complete; source review. | Bounded CCFDDL adapter first, category gap checkpoint, fixtures, resource measurements and provenance. [Specification](harness/build/04-conference-sources.md). | All event/call coverage gates pass; uncertain times/rounds and cross-source identity handled; no production schedule. |
| 05-research-job-sources | pending | Cover research positions, internships, grants and funding. | 03 and 04 complete; profile/source relevance decisions. | Structured institutional pilot, evaluated broad source, sequential position/funding checkpoints and coverage matrix. [Specification](harness/build/05-research-job-sources.md). | Four position types plus grant/research_funding have approved ingestion paths and fixtures; rights/eligibility/partial failure gates pass. |
| 06-journal-cfp-sources | pending | Collect relevant journal calls and special issues. | 03-05 complete; publisher permission/access review. | One permitted publisher path, fixtures, journal metadata and updated source register. [Specification](harness/build/06-journal-cfp-sources.md). | Both journal types represented without duplicate call/issue rows; open calls distinguished from published collections. |
| 07-telegram-bot | pending | Expose use cases safely through a webhook UI. | 03-06 complete. | Webhook inbox, commands, callbacks, delivery rendering, feedback, allowlist/private-chat checks and mock Bot API tests. [Specification](harness/build/07-telegram-bot.md). | All commands route; basic profile view/setup works; duplicate/unauthorized/failed-delivery cases pass; no production bot registration. |
| 08-ranking-and-personalization | pending | Calibrate explainable personal relevance. | 07 complete. | Validated profile editing, rule versioning, reviewed ranking fixtures, assessment invalidation and re-ranking. [Specification](harness/build/08-ranking-and-personalization.md). | Deterministic gates precede all scoring, stable ordering/reasons and profile changes verified; no LLM required or implemented. |
| 09-automation-and-reliability | pending | Automate bounded jobs, digests, reminders and recovery. | 08 complete. | Authenticated dispatch/worker, inactive schedule definitions, due calculations, outbox/attempt handling, retry/retention/status runbooks. [Specification](harness/build/09-automation-and-reliability.md). | Time-travel/replay/overlap/DST/uncertain-send tests and hosted drills pass; production Cron remains inactive. |
| 10-production-hardening-and-verification | pending | Deploy and prove the actual personal research bot. | 01-09 complete; explicit production activation and verified secrets/profile/plan/rights. | Reviewed release, migrations/functions/secrets/Cron/webhook on real project, security/load/recovery evidence, seven-day observation. [Specification](harness/build/10-production-hardening-and-verification.md). | PRODUCT_SPEC final Definition of Done met with live evidence; no unexplained or unresolved delivery outcomes. |

Dependencies are sequential for execution simplicity; shared infrastructure is added only when first needed. Source phases contain ordered checkpoints and do not justify rewrites of the core. Additional adapters are added only to close a documented coverage/relevance gap.

## Phase 01 evidence

- 2026-10-28: project directory inspected as empty. Existing Git root resolved to `D:/`, not this directory. No Git initialization, staging, commit, push, remote resources, secrets access, Supabase change or deployment performed.
- Product, source-neutral architecture, temporal/deduplication policies, database entities, security, delivery ambiguity policy and ten implementation specifications prepared.
- Public primary source and platform references reviewed; unverified access/permission/current freshness explicitly recorded in DATA_SOURCES.md.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-docs.ps1`: passed across 28 Markdown documents, required sections/files, ten phase contracts/statuses, ADRs, local links, fenced blocks and whitespace. Repository contains 30 files including `.gitignore` and the validator; conceptual schema contains 18 entities.
- Isolated temporary-copy validator probes: valid baseline passed; broken local link, multiple active phases and missing phase exit criteria each failed as expected. Probe copy was removed after verifying its absolute temporary-directory boundary.
- `git diff --check -- .`: passed for scoped tracked changes; new Markdown whitespace is covered separately by the validator. `git status --short -- .` shows the project as untracked under the parent repository; nothing staged or committed.
- Bounded credential-pattern audit of project files found no bot token, secret API key, private key or credential-bearing PostgreSQL URL. No machine secrets were read. RTK was unavailable; shell commands used a process-local transparent `rtk` passthrough, without claiming filtering ran.
- Senior handoff review completed: checked all eleven type codes, module/phase/task names, 18-entity relationships, fixed source/identity/temporal policies, secure ingress/RPC boundaries, source evidence/permission uncertainty and final production gates. Resolved page replay accounting, reminder local-time/expiry, event versus submission lifecycle, notification uniqueness on target rebinding, partial-send claim release and retention of referenced deduplication evidence.
- Phase 01 is complete. No application code, migration, collector, handler, schedule or deployment exists. Phases 02-10 remain pending; no phase is active.

## Readiness checklist for starting Phase 02

1. Phase 01 is complete with a passing `scripts/validate-docs.ps1` result and final contradiction review.
2. The user activates Phase 02; update only its status and `Active phase` at that time. It remains pending at this handoff.
3. Verify Git resolves to the intended project boundary before any staging; do not change or commit the unrelated drive-level repository. Database/doc work can be prepared without a commit.
4. Read AGENTS.md, ARCHITECTURE.md, DATABASE.md, docs/TESTING.md, ADRs and the Phase 02 specification; inspect files and current tooling.
5. Identify the existing Supabase project reference and permissions through safe local/operator configuration. Perform a read-only inventory of current schemas, migrations, exposed schemas, extensions, grants, version, plan, pause policy and backups. Do not assume the project is empty.
6. Select a separate hosted test project/database or equivalent isolated hosted branch with explicitly verified target identity and no production data. Confirm ability to create the required namespaced objects/RPCs there. If unavailable, schema authoring may proceed but required integration remains blocked and Phase 02 cannot finish.
7. Check available Deno, Supabase CLI and SQL/hosted test connectivity; pin supported versions and define the validation tasks. No local database or Docker may become mandatory.
8. Resolve SQL-level choices identified in DATABASE.md: cursor compare-and-swap representation, null-safe notification constraints, composite profile/target consistency, required backend RPC grants, and supported project key/auth mode. Verify them with executable tests rather than widening public access.
9. Keep credentials out of Git/logs and scope tests to the verified isolated target. No collector, Telegram handler, Cron activation, LLM, production migration or deployment belongs to Phase 02.

## Unresolved questions and owning phases

| Question | Decision gate |
| --- | --- |
| What is the actual project's schema, PostgreSQL/key configuration, plan and recovery capability? | Read-only inventory in 02; release confirmation in 10. |
| What isolated hosted database can run migration/concurrency/RLS tests? | Required before completing 02. No mandatory local fallback. |
| Which topics, countries, qualifications, institutions, timezone and cadence fit the researcher? | Source scope/relevance in 04-06, basic setup in 07, calibrated profile in 08, confirmation in 10. No invented personal facts. |
| Are candidate endpoints permitted, bounded, fresh and Deno/Edge compatible? | Per-source gate in 04-06; recheck in 10. |
| How are current conference round identifiers and source-assumed timezones represented? | Shared policy implemented in 03; adapter evidence and benchmark in 04. |
| Which funding and internship source actually fits this researcher? | Phase 05 coverage checkpoint; cannot be deferred past source-phase completion. |
| Does the actual plan support reliable unattended operation, useful logging and verified restores within budget? | Baseline in 02, benchmark in 04, final plan/recovery gate in 10. |
| Is Supabase monitoring enough while Telegram is unavailable? | Phase 09 runbook; Phase 10 operator review. No unsolicited external alert service. |

Future phase evidence entries must include date, revision identifier when available, commands and results, hosted target class (no secrets), manual verification, unresolved limitations and exit-criteria disposition. Do not manufacture a Git revision before one exists.
