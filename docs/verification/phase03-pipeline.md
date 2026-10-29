# Phase 03 pipeline verification and handoff

Verified: 2026-10-29. Status: complete; active phase none; Phase 04 pending.

The application was exercised against an explicitly verified isolated hosted development database. No real source, Telegram request, Edge deployment, Cron activation or production mutation occurred. Phase 03 changes are uncommitted; the authorized Git push covered the previously completed Phase 02 baseline.

## 1. Git baseline

Root `D:/projects/research-bot`, branch `main`, origin `https://github.com/Azios1010/research-bot.git`. Phase 02 was initially uncommitted, so implementation waited for the prerequisite. The user explicitly authorized its commit/push and making `main` primary. Baseline is `cb9e3a5f0567aedabd0bf9aebc81b1e9b567db15` (`feat(db): establish verified private Supabase persistence layer`), pushed to `origin/main`; GitHub and `origin/HEAD` default to main. Phase 03 began from a clean tree. Parent Git metadata and earlier history were not changed.

## 2. Modules added

Under `supabase/functions/_shared/`: `domain/`, `application/`, `adapters/sources/fake/`, `infrastructure/http/`, `infrastructure/observability/`, plus the Supabase client/repository beside actual generated types. `supabase/functions/job-worker/index.ts` is the composition root. No empty future-module scaffolding was added.

## 3. Domain types

Implemented drafts and normalized shared fields for eleven types/four families, temporal evidence/stable rounds, source identity claims, bounded provenance, closed quality flags, record/errors, candidate sets, proposals and page results. Persisted opportunities carry content revision plus opaque evidence version for reconciliation CAS. Assessment types carry eligibility, components/reasons, relevant revisions and validity. Domain modules import only domain/standard language facilities.

## 4. SourceAdapter contract

Manifest fields: `slug`, `parserVersion`, `supportedTypes`. `collectPage(context,cursor,validators)` is asynchronous transport; `parsePage(CollectedPage)` is pure and yields `ParsedRecord | RecordError`. Context injects HTTP, clock, abort signal, limits and approved source configuration. No parser writes to persistence or calls Telegram. Changed document shape fails the task; empty-valid and conditional not-modified have distinct outcomes.

## 5. Normalization

Display NFC and comparison NFKC/lowercase, whitespace collapse, reviewed organization aliases, sorted unique topic/qualification tags and ISO alpha-2 countries; unknown work mode remains unknown. URLs allow HTTP/HTTPS for provenance, exclude dangerous schemes/userinfo/private literal/local destinations and remove only known tracking parameters/fragments. Path case and identity queries remain significant. Fetch destinations are separately restricted to exact approved HTTPS endpoints. Cycle/track normalization distinguishes missing null from an explicit empty default track. Attributes validate version/type-specific journal and funding evidence. Missing/invalid optional facts produce explicit flags without manufactured publication times or organizations.

## 6. Temporal rules

Offset instants normalize to UTC while preserving up to microseconds and original timezone token/basis. Known IANA local clocks resolve only unambiguous times; DST gap/fold, untrusted basis and unknown abbreviation remain unknown/conflicted. AoE conversion requires explicit adapter support/source evidence. Dates stay dates with null instant. TBD/rolling retain null date/instant and labels. Event dates never become application deadlines. Stable `(kind,round_key)` separates rounds; missing round evidence is preserved in the bounded snapshot and flagged rather than indexed by mutable date. Conservative UTC-12 date expiry is derived only for eligibility. Conflicted/rolling/unknown rounds prevent inferred closure.

## 7. Identity and fingerprints

Source record keys are versioned `fake-v1:<producer_id>`. Resolution uses existing source observation, reviewed strong claims, then conservative exact candidates. Version-1 SHA-256 hashes explicit ordered family/title/org/cycle/track components using canonical JSON; object keys are sorted and array order explicit. Deadlines/fetch times do not participate. Natural claims require known organization/cycle/track; reviewed listing claims are type/cycle/track scoped. Fingerprints remain nonunique. Unknown/ambiguous/truncated candidates are separate flagged records; two strong owners quarantine a conflict.

## 8. Reconciliation

