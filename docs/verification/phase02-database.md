# Phase 02 hosted database verification

Date: 2026-10-29. Git baseline: `D:/projects/research-bot`, branch `main`, `7c9b40c first commit`. Origin: `https://github.com/Azios1010/research-bot.git`. All repository changes remain unstaged; no commit, push, history rewrite or parent repository metadata change occurred.

## Target and isolation

The operator created a new Supabase project for this verification and supplied its credentials through ignored `.env`. The actual connection reference was matched against the authenticated Management API, then checked with read-only PostgreSQL inventory before applying migrations.

| Property | Observed value |
| --- | --- |
| Target class | Isolated development project, not a production deployment |
| Project name / ref | `research-bot` / `ihxoffjtrtyxgctcfgmy` |
| Status / region | `ACTIVE_HEALTHY` / `eu-west-2` |
| Project creation | `2026-10-28T22:39:30.223892Z` |
| PostgreSQL | `17.11` (`170011`) |
| Connection | Supabase session pooler, database `postgres`, port 5432, certificate/hostname verification enabled |
| Existing application objects / migration history | None before application |
| Existing Auth users, Storage objects/buckets, Vault secrets | None |
| Existing Cron jobs | No `cron.job` relation; no jobs activated |
| Data API schemas | `public,graphql_public`; excludes `radar` |
| Backend role | `service_role` has BYPASSRLS; `anon` and `authenticated` do not |
| Key metadata | Publishable/secret and legacy anon/service-role kinds available; metadata requested with `reveal=false` |
| Backups / PITR | Backup inventory returned zero backups; PITR disabled |
| Billing plan | Organization entitlements request returned HTTP 403 with the scoped token; plan and pause policy are not inferred |

The billing-plan limitation does not invalidate the isolated SQL tests. Production plan suitability, pause behavior and backup/restore evidence remain Phase 10 release gates; this new disposable target is not presented as production-ready. No valuable existing data was used or removed. No token permissions were expanded to inspect billing.

Extensions present before and after: `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1`, `uuid-ossp 1.1`. Research Radar required no new extension.

The optional local CA was downloaded from the URL used by the official Supabase Dashboard source:
[Dashboard certificate configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json),
[Supabase production CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).
SHA-256 certificate fingerprint: `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`; validity ends 2031-04-26. Without that trust anchor the actual connection failed closed with `SELF_SIGNED_CERT_IN_CHAIN`; supplying it succeeded with `rejectUnauthorized=true` and the real pooler hostname. No machine-wide trust store or SSL enforcement setting was changed.

## Toolchain and migrations

Deno `2.9.6`, TypeScript `6.0.3`, Supabase CLI `2.122.0`, verification-only Postgres.js `3.4.9`, Node `v22.15.0`. Deno/CLI were invoked from the pinned npm cache; no local database, Docker or persistent service ran. RTK was unavailable; the documented transparent process-local passthrough was used.

| Migration | Normalized SQL SHA-256 |
| --- | --- |
| `20261028000100_radar_schema.sql` | `45e60bd1f9dbd696711427a7213a4ce2530817726a908172ed0c0a684c37d393` |
| `20261028000200_radar_rpc.sql` | `26ac7d081314a58b19e01dc833f8f910c59ad8b775ebcc165a83173e087d2bb1` |
| `20261028000300_radar_guards_and_grants.sql` | `f2f6a486a8fa0b29566bddfcda91f6c0f2d44fbd75a33c47fd479caa0b13b265` |

The reviewed initial read-only plan hash was `dbb64c8333c1ab80b1fd7c3d97b21678c3f1afd0ce490243dad7b99d708ea052`. Each migration committed atomically with its exact normalized statement/name/version in `supabase_migrations.schema_migrations`. Reapply was a history-based no-op, both within the first run and on a separate verifier invocation. No migration file was changed after application. No history repair or remote reset occurred.

Final read-only plan hash: `d02d6a18689e9bd70661cf49b03151b1811bd745dde018b27d7a02c8452c5328`, with no pending migrations.

