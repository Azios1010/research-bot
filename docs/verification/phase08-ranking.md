# Phase 08 ranking and personalization verification

2026-10-30. **Active and incomplete.** Mechanics validation passes; personal acceptance remains open. Actual researcher preferences, timezone, labels and threshold calibration have not been supplied. Synthetic fixtures are technical evidence only. Phase 09 remains pending; no LLM, new source, Cron, production deployment, commit or push.

1. **Git baseline.** `D:/projects/research-bot`, `main`, clean HEAD `96eb8285faac9253ddd62d7cc1a0dc8d070fa169` (`feat(telegram): implement durable Telegram command and callback interface`). `git rev-parse --show-toplevel`, status, branch and log were checked before edits; read-only `git ls-remote origin refs/heads/main` matches. No history rewrite, staging, commit or push.

2. **Profile schema.** Existing `rules_schema_version=1` and typed schedule columns remain. Strict TypeScript and database validation support additive optional rules; malformed/unsupported fields fail closed. Defaults leave researcher facts unknown. No second ranking system/table/schema/platform.

3. **Editable fields.** Positive topics/weights/aliases, blocked/ignored topics, enabled types/type weights, preferred/excluded countries/hard-country policy, work modes, preferred/blocked institutions, explicit compatible/conflicting requirement tags, known full-time-student status/nationalities, unknown policy, threshold, timezone, digest time/flag and reminders/offsets. Explicit rerank request is also available. [Exact syntax](../RANKING.md).

4. **Validation/bounds.** Rule JSON 16 KiB; Telegram patch 3,600 UTF-8 bytes within 4-KiB inbox envelope; text lists <=20 entries, text <=160 UTF-16 units, positive aliases <=10/topic, eleven type codes, type weights 0–1, topic weights >0–100, ISO countries, IANA timezone, HH:MM local time, <=12 integer offsets 0–365, threshold 0–100. SQL/TypeScript country catalogs have a parity guard. Matching/delivery enablement requires explicit readiness; reminders require explicit offsets. Invalid multi-field edits commit nothing; duplicate positive phrases reject, set lists normalize/deduplicate. [Complete schema](../RANKING.md).

5. **Revision semantics.** Existing trigger increments once for meaningful rules/schedule/enabled changes. Canonical no-ops retain revision. Inbox result journaling prevents replayed edits from incrementing again. Timezone/digest/reminder preferences store intent only.

6. **Rule version.** `deterministic-v2`; seven numerical component maxima retained. [ADR 0013](../adr/0013-versioned-profile-reranking.md) records matching, explicit exclusion/eligibility, unknown-work-mode and validity corrections requiring a new identity. No v1 weight semantics silently rewritten.

7. **Hard filters.** Disabled type/profile, Ignore, withdrawn/closed/merged, expired non-event deadlines/event end, blocked/ignored topics, blocked institution, explicit excluded/required geography, known qualification/eligibility conflicts, and explicit unknown exclusion. Filters run before positive components; excluded score is null. Unknown is not conflict.

8. **Topic matching.** NFKC/lowercase, Unicode letter/number/combining-mark boundaries, phrase-aware punctuation/hyphen handling, explicit aliases and weighted fractions. Each topic counts once even if several aliases match. AI/MRI/NLP/multilingual/accents/mixed-case and substring-negative fixtures pass. No embeddings or semantic guessing.

9. **Type scoring.** Explicit supported per-type weights multiply 15. Missing weight is zero; no implicit career/type hierarchy.

10. **Geography.** Preferred country or known work mode contributes 10 once; explicit excluded countries and hard preferred-country mismatch filter known evidence. Unknown geography/work mode stays neutral plus warning unless explicitly excluded.

11. **Institution.** Explicit normalized organization match contributes 10, or blocked institution excludes. No prestige/reputation database or inferred aliases.

12. **Qualifications/eligibility.** Explicit compatible tags contribute up to five; declared conflicting tags exclude. Known full-time-student requirement conflicts with explicit false. Citizenship exclusion is definite only when all supplied citizenships are excluded. Degree equivalence, nationality groups, languages, career stage, years since degree and other unsupported source facts remain unknown/manual confirmation; no personal compatibility is invented.