Reviewed field authority, observed instant and deterministic source-slug precedence select facts; null/unknown evidence cannot erase known values. Current source corrections revise stable rounds. Equally authoritative conflicting sources mark deadlines conflicted; stronger authority can resolve them. Selected fields retain their actual observation origin. SQL binds a newly allocated source-record UUID atomically. Provenance-only refresh does not increase content revision. No real-source trust ranking was invented.

## 9. Persistence and migrations

Pinned `supabase-js@2.118.0` calls the actual typed backend RPCs; generated rows/JSON contexts are mapped explicitly in infrastructure. Application code uses no Postgres.js, direct SQL, generic SQL RPC or independent REST write sequence. Existing 18 tables/private `radar` schema remain unchanged and unexposed to the Data API. All tables retain RLS and restrictive grants; fifteen public invoker RPCs deny PUBLIC/anon/authenticated and grant deliberate service-role execution. No permissive policy or SECURITY DEFINER function was added.

Four forward migrations are applied and immutable:

| Migration | Reviewed SQL SHA-256 |
| --- | --- |
| `20261029000100_pipeline_contract.sql` | `1f232bf914536a4c1d6e36e15255f5dd5893b09eecdc9ff75e5f52142db57f64` |
| `20261029000200_revision_conflicts.sql` | `5857bf299e1b2ebe62eb8017d29494c4ad8302a5d8f931499f9aaf793fecc5c8` |
| `20261029000300_validator_scope.sql` | `c0ece3b04268843a9cd9e977cf8a2855e85dd06ceab2ea2642db599c79aa8d70` |
| `20261029000400_provenance_cas.sql` | `c58a4332b526f1f6bb88c76143f12afeafee65a85b61ebe1dc0eddd82ab16f3b` |

The first adds three fenced context reads, bounded helpers, provenance binding, atomic assessment handoff and collector cancellation. The second changes three intentional stale-revision raises to PT409. The third scopes validators to the latest complete snapshot/current parser/config, preventing lost continuation work or false 304 after config changes. The fourth adds opaque provenance CAS without changing content revisions, tables or grants. Original Phase 02 SQL is untouched; seven migrations are applied in total.

Generated types: `supabase/functions/_shared/infrastructure/supabase/database.types.ts`, produced by the actual CLI after successful hosted verification. Regenerate using `deno task db:types`; its guarded equivalent is `supabase gen types typescript --project-id <verified-ref> --schema radar,public`. Do not hand-edit them.

## 10. Task worker

Claims `collect_page`/`assess_batch` only, at most five tasks and 45 seconds, with 90-second fenced leases and renewal before collection. Page commit atomically advances CAS cursor/counters, completes the task, creates continuation and enqueues assessment work for the single enabled profile. Replayed tasks return before transport. SQL enforces three total claims; retry delay honors Retry-After with bounded backoff/jitter. SDK retries are disabled. Source disable cancels without damaging health; stale owners stop writing. Internal secret is checked before constructing the privileged client. No permanently running worker, deployment or Cron exists.

## 11. Fake source coverage

Repository-authored synthetic JSON covers PhD/postdoc/research assistant/research internship, conference/workshop/conference CFP, journal CFP/special issue, grant/research funding. Fixtures include multiple rounds, dates/instants/AoE/rolling/TBD, absent employer/work mode, journal/funding attributes, duplicate keys, malformed siblings, ignored unknown optional fields and valid empty pages. The manifest records ownership/parser version and LF-normalized SHA-256 checksums. Fake transport exercises pagination/revision validators and classified failures without public internet.

## 12. Unit and contract results

35 unit tests + 6 source contract tests + 5 existing guard tests pass. Coverage includes normalization/URL hostility/bounds, temporal ambiguity, identity/edition distinctions, reconciliation authority/nulls/conflicts, score boundaries/exclusions/ordering, page errors/replay/re-read bounds, worker retry/isolation/cancellation, worker authorization, HTTP timeout/body/concurrency/redirect safety, RPC retry disabling and log redaction. Normal tests grant fixture reads only; no environment/network/process permissions.

## 13. Hosted target and integration results

Target: development project `research-bot`, ref `ihxoffjtrtyxgctcfgmy`, verified ref/name/status, PostgreSQL 17.11 and empty application data. Supabase CLI 2.122.0; Deno 2.9.6/TypeScript 6.0.3; Postgres.js 3.4.9 verification-only. The original operator isolation attestation, linked-target agreement, TLS verification/CA, production/unrelated-data rejection and exact migration history remain enforced. An existing backend key is read in memory only from the verified Management API and never stored/logged/created.