## Created objects and security

Application tables are in private `radar`; migration infrastructure is in `supabase_migrations`. The 18 application tables are:

```text
opportunity_types            opportunities
opportunity_deadlines        opportunity_identities
sources                      source_records
collection_runs              research_profiles
opportunity_assessments      user_opportunity_state
user_feedback                delivery_targets
telegram_updates             notifications
notification_items           notification_attempts
job_tasks                    system_settings
```

Final catalog inspection found 79 indexes including constraint indexes, 132 CHECK constraints including the URL domain, 28 foreign keys, 18 primary keys and 16 UNIQUE constraints. All 18 tables have RLS enabled; there are zero RLS policies. No Research Radar function is `SECURITY DEFINER`.

Important keys enforce source-record identity, strong canonical identity, one active source run, task/request/coalescing identity, inbox `(bot_id,update_id)`, profile feedback idempotency, notification schedule identity, first-digest/reminder claims, and unresolved send attempts. Fingerprints and canonical URLs remain nonunique candidate evidence. Composite foreign keys preserve profile/target/bot and opportunity/deadline ownership; checks and triggers preserve precision, revisions, lease transitions and constrained notification states.

Twelve backend-only public RPCs exist:

```text
rr_create_collection_run       rr_enqueue_task
rr_claim_task                  rr_renew_task
rr_finish_task                 rr_commit_source_page
rr_store_assessments           rr_accept_telegram_update
rr_apply_feedback              rr_prepare_notification
rr_begin_notification_attempt  rr_finish_notification_attempt
```

Fourteen private helpers/triggers support these operations. All use invoker security and empty search paths. PUBLIC/anon/authenticated cannot access private tables or execute backend RPCs. `service_role` receives the documented usage, SELECT/INSERT/UPDATE and function EXECUTE grants; no runtime DELETE/TRUNCATE/schema CREATE is granted, and type lookup is read-only. Actual role-denial statements and backend operations were executed, not merely inferred from RLS flags.

## Validation results

| Check | Result |
| --- | --- |
| `deno task check` | Pass: format/lint/type checks, real generated type check, five offline guard tests, 52-file credential scan and 31-document validation |
| `deno task db:plan` | Pass, read-only, exact hosted history and no pending migrations |
| `deno task db:verify` | Pass on the designated isolated hosted target |
| `01_contract.sql` | 70 assertions passed; complete transaction rolled back |
| `02_query_plans.sql` | 10 index/plan assertions passed; complete transaction rolled back |
| Concurrent clients | Passed under actual `SET LOCAL ROLE service_role` |
| Cleanup | Committed UUID-scoped fixtures removed; post-test application tables empty; collection/delivery pause settings restored to true |

SQL negative cases include stale fencing, success without a claim, invalid cursor CAS, terminal task reopening, duplicate source-record identity, instant deadline without timezone, deadline change without revision, feedback replay/key misuse/unfenced context, excluded assessment with a score, duplicate digest claim, cross-profile target references, uncertain-send replay, expired-owner writes and invalid timezone. Actual anon/authenticated table and RPC statements are denied; backend calls succeed. Repeated inbox identities yield one task, page replay does not increment counters or cadence, and unchanged source refetch preserves canonical revision.

Separate concurrent transactions prove source refresh coalescing, one-owner SKIP LOCKED, cross-source strong-identity convergence with no orphan opportunity, one inbox receipt/task, one feedback event/current-state update, one winning notification claim with losing-transaction rollback, and an expired send lease becoming uncertain without automatic replay. Cleanup is limited to UUIDs created by that invocation and restores pause values.

Query plans use PostgreSQL defaults, without disabling sequential scans. Temporary fixtures contain 4,096 opportunities/observations/deadlines/assessments/user-state rows/tasks and 512 notifications. The following ten access paths used their intended indexes: bounded opportunity browsing, fingerprint candidates, strong identity lookup, source observation lookup, instant deadlines, date deadlines, queued task claim, ranked profile view, saved view and due notifications. This is a bounded schema benchmark, not a production load claim.

