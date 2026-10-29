# Testing and validation contract

## Current executable check

The source-neutral core and real conference-source adapters have executable offline unit/contract tasks and actual Supabase-js hosted integration. Current [Phase 04 evidence](verification/phase04-conferences.md): 52 unit, 14 contract and five guard tests; 100 hosted SQL assertions, ten query plans, real concurrent clients, 52 hosted application assertions and three explicit live smokes. [Phase 03 evidence](verification/phase03-pipeline.md) and historical Phase 02 results below remain separate baselines.

Phase 01 introduced documentation validation. Phase 02 adds the pinned `deno task check`, `db:plan`, `db:verify`, `db:types` and `secrets:scan` tooling described in [database workflow](DATABASE_WORKFLOW.md). Isolated hosted [verification](verification/phase02-database.md) passed: 70 SQL assertions, ten query-plan checks, concurrent clients, no-op reapply, cleanup and actual type generation. Hosted tasks still refuse absent or ambiguous targets; offline checks do not read `.env`. From the repository root, documentation validation remains:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-docs.ps1
```

Apply the host's `rtk` prefix when available. The validator is offline and read-only: required files/sections, phase order/status, ADR presence, local Markdown links, balanced fences and no accidental application/migration files in the foundation. A pass is structural evidence, not proof of architectural correctness; a senior handoff review is also required.

## Task interface

Phase 02/03 tasks exist with pinned Deno/CLI/Supabase-js versions and an actual generated lockfile. Tasks introduced in Phase 04 and later remain future contracts. No silently passing stub is allowed. `check` validates formatting, lint, TypeScript, module imports, five guard tests, nonempty unit/contract discovery, unit/contract behavior, documentation and credential patterns. SQL catalog/persistence/concurrency evidence requires the separate hosted tasks, which fail without a verified isolated target.

| Task | Introduced | Contract |
| --- | --- | --- |
| `deno task check` | 02 | Formatting, lint, type check of existing code, documentation validation or portable equivalent, and dependency/architectural import checks as modules appear. No runtime service dependency. |
| `deno task db:plan` | 02 | Read-only migration inventory/diff for an explicitly supplied target; no apply/reset/secret output. |
| `deno task db:verify` | 02 | Apply/verify migrations and SQL assertions only on an explicitly verified isolated hosted target; fail closed if absent/mismatched. Tests key constraints, privileges and atomic primitives, then cleans only its test-owned data. |
| `deno task db:types` | 02 | Generate from the actual hosted schema only after matching verification receipt, migration history and schema fingerprint. No handwritten substitute. |
| `deno task test:unit` | 03 | Pure domain/use-case/renderer/parser tests, injected clock/HTTP and sanitized fixtures; no external website, credential or database. |
| `deno task test:contract` | 03 | Shared source contract tests against fake adapter first, every real adapter later; stable keys, per-record failures and bounded outputs. No live network. |
| `deno task test:integration` | 03 | Hosted persistence/concurrency pipelines with fake external HTTP and fake delivery. Explicit isolated target required; no production target or website. |
| `deno task sources:smoke --source <slug>` | 04 | Opt-in bounded live read of one approved source; explicit source/config, rate/rights review, no Telegram sends. Report counts, quality and resource timing. No scheduled production writes. |
| `deno task ops:verify` | 09 | Time-controlled schedule/recovery scenarios plus isolated hosted lease/outbox/retention drills. No production Cron activation or live send. |
| `deno task release:verify` | 10 | Redacted production readiness/evidence checks, auth probes, versions, coverage, schedule/business outcome accounting and release criteria. Any real write/send is a separately explicit controlled step, not a side effect of a read-only check. |

Scripts must support the Windows workspace and Deno without requiring Python, Docker or a local Postgres. Dependency fetching/bootstrap is separate from deterministic offline test execution. Pin exact versions/imports and cache dependencies before offline checks; do not allow network in unit/parser tests to hide missing fixtures.

## Test layers

### Phase 03 executable suites

`test:unit` discovers `tests/unit/*_test.ts`; `test:contract` discovers `tests/contract/*_test.ts`. Both use `--frozen --cached-only --allow-read=tests/fixtures`, without network/environment/run grants. Bootstrap pinned dependencies into the cache first; a missing dependency fails rather than calling a website. The synthetic producer has a provenance manifest and LF-normalized UTF-8 SHA-256 checksums. Parser tests perform no IO; transport tests inject fetch/clock without real HTTP requests.

`test:integration` enters `scripts/db/main.ts integration` and reuses identity/isolation/empty-data/history/schema/receipt guards plus the verifier lock. It imports `tests/integration/pipeline.ts` only after those checks. Operator SQL creates/asserts/cleans UUID-scoped fixtures; the application uses actual Supabase-js HTTPS RPCs. The runner reads an existing backend API key from the verified project's Management API into memory only, never logging/storing/creating it or widening a PAT. Insufficient permission fails visibly. Operator credentials are not runtime credentials.

Hosted cases cover eleven types, deadline corrections, atomic assessment handoff, provenance, replay, conditional not-modified, malformed siblings, simultaneous HTTP identity/task claims, ambiguous candidates, strong conflicts, fences, crash/retry, source disable and rollback. Intentional stale revisions must return PT409/HTTP 409, not enter the platform's 40001 retry loop. A receipt in ignored `private/phase03-verification.json` is written only after success. Tracked evidence records outcomes; mocks cannot substitute for hosted cases.

### Domain and application

Test normalization of Unicode/titles/organizations, unknown work mode, countries, safe URLs, type mapping and attributes. Temporal cases include UTC/IANA/fixed offsets, AoE/source defaults, missing timezone, DST gap/fold, date-only, TBD/rolling, multiple rounds, extended deadlines and event dates distinct from closing dates. Freeze the clock; never use wall-clock dates in expected relevance assertions.

Deduplication cases include repeated source IDs, tracking parameters versus identity queries, reused homepages, different years/tracks, changed deadline, missing organization, conflicting strong keys, normalization version changes and weak fingerprint false positives. Ranking cases cover exclusions before score, blocked versus positive topics, qualification unknown/conflict, ignored-and-saved, threshold boundaries, expired assessments, deterministic ties and zero LLM configuration.

Use-case tests assert outcomes and effect boundaries, not line-for-line implementation. Fake ports simulate timeout, malformed siblings, partial pages, duplicate actions and crashes. Architecture import checks prevent outward dependencies in domain and adapter-to-adapter business logic.

### Source fixtures and parser contract

Each adapter has `tests/fixtures/<slug>/` with a manifest, minimal original-format fixtures and expected normalized output. Formats may be HTML, JSON, YAML, RSS/XML. Record original URL, retrieval date, upstream revision when known, license/permission note, sanitization, checksum and intended parser version. Do not vendor a large website or personal data dump.

Required cases: happy path, empty-but-valid, whole-document malformed/changed shape, one malformed sibling, missing optional fields, unexpected values, unsafe URLs, oversized input, duplicates, source ID stability, pagination/cursor or snapshot behavior, closed/rolling/date-only records where relevant. Conference fixtures include abstract/paper rounds and source-assumed timezones. Job/funding fixtures include eligibility evidence and mixed nonresearch listings. Journal fixtures distinguish active calls from published collections and call/issue duplicate URLs.

Fetch tests use injected HTTP responses, headers, redirects and aborts. Parsing tests have no IO. Shared contract tests verify source slug/version/types, stable record keys independent of mutable deadlines, bounded metadata, errors per record, and source-neutral drafts.

### Hosted database and integration

Verify migrations on a separate hosted project/database/branch with explicit identity checks. Mock tests cannot prove unique indexes, transactions, RLS or concurrent leases. Avoid requiring local Supabase or Docker; if no isolated target exists, record the check as blocked and keep the phase incomplete.

Exercise duplicate source/canonical creation concurrently; atomic page commit/cursor replay; stale-generation writes rejected; run coalescing across refresh/Cron; feedback replay; inbox acceptance plus task creation; notification schedule/claim conflicts; partially sent and uncertain attempts; canceled unsent claim release; anonymous/authenticated denied access to tables/RPCs; backend-only successful operations. Test failure between steps, not only the successful path. Never hold a transaction open across fake or real network IO.

Use test-owned identifiers and explicit cleanup. No production reset, destructive schema recreation, unscoped truncate or credentials in captured SQL output. Save sanitized results and exact target class. Check relevant query plans on representative bounded volume before release.

### Telegram and notification formatting

Phase 07 tests every command route, callback authorization and desired-state actions, private chat/user binding, missing/invalid webhook secret, body size/method, unknown commands, replay/out-of-order updates, unavailable database, stale pagination and deleted/merged opportunity references. Rendering snapshots cover escaping, multilingual text, bounded length, deterministic parts, deadline uncertainty and source attribution. Verify callback byte limits, not character counts alone.

Fake Bot API tests classify definite retryable/permanent failures, success with message ID, timeout after dispatch, crash after sending marker and ambiguous server errors. Direct URL buttons cannot be counted as Open events. Actual sends are only controlled test/live verification steps in the owning authorized environment.

### Scheduling and operations

Phase 09 freezes time around local midnight, DST changes, timezone/profile revision changes, repeated/concurrent ticks, clock advance after outage, deadline change, save/ignore before send, partial sends, lease expiry and source disable. Test 24-hour digest catch-up, six-hour reminder expiry and no reminder after deadline. Retention must preserve deduplication tombstones, schedule keys and claims. Redeploy recovery must not rely on memory or automatically replay uncertain sends.

Verify collection completion advances its next due time once, including manual refresh, and outage recovery creates one current collection rather than historical bursts. Reminder tests use the profile's digest local time and do not backfill a missed offset on a late Save. Event tests keep an upcoming conference browsable after paper submission closes. Rebinding a delivery target cannot bypass profile-level notification schedule uniqueness.

## Validation by phase

Phase 05 adds Bath RSS, CERN RSS/fixed-detail and Grants.gov JSON fixtures with factual transcriptions/projections and checksum manifests; no full protected adverts, API response tokens or contact data. Shared XML preflight rejects DTD/entities and bounds bytes/depth/nodes before tree parsing. `test:positions` runs focused isolated Bath/CERN fixture persistence. `test:funding` runs funding persistence and three-family failure/disable tests. The default `test:integration` retains 03/04 regressions and adds all these suites. CERN's historical doctoral RSS wrapper is explicitly synthetic around verified programme facts; no live PhD absence is filled with a fake record. Synthetic funding forecasts use a real observed forecast schema and are clearly distinguished from live NSF calls.

`sources:smoke --source bath-research`, `--source cern-students` and `--source grants-gov-research` are separate opted-in public reads through the same target/history/receipt/lock gate and scoped cleanup. Grants.gov's documented read API uses JSON POST; the HTTP client denies POST unless its exact URL is additionally approved. Tests cover body/header/redirect/size/timeout restrictions, and projection removes unrelated API fields before framing. No API key is required. See [ADR 0011](adr/0011-bounded-read-only-json-post.md).

`sources:jobs-benchmark` and `sources:funding-benchmark` are offline/cached-only: realistic rewritten fixtures and labeled maximum-sized XML/HTML/JSON padding, separate parser/mapping timing and process memory proxies. Live measurements separately record actual bounded bytes/requests. Evidence hashes include XML and HTML as well as TS/JSON/YAML/SQL inputs. Only the existing guarded database runner can invoke hosted source suites; no standalone SQL runner or unguarded smoke mutation was added. [Phase 05 evidence](verification/phase05-research-sources.md) records exact final results and limits.

Phase 04 adds strict CCFDDL parser/transport/identity fixtures under `tests/fixtures/ccfddl/` and `tests/{unit,contract}/*ccfddl*`. Copied YAML is MIT with immutable commit and LF SHA256 checks; the second-source JSON is handwritten official factual evidence, not a live collector. Test mutations are explicitly synthetic. Pure suites have no network or environment permissions. The YAML runtime import uses the pinned environment-free browser build, integrity-locked in `deno.lock`.

`test:integration` now runs the Phase 03 regression suite and then `tests/integration/conferences.ts` through the same verified target/receipt/lock gate. Conference fixtures exercise the actual adapter, bounded HTTP response handling, source-neutral pipeline and real Supabase-js RPCs. Operator SQL only creates/asserts/cleans scoped fixtures. Sixteen deadlines must fit without losing provenance; aggregate proposal overflow fails before commit. Live upstream smoke is a separate explicit command and never part of unit/contract runs.

`tests/integration/conference_coverage.ts` additionally verifies HotOS and the scoped public OpenReview call through the same path, including observation-bound provenance, exact versus source-default deadlines, content revisions and replay. `test:conferences` runs only Phase 04 hosted fixtures. `sources:smoke --source ccfddl`, `--source ccfddl-hotos` and `--source openreview-workshop-call` are explicit separate opt-in commands; no missing/arbitrary slug is accepted. Every invocation checks isolated identity/empty inventory/schema/history/receipt and takes the verification lock, then removes test-owned rows and restores the collection pause. Private success receipts bind normalized repository inputs, upstream content revisions/counts and cleanup; tracked verification evidence contains no credentials.

`sources:benchmark` is offline and cached-only. It measures complete copied YAML files (including the largest current upstream file) and openly labeled JSON padding at observed/maximum byte sizes. Live API full-response parsing timings are captured separately in smoke receipts. Process RSS/heap are memory proxies, not hosted peaks. Only Phase 10 can close the actual Edge CPU/memory/deployment gate.

Run the active phase's commands from its specification. From Phase 03 onward, the default completion set is `check`, `test:unit`, `test:contract`, `db:verify`, `test:integration`, plus phase-specific checks. Source smoke tests are isolated from deterministic suites and bounded/authorized; a website outage is reported as a live-source limitation, not silently turned into a passing parser test.

Record command, exit result, version/date and a useful sanitized outcome. “Not run” and “skipped” are not “passed.” Repeat or broaden checks only after meaningful edits/failures/unresolved concerns. Phase 10 adds real runtime benchmarks, auth/security probes, backup/rollback drills, live user journeys and seven-day unattended observation. All final production claims require deployment evidence.