`db:verify` passed 73 constraint/grant/security + 13 context/handoff/provenance + 5 optimistic-conflict + 5 validator-scope + 4 provenance-CAS assertions (**100 total**), ten query plans, actual concurrent clients, no-op reapply, cleanup and actual type generation. Receipt: `2026-10-29T08:12:56.708Z`; schema fingerprint `f64c621637966fe7e60ae486662f6eb6cbff5e21f99687de29545410a968e7d1`.

`test:integration` passed **24 named assertions through actual Supabase-js HTTPS RPCs**. Receipt: `2026-10-29T08:15:58.482Z`, code/test/fixture/migration input hash `1f54869a775e192a1ffc441fbee4de620b5d3a65b3d1f82b43bb0649f1de3e31` (checked unchanged across the run). It covers all types, provenance/authority CAS, complete-snapshot validators, continuation, 304, revisions, conflicts, leases and failure isolation. Operator SQL is fixture setup/assertion/cleanup only. Fixtures were removed, pause restored and final inventory confirmed no application data. No mock substitutes for hosted results.

## 14. Replay result

Reprocessing a completed page returns a tombstone before fetching/parsing. Eleven canonical opportunities/observations and one assessment handoff remain; counters/cursor are byte-equivalent before/after. In-page duplicate source keys count once. Independent conditional refetch creates a genuine not-modified run with zero seen records. Continuation processes a second bounded page exactly once.

An interrupted snapshot cannot reuse validators or skip its unprocessed continuation; a changed config/parser cannot reuse an older validator even if ETag text matches. Complete partial runs with durable quarantines remain cacheable. SQL also proves no fallback to an older completed run after a newer interruption.

## 15. Concurrency result

Two actual HTTPS workers read candidates behind a shared barrier, then submit conflicting strong identities simultaneously. They converge on one canonical and durable source observations; per-run accounting stays one. Simultaneous duplicate-run requests coalesce, and simultaneous SKIP LOCKED claims yield one task owner. These are overlapping requests, not sequential simulations. Existing hosted SQL clients additionally exercise inbox/feedback/outbox races.

A separate adversarial race pauses a weak worker after its read, commits stronger identical facts with unchanged content revision, then resumes the weak proposal. Provenance CAS forces PT409/re-read; the stronger title/provenance survives and content revision remains stable. Barriers are bounded and all concurrent branches settle before cleanup.

## 16. Partial-failure result

Valid A, malformed B, valid C and replayed A yield two accepted canonical records plus one durable quarantine; `records_seen=3`, `accepted=2`, `rejected=1`, run partial. Document-shape failure commits no page and does not prevent another source's task from succeeding in the same bounded worker. Disabled source during processing commits no record/cursor and preserves failure health.

## 17. Transaction rollback result

The actual commit RPC receives a new first record followed by an intentionally stale existing-record revision. It returns HTTP 409/PT409. Neither the first canonical/observation nor any cursor/count change survives. The use case re-reads/reconciles once without refetching and commits one insert plus one update. Separate SQL assertions prove late handoff failure rollback and stale assessment revision rollback. Crash before commit leaves counts/cursor untouched; durable retry reclaims the same task with a newer generation. An actually expired lease is reclaimed and its former owner's commit is denied.

## 18. Files changed

57 files changed: 18 modified tracked files and 39 added files. Root architecture/database/source/deployment/operations/README/roadmap/changelog, Phase 03 spec, testing/workflow docs, Deno config/lock, check/database tooling/toolchain, function config and actual generated types were updated. Added modules/tests/fixtures/SQL are listed below.