13. **Deadline component.** Remaining instant days floor into 0–2=3, 3–30=10, 31–90=6, otherwise zero. Date-only uses profile-local calendar dates with an advisory flag; unknown/rolling/conflicted contributes zero. Conservative UTC-12 date expiry is eligibility/order only. Elapsed paper submission does not close a future event.

14. **Freshness.** First-seen <=7 days gives 10, <=30 gives five, later zero. Refetch time cannot reset it; exact inclusive boundary and next-millisecond changes are tested.

15. **Range/components.** Topic/type/geography/institution/deadline/freshness/qualification maxima 40/15/10/10/10/10/5; total rounded to two decimals and bounded 0–100. Components, matched terms, exclusions/warnings, advisory deadline days, revisions, rule, evaluated time and validity reconstruct the result. Golden 100-point fixture asserts every component exactly.

16. **Threshold.** No personal threshold selected. Existing default 40 is explicitly provisional. Synthetic comparisons at 40/60/70/80/90 are technical demonstrations and cannot satisfy human calibration. An explicit bounded threshold can be stored through `/profile threshold N` after review.

17. **Ties.** Eligible first, score descending, next actionable deadline ascending/null last, first-seen descending, stable UUID ascending. Permutation tests prove deterministic order.

18. **Explanations.** Stable codes/components are translated into a bounded human-readable view, prioritizing topic/type/preferences. Details shows warnings and date uncertainty without raw component JSON or private qualification facts. Excluded details can explain Ignore/other gates. [Mobile artifact](phase08-rendering.txt).

19. **Telegram profile UX.** One explicit field command at a time, weighted topic/alias and map/list syntax, `clear`, visible state/revision/threshold, concise help, success confirmation and atomic invalid-edit response. Ownership/secret/private-chat gates remain Phase 07 contracts. No arbitrary JSON or language parser/wizard. Synthetic editing/mock review passes; actual profile review remains open.

20. **Invalidation.** Current opportunity revision, profile revision, rule and unexpired `valid_until` are required by personalized reads, snapshot pages and delivery eligibility. Validity is the earliest of 24 hours, exact expiry/event end, relevant deadline score boundary, local midnight for calendar scoring and freshness boundary. No minimum TTL extends past a near expiry. Profile edits do not recollect sources.

21. **Bounded reranking.** Existing `assess_batch`, <=50 UUID-keyset IDs/task, frozen upper UUID, profile/revision/rule coalescing scope; completion and continuation are atomic. `/profile rerank`/backend-only `rr_request_rerank` request explicit passes for rule/time changes. Existing <=5-task/45-second worker, fenced leases and capped retries remain. A later insert behind the cursor uses normal collection handoff or a later pass. No scheduler introduced.

22. **Concurrency/stale workers.** Store checks lease/membership, live revisions/rule/time, evaluation recency and Ignore. Older evaluations cannot overwrite newer ones; superseded chains cancel without writes. Assessment CAS uses the same profile lock as feedback/edits, in consistent order. Hosted HTTP overlap/claim tests are recorded with the final validation result below.

23. **Feedback context.** Rendered reply parts freeze bounded shown rule/score/profile/content revision/evaluated time. Exact message-authorized callbacks retrieve original exposure context, rather than guess the current score. Raw Telegram payloads/preferences are not feedback metadata. No automatic learning.

24. **Save.** Desired-state Save/Unsave persists event/current state idempotently, never changes ranking weights. Saving does not override an exclusion.

25. **Ignore.** Desired-state Ignore/Undo Ignore preserves independent Save. Ignore suppresses normal delivery before scoring; state changes enqueue assessment work and share its CAS lock. Reranking cannot resurrect ignored items.

26. **Open.** Explicit tracked callback records weak `open_intent` with exposure context. Direct URL buttons record nothing. Neither proves a page visit nor changes preferences.

27. **Claims.** Reranking touches assessments/tasks, not notification claims/history. Hosted fixture preserves an active already-sent digest claim across profile/ranking edits. No digest generator or sender is added by this phase.

28. **Golden results.** 24 synthetic examples across all eleven types, authored labels 14 relevant/eight irrelevant/two uncertain. Exact deterministic golden results pass along with deadline/freshness/Unicode/unknown/conflict/Ignore invariants. [Bounded synthetic review](phase08-synthetic-review.md). These are not researcher judgments.

