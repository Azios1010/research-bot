# Phase 02 database workflow

## Current state

Ten immutable migrations (three Phase 02, four Phase 03, three Phase 07) are applied on the operator's isolated hosted development project. The current suite verifies 140 SQL assertions, ten representative query plans, real concurrent clients, no-op reapply, restrictive grants/RLS and scoped cleanup; actual hosted persistence types are generated. See [database evidence](verification/phase02-database.md), [pipeline evidence](verification/phase03-pipeline.md) and PLANS.md for phase status. No production resource was changed.

Historical Phase 02 Git baseline was `7c9b40c`. Phase 06 entered with a clean `D:/projects/research-bot`, branch/default `main`, committed/pushed Phase 05 baseline `6a55530dd9c33bd6d133dc965eab63330a14317a`, origin `https://github.com/Azios1010/research-bot.git`. Recheck these before future work; this task does not commit/push.

Phase 06 reuses all seven immutable migrations and existing generated types; no schema apply is required. `deno task test:journals` runs focused JEACS fixture persistence plus four-family failure isolation. `deno task sources:smoke --source jeacs-journal-calls` performs bounded real reads and isolated temporary persistence. Both enter the existing target/history/schema/receipt/verification-lock gate, then clean owned data and restore pause. `db:verify` must run again after verification-suite inputs change. No direct/unguarded SQL runner, production target or new operator credential is introduced.


Phase 07 adds six narrow invoker interaction RPCs while preserving the eighteen private tables, twenty-one public backend RPCs total and restrictive grants. Its three additive migrations were reviewed/applied/reapplied only on the isolated development target. Actual generated types use text arguments for external Telegram IDs. Focused `test:telegram` and full `test:integration` use real RPCs with a mock Bot API, synthetic profile/target/opportunities, scoped cleanup and both pause flags restored. See [Telegram runbook](TELEGRAM.md) and [current evidence](verification/phase07-telegram.md). No production deployment, webhook, secrets or schedule is installed.

## Pinned tooling and offline checks

`scripts/toolchain.json` pins Deno 2.9.6, Supabase CLI 2.122.0 and the verification-only `postgres` client 3.4.9. Deno generated the dependency lockfile. The application still uses the specified Edge/`supabase-js` architecture; the direct SQL client is confined to guarded operator tools.

Deno/Supabase were absent from PATH. Use pinned npm-cache tools without a global installation, or install those versions separately:

```text
npx --yes --package deno@2.9.6 --package supabase@2.122.0 deno cache scripts/db/main.ts
npx --yes --package deno@2.9.6 --package supabase@2.122.0 deno task check
```

With tools on PATH, run `deno task check`, `deno task db:plan`, `deno task db:verify`, and `deno task secrets:scan`. `check` covers formatting, lint, TypeScript/import boundaries, five offline target/history/redaction guard tests, unit/contract suites, structural migration checks, credential patterns and documentation validation. Hosted tasks separately prove PL/pgSQL, constraints/concurrency/RLS and application persistence. No local PostgreSQL, SQLite, Docker or `supabase start` is required. Documentation validation uses Windows PowerShell or `pwsh` elsewhere.

## Explicit target and secrets

Phase 03 adds `deno task test:integration` with the same isolation guards and successful database receipt requirement. It uses pinned Supabase-js `2.118.0` for actual RPCs; Postgres.js remains verification-only. An existing backend API key is retrieved in memory through the verified project's Management API, never printed or stored. Missing scoped read permission is a visible blocker; do not broaden credentials merely to pass a check.

Copy [target.example.json](../scripts/db/target.example.json) to ignored `private/database-target.json`. Its blank defaults are intentionally invalid. Supply the actual ref/name, class `development` or `disposable_branch`, known production refs, `confirmedNoValuableData=true`, and confirmation `phase-02:<actual-ref>`. This attestation designates the environment; actual read-only identity/data checks must also pass.

Create an ignored `.env` at the repository root from [.env.example](../.env.example), then fill `SUPABASE_ACCESS_TOKEN` and `RADAR_DB_URL` locally. The `db:plan`, `db:verify` and `db:types` tasks load this exact file using Deno's built-in `--env-file=.env`; existing process environment values take precedence. Offline `check` and `secrets:scan` do not load credentials. Never put values in chat, command arguments, Git or logs. A CLI login alone does not supply the runner's explicitly required environment token. Optional `RADAR_DB_TARGET_FILE` selects an in-repository config file; `RADAR_SUPABASE_CLI` selects the pinned native CLI binary when PATH discovery is insufficient.

`SUPABASE_ACCESS_TOKEN` is a personal access token from the Supabase account's Access Tokens page, used for project inventory/type generation. It is distinct from the project's publishable/anon or secret/service-role API keys; those cannot replace database credentials for migration/SQL verification. Obtain `RADAR_DB_URL` from the isolated project's Dashboard **Connect** dialog using its database password. If the password contains reserved URL characters, percent-encode the password component. Keep `RADAR_DB_PLAN_SHA256` blank until the read-only plan succeeds and has been reviewed. The separate target configuration and all hosted isolation gates remain mandatory. Adding `.env` support does not remove the current tooling's pinned CLI dependency.

The SQL URL must identify the same ref using `db.<ref>.supabase.co`/`postgres`, or a Supabase session-pooler host/`postgres.<ref>`. Only port 5432, database `postgres`, a present password and verified TLS are accepted. Localhost, arbitrary/other-project hosts, port 6543 and URL query/TLS overrides are refused. This is an operator connection, not a runtime application credential.