```text
docs/adr/0008-pipeline-context-and-durable-assessment.md
docs/adr/0009-optimistic-conflict-http-status.md
docs/adr/0010-provenance-optimistic-token.md
docs/verification/phase03-pipeline.md
supabase/functions/_shared/domain/
  model.ts primitives.ts temporal.ts normalize.ts identity.ts reconcile.ts assessment.ts
supabase/functions/_shared/application/
  ports.ts collect.ts worker.ts
supabase/functions/_shared/adapters/sources/fake/adapter.ts
supabase/functions/_shared/infrastructure/http/
  bounded.ts worker-handler.ts
supabase/functions/_shared/infrastructure/observability/logging.ts
supabase/functions/_shared/infrastructure/supabase/
  client.ts repository.ts database.types.ts
supabase/functions/job-worker/index.ts
supabase/migrations/
  20261029000100_pipeline_contract.sql
  20261029000200_revision_conflicts.sql
  20261029000300_validator_scope.sql
  20261029000400_provenance_cas.sql
supabase/tests/database/
  03_pipeline_context.sql 04_optimistic_conflicts.sql
  05_validator_scope.sql 06_provenance_cas.sql
tests/support.ts
tests/unit/domain_test.ts boundaries_test.ts pipeline_test.ts
tests/contract/fake_test.ts
tests/integration/pipeline.ts
tests/fixtures/fake/all-types.json mixed.json empty.json manifest.json
```

## 19. Documentation and exact commands

Updated README, ARCHITECTURE, DATABASE, DATA_SOURCES, DEPLOYMENT, OPERATIONS, PLANS, CHANGELOG, docs/TESTING, docs/DATABASE_WORKFLOW and the Phase 03 build spec. Added ADRs 0008/0009/0010 and this evidence. AGENTS and Phase 01/02 historical ADRs remain unchanged; ADR 0008 records its same-phase validator follow-up.

The following all passed from the project root:

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:plan
deno task db:verify
deno task test:integration
deno task secrets:scan
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-docs.ps1
git diff --check
```

Deno/CLI are not on PATH; commands use the documented pinned bootstrap: `npx.cmd --yes --package deno@2.9.6 --package supabase@2.122.0 deno task <task>`. RTK is unavailable; the allowed process-local transparent passthrough is used without claiming filtering. Reviewed plan hashes are in PLANS.md. Final read-only plan has seven applied migrations, no pending SQL and hash `eb8d3e7aa666b2b2d259461230a85aadcb7b325fdf031485987fa9ae8aee822a`.

## 20. Deviations from Phase 01/02

Architecture-preserving corrections in ADRs 0008/0009/0010: private-schema context reads, atomic assessment/provenance handoff, collector cancellation, complete-snapshot validator scope, independent provenance CAS and HTTP-compatible optimistic errors. Actual HTTP rollback testing exposed the error-code incompatibility; [Supabase's explanation](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions) confirms affected platform behavior. We do not claim the target's exact PostgREST version. Entities, identity hierarchy, temporal semantics, platform and inward dependencies remain intact.

## 21. Unresolved risks

No Phase 03 blocker remains. Approved endpoint DNS ownership/pinning limitations must be reviewed before real source fetches in Phase 04. Real YAML/schema/rights/rate/resource behavior is untested by synthetic fixtures and belongs to source phases. Hosted Edge CPU/wall-clock behavior and actual production plan/pause/backup/restore suitability remain measured release gates; this target has no backups/PITR and billing entitlement visibility was limited. Personal research preferences/qualifications/timezone still require the later user setup/calibration phases. Multi-user runtime remains unsupported; multiple enabled profiles fail explicitly. No production reliability/deployment claim follows from isolated database tests.

## 22. Exact Phase 04 readiness checklist

1. User explicitly activates `04-conference-sources`; currently pending.
2. Review this uncommitted Phase 03 change; commit/push only when authorized. Recheck Git root/branch/history.
3. Read AGENTS/PLANS/full Phase 04 spec and applicable source/architecture/database/testing/workflow/ADRs, then inspect implemented ports/types/RPCs.
4. Preserve seven applied migrations; verify isolated hosted target again and rerun required checks before integration writes. Keep credentials/config/CA/receipts ignored.
5. Review current source license/terms/robots, endpoint/DNS ownership, host rate/access policy and safe YAML feasibility; no real source approval is supplied by Phase 03.
6. Select actual research categories or an explicitly nonpersonal test subset; define bounded file/snapshot scope and stable edition/track/round identities.
7. Complete Phase 04 checkpoints A/B/C in order with fixture provenance/checksums/revision, resource measurements, opt-in live smoke/isolated persistence and conference/workshop/standalone-CFP coverage. No production schedule, Telegram or LLM.

## 23. Recommended commit message

`feat(pipeline): implement bounded source-neutral opportunity processing`

Do not include ignored operator configuration or receipts. This report does not commit/push or activate Phase 04.