29. **Personal calibration.** **Open.** Actual positive/negative preferences, timezone, eligibility facts, bounded reviewed labels, chosen threshold rationale and actual profile UI confirmation were not supplied. The offline private workflow validates <=24 records and <=8 test thresholds, writes only ignored private review output and mutates no profile/model. No personal profile was fabricated to close the phase.

30. **False positives/negatives.** At synthetic thresholds 40/60, two unrelated records score 60 from nontopic components; 70/80 removes those but admits an uncertain deadline case; 90 misses ten relevant examples in types without assigned type weight. No statistical generalization or synthetic “optimal” threshold is claimed. Phrase vocabulary, missing evidence and real source mix remain calibration blind spots.

31. **Hosted integration.** Final frozen `test:integration` passed **218 assertions**: core 24, SIGMOD 13, conference coverage 15, Bath 12, CERN 10, funding 14, journals 19, cross-source isolation 18, Telegram 53 and ranking 40. Focused `test:ranking` also passed the same 40 cases. Real Supabase-js HTTPS RPCs prove 123 persisted opportunities in bounded pages (including an expired event), concurrent claims/writes/Ignore, revision/rule/time fences, atomic profile replay and historical feedback/claim preservation. Target: isolated development `research-bot` / `ihxoffjtrtyxgctcfgmy`, PostgreSQL 17.11. All guards remain intact; no live source, Telegram or LLM transport was used.

32. **Unit/contract.** 116 unit, 38 contract and five guard tests pass; fourteen focused ranking tests include the 24-case exact golden set. `check` includes formatting/lint/types/import boundaries, docs and credential scan. Final command table below records completed validation.

33. **Database changes.** Five append-only migrations: `20261030000400_personalization`, `20261030000500_rerank_supersession`, `20261030000600_assessment_feedback_fence`, `20261030000700_profile_country_catalog`, `20261030000800_profile_normalization_validation`. Fifteen immutable migrations total, eighteen private tables, twenty-two narrow invoker public RPCs. Restrictive grants/RLS and private schema exposure retained; actual hosted CLI types regenerated. Reviewed plan hashes recorded below.

34. **Cleanup.** Final SQL, full HTTP and focused ranking runs removed their scoped fixtures; final independent inventories contain no application data, and pause flags are restored. The per-run UUID ledger and temporary private synthetic review inputs/output were removed. Interrupted diagnostic ranking/Bath fixtures were separately inventoried under identity/history/platform-data guards and cleaned only by reviewed exact UUID scope. No reset/truncate or unrelated/production deletion. Ignored operator configuration, CA, audit plans/receipts and logs remain private; no personal profile was created.

35. **Files changed.** 45 files: 26 modified tracked files and nineteen new files, all unstaged. Exact inventory below. Profile/scorer, neutral explanations, Telegram preference/exposure mapping, fenced persistence, guarded tooling, five migrations, SQL/unit/contract/hosted/golden tests, review/preview scripts, actual generated types and documentation. Source adapters/coverage and dependencies are unchanged.

36. **Documentation.** PLANS, README, CHANGELOG, Phase 08 specification, PRODUCT_SPEC, ARCHITECTURE, DATABASE, TESTING, DEPLOYMENT, OPERATIONS and Telegram guide updated; new profile guide, ADR 0013, synthetic review/mobile artifacts and this report. Historical ADRs/migrations/reports remain unchanged.

37. **Architecture deviations.** No platform, entity, ingestion, source, SDK/provider or scheduler addition. ADR 0013 concretizes allowed private RPC/profile validation, existing task/outbox reuse and current-rule fences. Follow-up forward corrections address cancellation, Ignore CAS serialization and exact ISO catalog parity, preserving applied history.

38. **Unresolved risks.** Actual personal calibration is an exit blocker. Eligibility interpretation is intentionally limited to explicit supported evidence; missing facts require confirmation. Synthetic threshold comparisons overrepresent PhD and cannot predict personal performance. Rule/runtime SQL versions must ship together later. Scheduled time invalidation dispatch/recovery belongs to 09, real gateway/resources/plan/restore/live delivery to 10. No production reliability claim follows.