When the system trust store does not include Supabase's database CA, download the certificate from Dashboard **Database Settings → SSL Configuration** to ignored `private/supabase-ca.crt`. The runner reads this optional bounded PEM bundle and still verifies the chain and actual hostname. The current public certificate URL used by the [official Dashboard source](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json) is [Supabase production CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). Review provenance/validity on renewal; never use `rejectUnauthorized=false`, `sslmode=require` without verification, or a machine-wide trust change as a workaround. A missing/invalid CA fails visibly. The Deno task allowlist includes the exact PG-prefixed defaults read by pinned Postgres.js, including `PGSSLNEGOTIATION`; no unrestricted environment grant is used.

The runner checks CLI version, authentication, actual Management API project ref/name/healthy status, exposed Data API schemas, PostgreSQL version/extensions/roles, application objects/data and migration history before writing. Conflicting links, known production refs/names, unrelated objects, application data or divergent history stop it. It also refuses existing auth users, storage objects/buckets, Vault secrets or Cron jobs, using existence queries without reading personal data/secret values. Actual Data API exposure must exclude `radar`. Existing `radar` application tables must be empty; interrupted fixtures require explicit review rather than broad deletion. Read-only operator review records backup/permission findings and any limited plan visibility without guessing entitlements; production plan/pause/recovery suitability remains a release gate.

## Review, apply and hosted verification

1. `deno task db:plan` is read-only and writes no plan file. It prints the target, pending migration names/hashes and a target/history-bound `planHash`.
2. Review inventory and complete migration SQL. Then set `RADAR_DB_PLAN_SHA256` to that exact reviewed hash. Changed SQL, target or history invalidates it.
3. `deno task db:verify` repeats inventory, acquires a verifier lock, checks again, and applies each pending migration transactionally. It records exact SQL/name/version in Supabase CLI-compatible `supabase_migrations.schema_migrations`. All application DDL comes from versioned migrations; no Dashboard tables or history repair.
4. Check history and invoke the apply path again: it must be a history-based no-op. SQL is compared exactly after newline normalization.
5. Run [SQL assertions](../supabase/tests/database/01_contract.sql) and [query-plan fixtures](../supabase/tests/database/02_query_plans.sql) in always-rolled-back transactions, plus [concurrent-client assertions](../scripts/db/verify-concurrency.ts) under the actual backend role. The runner reports assertion counts and validated index names. Concurrent tests commit only temporary UUID-scoped fixtures, remove only those rows, and restore pause flags. Failed cleanup fails validation.
6. Re-inventory, save a successful receipt in ignored `private/phase02-verification.json`, then generate actual hosted types. A failed/missing gate keeps Phase 02 incomplete.

The SQL tool is an operator client, not an arbitrary-SQL application RPC. Migration-history bootstrapping is infrastructure compatible with the CLI. Do not mix history writers without reviewing statement serialization. This custom read-only plan avoids putting credential-bearing SQL URLs into process arguments; see the official [migration workflow](https://supabase.com/docs/guides/local-development/database-migrations).

Admin tasks need outbound networking and execution of pinned tools; offline guard tests have no network/environment permissions. No `--allow-all` task exists. Errors print fixed guard diagnostics or SQLSTATE, withholding server messages, SQL, values and URLs.

## Hosted tests and evidence

Coverage includes all tables/types/RPC grants, actual denied statements under `anon`/`authenticated`, backend success, source-run coalescing, cursor/page replay, malformed siblings, source-record uniqueness, deadline precision/revision, unchanged refetch, inbox deduplication, fenced feedback/state, assessment constraints, notification schedules/claims/target ownership, uncertain sends, invalid lease transitions, real expiry/reclaim and timezone validity.

Separate clients test `SKIP LOCKED`, identity convergence/no orphan canonicals, inbox/feedback races, competing digest claims, losing-transaction rollback and a crash after the sending marker. No website, ranking, webhook, Bot API or active schedule is involved. These tests passed on the designated isolated project; [evidence](verification/phase02-database.md) records exact target, versions, limitations and results. New operators must still pass every isolation gate; the previous result does not authorize testing a different default target.

## Actual generated types

Phase 04 `test:conferences` and `sources:smoke --source <approved-slug>` reuse the exact target identity, no-valuable-data inventory, migration/schema/receipt and advisory-lock gates used by integration. Smoke accepts only the reviewed `ccfddl`, `ccfddl-hotos` or `openreview-workshop-call` slug and performs at most two public upstream requests for first collection/replay. It uses application Supabase-js RPCs for persistence, operator SQL for scoped fixture setup/assertions/cleanup, creates no profile/notification, and restores collection pause. A missing/unapproved slug fails before target or upstream IO. The API key is read into memory only, using the existing guarded flow. See [source evidence](sources/ccfddl.md) for current paths/permissions and resource limits.

After verification the tool calls:

```text
supabase gen types typescript --project-id <verified-ref> --schema radar,public
```

Output goes to `supabase/functions/_shared/infrastructure/supabase/database.types.ts`. This actual generated file exists; no handwritten replacement was used. `deno task db:types` regenerates only after a matching receipt, current history, schema fingerprint and verification-suite hash check. Changed migrations, SQL test definitions or runner require verification again. Generated output is formatted with `--no-config`; that exact generated file is excluded from normal formatting/lint, while application modules are checked. Run `deno task check` and review the generated diff afterward.

## Remaining gates and recovery

For future runs, designate the isolated target and secure authentication; inventory actual data/backups/permissions and record limited plan visibility without guessing; review pending SQL; execute SQL/concurrent-client tests, reapply/cleanup and query plans; generate actual types and run final checks. The current target has zero backups/PITR disabled, and its scoped token cannot inspect organization entitlements. Production plan/pause/restore suitability remains a Phase 10 gate. Never reset a remote project. All seven applied migrations are immutable; fix forward. Interrupted fixtures require scoped review/cleanup. Real conference-source adapters are now local code with isolated development validation; production apply/enablement, bot and Cron activation remain later-phase work.
