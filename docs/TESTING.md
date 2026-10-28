# Testing and validation contract

## Current executable check

Phase 01 provides only documentation validation. From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-docs.ps1
```

Apply the host's `rtk` prefix when available. The validator is offline and read-only: required files/sections, phase order/status, ADR presence, local Markdown links, balanced fences and no accidental application/migration files in the foundation. A pass is structural evidence, not proof of architectural correctness; a senior handoff review is also required.

## Future task interface

These are **required future task names**, not commands available in Phase 01. Phase 02 introduces `deno.json`, a lockfile, supported tool versions and task runners. Create later tasks in the phase that owns their implementation; a not-yet-owned task is not a silently passing stub. Existing tasks fail on missing required inputs or unexpected zero-test discovery.

| Task | Introduced | Contract |
| --- | --- | --- |
| `deno task check` | 02 | Formatting, lint, type check of existing code, documentation validation or portable equivalent, and dependency/architectural import checks as modules appear. No runtime service dependency. |
| `deno task db:plan` | 02 | Read-only migration inventory/diff for an explicitly supplied target; no apply/reset/secret output. |
| `deno task db:verify` | 02 | Apply/verify migrations and SQL assertions only on an explicitly verified isolated hosted target; fail closed if absent/mismatched. Tests key constraints, privileges and atomic primitives, then cleans only its test-owned data. |
| `deno task test:unit` | 03 | Pure domain/use-case/renderer/parser tests, injected clock/HTTP and sanitized fixtures; no external website, credential or database. |
| `deno task test:contract` | 03 | Shared source contract tests against fake adapter first, every real adapter later; stable keys, per-record failures and bounded outputs. No live network. |
| `deno task test:integration` | 03 | Hosted persistence/concurrency pipelines with fake external HTTP and fake delivery. Explicit isolated target required; no production target or website. |
| `deno task sources:smoke --source <slug>` | 04 | Opt-in bounded live read of one approved source; explicit source/config, rate/rights review, no Telegram sends. Report counts, quality and resource timing. No scheduled production writes. |
| `deno task ops:verify` | 09 | Time-controlled schedule/recovery scenarios plus isolated hosted lease/outbox/retention drills. No production Cron activation or live send. |
| `deno task release:verify` | 10 | Redacted production readiness/evidence checks, auth probes, versions, coverage, schedule/business outcome accounting and release criteria. Any real write/send is a separately explicit controlled step, not a side effect of a read-only check. |

Scripts must support the Windows workspace and Deno without requiring Python, Docker or a local Postgres. Dependency fetching/bootstrap is separate from deterministic offline test execution. Pin exact versions/imports and cache dependencies before offline checks; do not allow network in unit/parser tests to hide missing fixtures.

## Test layers

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

Run the active phase's commands from its specification. From Phase 03 onward, the default completion set is `check`, `test:unit`, `test:contract`, `db:verify`, `test:integration`, plus phase-specific checks. Source smoke tests are isolated from deterministic suites and bounded/authorized; a website outage is reported as a live-source limitation, not silently turned into a passing parser test.

Record command, exit result, version/date and a useful sanitized outcome. “Not run” and “skipped” are not “passed.” Repeat or broaden checks only after meaningful edits/failures/unresolved concerns. Phase 10 adds real runtime benchmarks, auth/security probes, backup/rollback drills, live user journeys and seven-day unattended observation. All final production claims require deployment evidence.