39. **Exact readiness for Phase 09.** Do not activate it. First supply/validate actual explicit profile/timezone; review bounded representative real/sanitized results and labels; agree versioned weights/threshold with false-positive/negative rationale and blind spots; verify actual profile edits/view; add sanitized regression/aggregate calibration evidence without private exports; rerun affected required checks; only then close 08, set active none and await separate explicit 09 activation. Review/commit/push these changes only with separate authorization and recheck a clean baseline before later work. Preserve task/claim/auth/uncertainty boundaries; no production Cron is authorized.

40. **Recommended commit message.** `feat(ranking): add validated profiles and fenced deterministic reranking`. Recommendation only; no commit/push/deployment or Phase 09 activation performed.

## Validation evidence

Pinned launcher: `npx.cmd --yes --package deno@2.9.6 --package supabase@2.122.0 deno task <task>`. RTK is unavailable; ordinary PowerShell fallback used without installing software, changing host settings or claiming filtering. All runtime/source dependencies remain pinned and unchanged.

SQL reviewed plans: initial `85fc2f277712d7f20d25abd8b51cd362f3d5ba031a33ac838b8bf8cd9c8d5a72` failed before application on a PL/pgSQL CASE parse ambiguity. Corrected still-unapplied SQL was reviewed under `b9fe7aa769147d510d7f117b5b111d27590aced9ae9ada81bd7f3257721d1fd3` and applied. Subsequent forward plans: `ef33c92af74ae80ed9ca08b0cf60c3d8a4667abe1d5051574f07c8b6d009d36a`, `bc11a5f426d601732e0efc030e2e85a6c0fbed61d73e6f8dd6bfd25db813844b`, `1cb35d6885d871ac1e383c851c285777cfe1261e12787dc104b9aef3d6d7e021`. Normalization-parity plan: `573aec737d52594afabdab2450cb559299b202b97511443480eb68abca3be20c`. The fourteen-migration read-only plan had pending none and hash `1b0f2b78e37caad260c351a0ff3aedd265360c5647161586feba06476c1174d6`.

Diagnostic failures are not counted as passes: legacy task cancellation rejected superseded assessments, an expired-score fixture violated its own timestamp constraint, a same-statement assertion observed a subquery before a mutating function, the first focused ranking runner omitted its routing branch, a timestamp assertion lost Date milliseconds, and direct synthetic fixtures omitted required state timestamps/digest identity. An expected rejection in the overlap probe initially lacked an immediate handler and caused an early process exit; exact synthetic scope was reviewed under verified target/history/platform-data guards and removed. The test now observes the rejection immediately and writes a pre-mutation UUID recovery ledger, removed after normal cleanup. Long canonical descriptions also exposed the inherited short-key match limit; a pure regression and correction pass. Validity review then found already-expired events receiving an unpersistable past validity; both pure and hosted regression cases now cover future recheck validity without extending imminent expiry. A repeat suite hit an operator PostgreSQL-client socket teardown error; its one known Bath test source/four canonicals were inventoried, UUID-scoped cleanup ran and collection pause was restored. The verification-only pool idle timeout was increased to sixty seconds (pool still closes in finally); application persistence and dependencies are unchanged. A final validation-parity review aligned plain-topic whitespace duplicate checks with the pure parser and made SQL reject normalized-empty phrases/raw UTF-16 overflow. Input-stability gates rejected any in-flight run affected by a final code/fixture edit; only the final frozen run counts as current evidence. Each was corrected explicitly; applied migrations were never edited. The final frozen full and focused runs pass; earlier diagnostic or input-invalidated runs are not counted as current evidence.

## Final checks and evidence

