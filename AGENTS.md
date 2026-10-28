# Research Radar engineering contract

## Read first

Always read this file, [PLANS.md](PLANS.md), and the active specification under [harness/build/](harness/build/) before editing. Inspect the current implementation, relevant tests, Git root/status scoped to this project, and applicable ADRs before proposing changes. Read the relevant product/architecture/database/source/deployment documents for the work in scope. Do not assume a previous session's plan matches the current repository.

Workspace host instruction supplied for this project:

@C:\Users\ADMIN\.codex\RTK.md

Read that file when present. Its command-prefix policy is to use `rtk` for shell commands. If RTK is unavailable, report the environment limitation and use a process-local transparent passthrough or the equivalent ordinary command; do not install software or claim RTK filtering ran. Do not change machine-wide settings. This host reference is not an application dependency.

## Phase discipline

1. PLANS.md is the sole phase-status and activation authority. Implement only its active phase. If `Active phase: none`, do not start the next phase without a user request activating it.
2. Read the complete phase specification before editing. Map requested work to its acceptance criteria and state any necessary assumption.
3. Completing a phase never activates its successor. Stop after validation, evidence, and documentation updates for the active phase.
4. Do not silently change architecture, introduce a platform, or expand scope. A material decision requires an ADR with consequences, plus updates to affected specs. A contradiction requires resolution before dependent implementation.
5. Do not claim completion with failing checks, unrun required integration checks, missing manual evidence, unresolved security gates, or skipped required category coverage. Record blockers honestly; keep status active until exit criteria pass.
6. Do not work around unavailable hosted validation by substituting mocks and calling integration complete. Mocks are useful but not persistence/concurrency/RLS evidence.
7. Keep changes reviewable. Avoid unrelated refactors, speculative abstractions, empty module trees, fabricated credentials/data, and placeholder implementations presented as working features.

## Platform and boundaries

- Backend platform: Supabase PostgreSQL, Edge Functions, Cron, Secrets, Logs, and Vault where scheduling requires it. Runtime: TypeScript, Deno-compatible libraries, `supabase-js`. No separate application server, Railway, VPS, persistent local service, required Docker/local database, Python, FastAPI, SQLAlchemy, APScheduler, Redis, Celery, Kafka, or Kubernetes without a new justified and explicitly authorized architectural change.
- Domain imports only domain/standard language facilities. No source-specific logic, Telegram DTOs, Supabase row/client types, HTTP calls, environment reads, or LLM SDKs in the domain.
- Source-specific fetch/parse/mapping stays in its source adapter. No Telegram logic in collectors; no scraping inside command handlers or database transactions.
- Telegram is a delivery/UI adapter. Authorize and translate at the boundary; application use cases receive profile/action/domain identifiers.
- Preserve the pipeline stages and shared Opportunity model in ARCHITECTURE.md. Do not bypass normalization, validation, deterministic identities, or field provenance to make one source easier.
- Always filter deterministically before ranking a shortlist or invoking an optional LLM. No record-by-record automatic LLM calls. The system must remain useful with no LLM configured. LLM implementation is outside the current ten-phase plan.

## Data correctness and reliability

- Use stable source keys, conservative identity claims, and atomic RPCs. Candidate fingerprints and mutable deadlines are not unconditional unique identities. Preserve edition/track/round differences.
- Never turn unknown dates/timezones, remote status, publication times, organizations, eligibility, or source permission into invented facts. Keep null/unknown/assumed evidence explicit.
- Scores, saved/ignored state and notification timestamps belong to profile/delivery tables, not shared opportunity columns.
- Idempotency must survive concurrency and redeployment. Use durable inbox/outbox, task keys, database constraints and fenced leases. Do not rely on process memory, a maximum Telegram update ID, or detached background promises.
- One source failure or malformed record cannot fail unrelated sources or valid siblings. Enforce bounded work, timeouts, response sizes, retries and cooldowns.
- Never promise exactly-once Telegram sends. Persist sending attempts before IO; uncertain outcomes require the documented conservative resolution policy, not automatic blind replay.
- No external IO inside a database transaction. No remote `db reset`. Production/shared migrations are append-only after first use; correct forward and preserve data across function releases.

## Security and external effects

- Never commit secrets, personal profile exports, production dumps, raw authorized Telegram payloads, or unredacted logs. Keep secrets in Supabase secret storage/Vault; local secret files are ignored.
- Supabase privileged/service-role keys stay server-side. They bypass RLS; do not assume RLS protects a compromised function. All ingress authenticates before privileged work.
- Require Telegram webhook secret, configured user ID allowlist, private-chat binding, callback authorization, duplicate update handling, and authenticated internal job endpoints. Never use username or publishable key as authorization.
- Private database schema and restrictive RPC grants are defaults. Any public endpoint, exposed schema or privilege expansion requires explicit design and tests.
- Treat source data as hostile: parameterize SQL, escape Telegram text, validate safe URLs, restrict HTTP destinations/redirects, disable unsafe XML/YAML features, and bound inputs. Do not log credentials, tokens, headers, raw messages or full personal preferences.
- Source onboarding requires current terms/robots/license evidence and fixture provenance. Public readability is not automated reuse permission. No login/CAPTCHA bypass or private API assumptions.
- Git operations must stay inside the intended repository. Inspection found the Git root at `D:/`; verify/correct project isolation before staging, without altering the unrelated parent repository. No commit, push, GitHub resource, deployment, webhook registration or Cron activation is authorized by Phase 01.
- Later phases follow their stated environment gates. Reversible local code/doc/test work needs no extra approval. External writes need session authorization and the correct verified target; complete the concrete reviewable work first. Do not add approval flows for routine implementation choices.

## Tests, documentation, and handoff

- Every external source needs fixture-based pure parser tests, normalization/identity expectations, malformed input cases, and source contract tests. Normal deterministic tests cannot require a live website or production credentials.
- Follow [docs/TESTING.md](docs/TESTING.md). Use the phase's exact validation commands. Test meaningful behavior and failure boundaries; do not add tests that merely duplicate implementation or widen test runs without a reason.
- Database uniqueness, concurrency, grants and lease behavior require isolated hosted integration evidence. Live source/Telegram smoke checks are explicit, separate tasks with recorded target and bounded effects.
- Pin dependencies, use lockfiles, preserve Deno compatibility, and record minimum supported tool versions when tooling is introduced. Avoid broad test permissions.
- Update relevant documentation, source register and changelog when behavior/architecture changes. ADRs are historical records: supersede decisions explicitly rather than rewrite their history.
- At phase end, record commands/results, manual evidence, limitations and any unresolved questions in PLANS.md. Mark complete only after every exit criterion passes; then set active phase to none and stop.
- Never commit or push unless the user explicitly asks. Never deploy merely because tests pass. Final product completion requires the real deployed end-to-end evidence in Phase 10.