The first verifier invocation passed SQL/concurrency/cleanup but failed local formatting after actual type generation because repository formatting excludes `supabase/`. The formatter now explicitly uses `--no-config`; the subsequent complete verifier passed. Other tooling corrections were the documented `/projects/{ref}/postgrest` endpoint, exact missing Postgres.js environment permissions, optional explicit CA trust, clear no-op logging, and a verification-suite hash in receipts. None changed the application schema or widened database access.

## Types and evidence receipt

Actual generated file:
[database.types.ts](../../supabase/functions/_shared/infrastructure/supabase/database.types.ts).
It contains the real `radar` tables and public RPC signatures. No handwritten replacement or manual type patch was used. The generation command was:

```text
supabase gen types typescript --project-id ihxoffjtrtyxgctcfgmy --schema radar,public
```

Ignored receipt `private/phase02-verification.json` records successful SQL verification at `2026-10-29T01:55:50.428Z`, migration hashes, tool versions, schema fingerprint `af4dc5d4369ccb91e7e9ee5866673aeeaabef1b346e88c9af9e09c3a7c4977f7` and verification-suite hash `f24149f691ea61413491af99806807707db1dcd17d0e653176dc28281942c719`. `deno task db:types` requires this exact schema/history/test-suite receipt before regeneration. Credentials, connection URLs, raw API responses and personal data are excluded from this report and Git.

## Handoff and remaining risks

The 18-entity design is preserved. Architecture-preserving refinements are those recorded in [ADR 0007](../adr/0007-database-primitives-and-hosted-verification.md): identity component evidence, bounded indexed keys, mandatory fenced task provenance, precise cursor hashing and worker context checks. No collector, Telegram handler/send, ranking algorithm, LLM, Cron or production deployment was introduced.

The isolated target has no backups and no PITR; schema recovery is through immutable migrations and there is no valuable application data. Production plan/pause/recovery suitability is unverified and must be resolved in Phase 10. Scoped-token billing visibility is limited. Integration evidence is for PostgreSQL 17.11 and bounded fixtures; later adapters must enforce the domain/input contracts and measure representative production workloads. The private PostgreSQL client stays confined to operator tests.

Before Phase 03: obtain explicit activation; read AGENTS/PLANS and the full Phase 03 specification; inspect the actual generated types, migrations, database contract, ports and tests; retain isolated hosted credentials/CA; implement the source-neutral pipeline with fake source/HTTP fixtures; add the phase's unit/contract/integration tasks. Real sources, Telegram and automation remain in their owning later phases. Completion of Phase 02 does not authorize Phase 03.

## Repository changes

Relative to baseline `7c9b40c`, there are ten modified tracked files and 22 new project files, all unstaged. The `.env` credentials, local target/CA and successful receipt are ignored operator configuration, not commit candidates.

Modified documentation/configuration:

```text
.gitignore             AGENTS.md             ARCHITECTURE.md
CHANGELOG.md           DATABASE.md           DEPLOYMENT.md
OPERATIONS.md          PLANS.md              README.md
docs/TESTING.md
```

New files:

```text
.env.example
.gitattributes
deno.json
deno.lock
docs/DATABASE_WORKFLOW.md
docs/adr/0007-database-primitives-and-hosted-verification.md
docs/verification/phase02-database.md
scripts/check.ts
scripts/db/guards.ts
scripts/db/guards_test.ts
scripts/db/main.ts
scripts/db/target.example.json
scripts/db/verify-concurrency.ts
scripts/scan-secrets.ts
scripts/toolchain.json
supabase/config.toml
supabase/functions/_shared/infrastructure/supabase/database.types.ts
supabase/migrations/20261028000100_radar_schema.sql
supabase/migrations/20261028000200_radar_rpc.sql
supabase/migrations/20261028000300_radar_guards_and_grants.sql
supabase/tests/database/01_contract.sql
supabase/tests/database/02_query_plans.sql
```

Recommended commit message, for the operator to use later:

```text
feat(db): establish verified private Supabase persistence layer
```