| Check | Result |
| --- | --- |
| `deno task check` | Passed: format/lint/types/inward boundaries, five guards, 116 unit, 38 contract, documentation and credential patterns. |
| `deno task test:unit` | Passed: 116. |
| `deno task test:contract` | Passed: 38. |
| `deno task test:golden` | Passed: fourteen named ranking tests including 24 exact golden cases. |
| `deno task db:plan` / guarded migrations | Passed on the designated development target; five forward migrations applied/reapplied with exact history. |
| `deno task db:verify` | Passed: 172 SQL assertions, ten query plans, real concurrent clients, cleanup and actual hosted type generation. |
| `deno task test:integration` | Passed on final frozen inputs: 218 assertions; no application data remains. |
| `deno task test:ranking` | Passed focused on the same final inputs: 40 assertions and scoped cleanup. |
| `deno task ranking:synthetic` / `ranking:preview` | Passed; manual synthetic 38-column profile/details review covers explicit editing guidance, schedule state, reasons, uncertainty and multilingual source text. Actual researcher review remains open. |
| Private review workflow | Synthetic valid input passes, malformed JSON fails safely, temporary files removed; no personal data or threshold selection. |
| Receipt/input audit | All ten application receipts match final code/test/fixture hashes and development identity; total 218. |
| Documentation / privacy / diff | Documentation validator, Git-scoped credential/privacy scan and `git diff --check` pass. No secrets/personal exports staged or written into Git files. |

SQL receipt: `2026-10-30T08:54:57.907Z`; schema fingerprint `6117ebb39f2d68a3c1c4d3b87c001046ae6c05325f7a992f8cb25f2dcda9a846`; verification-suite SHA-256 `34d0ca71e3515d90befe67f35b0c10a78d71c9f7a332d823ef43d6b6178687f6`. Fifteen migrations, eighteen private tables and twenty-two public backend RPCs; generated types are actual CLI output from this verified schema.

Final application/source SHA-256: `05c754ab9a5a007acb35d6b8d2e5471499b4d94ef1ee587d6abf1a4e4d0bbe9c`. Core's separate recipe: `2f6b928a87e434f44c07e28bc0824972808abfb2bd9b62caeb98639fc80d31ca`. Receipts exclude private preferences; ranking receipt explicitly records `personalCalibration:false`.

## Exact changed-file inventory

45 intended files; nothing staged. Ignored credentials/configuration/receipts/audit logs are excluded.

```text
ARCHITECTURE.md
CHANGELOG.md
DATABASE.md
deno.json
DEPLOYMENT.md
docs/adr/0013-versioned-profile-reranking.md
docs/RANKING.md
docs/TELEGRAM.md
docs/TESTING.md
docs/verification/phase08-ranking.md
docs/verification/phase08-rendering.txt
docs/verification/phase08-synthetic-review.md
harness/build/08-ranking-and-personalization.md
OPERATIONS.md
PLANS.md
PRODUCT_SPEC.md
README.md
scripts/check.ts
scripts/db/main.ts
scripts/db/verify-concurrency.ts
scripts/ranking/preview.ts
scripts/ranking/review.ts
supabase/functions/_shared/adapters/telegram/protocol.ts
supabase/functions/_shared/adapters/telegram/render.ts
supabase/functions/_shared/application/interaction.ts
supabase/functions/_shared/application/ranking.ts
supabase/functions/_shared/domain/assessment.ts
supabase/functions/_shared/domain/profile.ts
supabase/functions/_shared/infrastructure/supabase/database.types.ts
supabase/functions/_shared/infrastructure/supabase/interactions.ts
supabase/functions/_shared/infrastructure/supabase/repository.ts
supabase/migrations/20261030000400_personalization.sql
supabase/migrations/20261030000500_rerank_supersession.sql
supabase/migrations/20261030000600_assessment_feedback_fence.sql
supabase/migrations/20261030000700_profile_country_catalog.sql
supabase/migrations/20261030000800_profile_normalization_validation.sql
supabase/tests/database/01_contract.sql
supabase/tests/database/04_optimistic_conflicts.sql
supabase/tests/database/10_personalization.sql
tests/contract/ranking_test.ts
tests/fixtures/ranking/golden.json
tests/integration/ranking.ts
tests/integration/telegram.ts
tests/unit/domain_test.ts
tests/unit/ranking_test.ts
```

Final fifteen-migration read-only plan: pending none, no application data, SHA-256 `a70ed92f89f212758951112058f8d9446e7234358a3d3c28182c0aa439e9e8d0`. Final focused ranking receipt: `2026-10-30T09:15:22.393Z`, forty assertions, cleanup true, personal calibration false. All ten receipts match final inputs. Per-run ledger and private synthetic review files are absent.
