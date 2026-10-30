# Phase 06 journal sources — verification and handoff

2026-10-29/30. Phase 06 is complete: both type/rights/resource gates, deterministic checks, required hosted/live evidence and cleanup passed on final inputs. Active phase is none; Phase 07 remains pending. This report describes actual implemented behavior. No commit, push, deployment, webhook, Cron or notification was performed.

## 1. Git baseline

Clean entry: root `D:/projects/research-bot`, branch/default `main`, HEAD `6a55530dd9c33bd6d133dc965eab63330a14317a` (`feat(sources): add bounded research position internship and funding ingestion`). Origin `https://github.com/Azios1010/research-bot.git`; read-only remote main matched this SHA. No parent Git metadata/history was changed or files staged. RTK executable was unavailable; documented process-local transparent passthrough was used without claiming filtering.

## 2. Sources evaluated

Current official Springer Link/Nature, Elsevier/ScienceDirect and MDPI options were investigated first. Additional official journal candidates JEACS, Journal of Privacy and Confidentiality (JPC) and Open Research Software were evaluated only to find a permitted server-readable path. [Source register](../../DATA_SOURCES.md) records owners, URLs, formats, IDs, rendering/bounds, rights/auth, suitability and selection state. No public readability was treated as an unrestricted automation license.

## 3. Source selected

One source family, `jeacs-journal-calls`: Journal of the European Association for Chinese Studies, published by EACS and hosted by University of Vienna. The disclosed technical subset is Sinophone humanities/social sciences; no researcher interest, eligibility or journal quality was inferred. A second live source was unnecessary for the two semantic type gates.

## 4. Rejected and unresolved candidates

Springer Link terms restrict automated systematic extraction/indexing including metadata; some robots allowances cannot override those terms. Nature redirected to an identity service. Elsevier terms restrict systematic retrieval; ScienceDirect generic robots disallow and the calls path redirected to SSO / research-browser 403. Neither was enabled. MDPI robots/terms attempts returned 403/429; rights/access remain unresolved and disabled. No session/private API, challenge bypass or browser automation was attempted. JPC's RSS/standing CFP did not close a remaining gap and conference issues had restricted submission; not selected. Open Research Software announcements timed out; unapproved. See [dated evidence](../sources/jeacs-journals.md).

## 5. Current rights/access conclusion

JEACS's [official policy](https://journals.univie.ac.at/index.php/jeacs/about), announcement notice and footer provide CC BY 4.0 content/distribution evidence. [Robots](https://journals.univie.ac.at/robots.txt) does not disallow these paths for generic agents. Approved scope: bounded public factual reads and attributed, rewritten fixtures with original links, license and change notice; no full article/website mirror. No login, API key, numerical quota or SLA is required/verified. This is scoped evidence reviewed on 2026-10-29, not blanket permission for the entire platform. Re-review before production/widening scope.

## 6. Ingestion path

Exact public HTTPS GETs: [announcements](https://journals.univie.ac.at/index.php/jeacs/announcement), [about/policy](https://journals.univie.ac.at/index.php/jeacs/about), and at most fixed [detail 230](https://journals.univie.ac.at/index.php/jeacs/announcement/view/230) if present. No arbitrary linked detail navigation or undocumented API. Server HTML contains the required call facts; no rendering service is needed. No pagination or conditional/304 shortcut is configured. Publisher HTML has no release/repository revision; runtime framed-content SHA-256 and access date identify the observed snapshot instead.

## 7. Adapter modules

`_shared/adapters/sources/jeacs/{manifest,html,mapping,adapter}.ts`: reviewed limits/rights, bounded inert HTML extraction, source-local author-call/dates/metadata mapping, and transport/pure parser separation. Registered in the existing reviewed source/URL registry. Existing normalization, identity/reconciliation, Supabase-js RPC persistence and fenced page commit remain the only application path. No journal-specific branch was added to domain code.

## 8. Manifest limits

One page/run/task; at most 32 cards, two fixed GETs plus one fixed detail; shared 15-second collection timeout. Directory 128 KiB, policy 64 KiB, detail 128 KiB, framed page 512 KiB; aggregate decoded documents at most 320 KiB. HTML preflight: 4,096 tokens, then 8,192 nodes / depth 64; card text 24 KiB. Approved exact host/paths, no redirects. No internal unbounded retry, dynamic detail discovery or schedules. Daily cadence is proposed only. Shared application page/proposal/observation limits still apply.

## 9. Fixture provenance

Minimal HTML transcriptions/rewritten factual projections from official announcements 230, 224, 190/174, 195/175, 234 and policy; separate official details 230/174. `tests/fixtures/jeacs/NOTICE.txt` credits EACS/journal, CC BY 4.0, original URLs and transformations. `manifest.json` pins parser/access and LF-normalized canonical-string SHA-256 checksums. No full article, author email or tracked contact link is copied. Tests explicitly mutate dates/windows/markup/status for negative scenarios; these are never presented as live records. No versioned upstream release exists to pin.

## 10. Resource measurements

Thirty-iteration local samples (decoded UTF-8; compressed wire bytes not measured):

| Input | Directory / policy / detail bytes | Logical records / accepted | Parser max ms | Mapper max ms | Full max / mean ms | Sampled process RSS / heap bytes |
| --- | --- | --- | --- | --- | --- | --- |
| Captured real source | 49,674 / 16,778 / 15,234 = 81,686 | 15 / 5 from 17 cards | 64.33 | 32.43 | 30.89 / 18.63 | 101,003,264 / 20,284,624 |
| Rewritten fixture | 4,154 / 410 / 1,048 = 5,612 | 5 / 3 | 29.53 | 30.83 | 8.43 / 2.75 | 57,835,520 / 9,123,232 |
| Synthetic maximum | 131,072 / 65,536 / 131,072 = 327,680 | 32 / 32 | 50.06 | 5.67 | 41.18 / 24.67 | 125,538,304 / 37,017,120 |

The maximum is labeled synthetic, includes fixed detail 230 among 32 cards, and is 328,400 bytes framed. Parser/mapper startup precedes full-path timing, so maxima are not additive. Measurements are local sampled memory proxies, not hosted Edge peaks; Phase 10 owns deployed resource verification. `sources:journals-benchmark` is offline/cached-only. Real capture at `2026-10-29T16:02:48.365Z` has framed revision `dc9500e1e95e7037ebf4e84c665430fea0a9bb2a86759052a0982a17e0ab2558`.

## 11. Journal CFP mapping

Explicit unthemed regular-issue author manuscript call → `journal_cfp`. Real issue 6.2 (2025) original 174 and reminder 190 share one source identity. Its 2025-07-15 deadline is past; retain closed history, never fabricate current acceptance. Historical fixtures prove the real open window. Standing generic policy and rolling peer-review acceptances do not create/reopen an issue call.

## 12. Special-issue mapping

Explicit thematic issue plus author submission evidence → one `journal_special_issue`. Its directory and author CFP are representations of the same opportunity. Call 230 maps theme/year, guest editors, abstract/decision/manuscript rounds and explicit manuscript guidance. Calls 216/215 and old Ink 175/195 use the same source-local policy. No duplicate CFP row is created to inflate type coverage.

## 13. Call versus published collection

Published-volume/collection notices, general journal pages and dissertation lists are explicitly excluded. The live directory contains six publication notices and two dissertation solicitations; none is a fresh author opportunity. Old call 139 has insufficient current acceptance evidence and is quarantined rather than guessed open/closed. An ambiguous anniversary call is also quarantined. Visible published articles alone do not close a genuinely active author call.

## 14. Proposal versus author call

Invitations for guest-editor/issue proposals are excluded with deterministic reason codes; author manuscript intent and a supported call kind are required. The journal's general special-section proposal policy is not emitted as an author CFP. Tests cover proposal, generic and malformed structures with valid siblings.

## 15. Deadline behavior

Calendar dates retain null instant/timezone. Explicit clock/offset evidence uses shared temporal normalization; uncertain zones remain evidence, not false precision. Abstract, decision and manuscript rounds use stable semantic keys. Opening/window/rolling/TBD states remain explicit. Deadline amendments preserve canonical, cycle, source key and round ID, incrementing meaningful content/deadline revisions. No mutable deadline enters identity.

## 16. Lifecycle

Explicit closed/withdrawn override future dates; historical expiry maps closed. Upcoming opening windows map unknown coarse lifecycle plus source state/window, not open. Undated calls need explicit current acceptance or rolling evidence. Unknown fields do not imply exclusion or a personal eligibility claim. Call 215's manuscript stage remains conditional on its prior abstract requirement; later UI/delivery must expose that prerequisite rather than promise unrestricted new submission.

## 17. Directory/detail deduplication

Pure and actual hosted tests use one primary directory source and a second sanitized official-detail observation. Reviewed call URL with journal/announcement/year cycle identity merges one canonical; both source observations/provenance survive. Reviewed reminders 190→174 and 195→175 are grouped before durable page accounting. Cleanup owns both merged fixture sources together; it does not delete a shared canonical from nested independent scopes.

## 18. Recurring cycle identity

Journal namespace + canonical announcement ID + explicit year qualify cycle identity; optional issue number is metadata so later refinement does not rewrite identity. Distinct themes, journals and recurring years remain separate; fingerprints are candidates, not unique keys. Hosted recurrence fixture changes call ID/year with reused theme and creates a new canonical while preserving the original.

## 19. Conflict handling

Directory/detail equal-authority date disagreement retains two bounded observation evidence values and one conflicted round. Existing known candidate date/provenance may remain for inspection but must not be used precisely while conflicted. Cross-source disagreement also marks the shared round conflicted. Explicit reviewed per-field authority resolves through the existing generic policy.

A regression exposed an existing core bug: incoming intrinsic conflict has unknown precision and was incorrectly treated as missing evidence when a known round existed. The failing unit test was reproduced before the fix. The source-neutral correction marks the prior round conflicted for equal/stronger incoming authority while retaining its candidate/provenance; strictly stronger prior reviewed facts remain usable. Hosted tests prove conflict persistence and resolution. No schema or source-specific domain branch was introduced. An earlier hosted assertion also incorrectly changed the current provenance-owning source and expected a cross-source conflict; the test was corrected to actually alternate sources. Its cleanup passed before rerun.

## 20. Metadata captured

Bounded journal name/publisher/ISSN/journal URL; issue/theme/explicit edition/year; guest-editor names without emails; scope/topics; original call; publication calendar evidence; submission opening; abstract prerequisite; article/language/word-length/solicited-review restrictions; explicit all-career-stage/subject eligibility where supplied; fees amount/currency/conditions/evidence URL. Missing facts stay null/unknown. Fees are informational and policy is fetched every run; contradictory explicit fee evidence quarantines the call. No journal ranking/reputation or personal eligibility model was added.

## 21. Two-type coverage matrix

| Type | Realistic fixture | Approved live path | Current live example | Limits |
| --- | --- | --- | --- | --- |
| `journal_cfp` | 174/190 unthemed 6.2 (2025), historical open/current closed | Reviewed JEACS announcements parser | Real closed call remains listed; no currently open unthemed issue call observed | Seasonal current-open absence disclosed; no fake call, generic policy or duplicated SI |
| `journal_special_issue` | 230 open and 175/195 expired; negative published collections | Same listing plus fixed 230 detail | 230, 216, 215 have future manuscript deadlines | One journal/discipline; 215 has prior abstract prerequisite |

No second live source is required. Both types have an approved configured path and realistic fixtures; at least one type has real currently accepting calls. Personal topic fit remains unconfigured.

## 22. Live smoke result

`deno task sources:smoke --source jeacs-journal-calls` passed nine named assertions on 2026-10-29T16:55:04.656Z. The success receipt was recovered after an intentional turn interruption and rechecked against final code; 2026-10-30 read-only inventory independently confirms cleanup. Actual result: five genuine canonicals / ten deadlines, fifteen logical dispositions from seventeen raw cards; accepted 5 + rejected 10 = seen 15, one committed partial page. Three open special issues, one closed special issue and one closed standalone CFP. Same-task replay performs no upstream IO, fresh-run replay creates no duplicate/revision effects, and no notification was created. Six bounded GETs for collection/replay, followed by scoped cleanup. Receipt `private/phase06-journals-smoke.json` binds source input hash `2800b93f67feb34587ee664500149b10ec639194f88aed96c3d533fc317867a1`.

## 23. Hosted integration and SQL verification

Verified isolated development target `research-bot`, ref `ihxoffjtrtyxgctcfgmy`, PostgreSQL 17.11. Identity/auth/TLS/valueless inventory/history/schema/receipt checks and exclusive verification lock gate writes. No production/unrelated/auth/storage/Vault/Cron data was used. `db:plan` passed read-only with no pending changes, plan hash `eb8d3e7aa666b2b2d259461230a85aadcb7b325fdf031485987fa9ae8aee822a`. `db:verify` passed 100 SQL assertions, ten plans, real concurrent clients, no-op reapply of seven immutable migrations, cleanup and actual generated types (no type diff). Private schema/grants/RLS unchanged.

Final `test:integration` passed 125 named application assertions on 2026-10-30, with cleanup and final zero-application-data inventory. Breakdown: core 24, SIGMOD 13, conference coverage 15, Bath 12, CERN 10, funding 14, journals 19, four-family isolation 18. Actual concurrency, fences and late rollback/retry are included in the core suite. Journal fixture counts are three canonicals/five deadlines, five logical dispositions (three accepted/two rejected) from seven cards. Hosted suites exercise actual Supabase-js RPCs, not mock persistence; SQL is test setup/assertion/cleanup only.

All final source-suite receipts match `2800b93f67feb34587ee664500149b10ec639194f88aed96c3d533fc317867a1`; the core suite uses its separate documented TS/JSON/SQL hash `6bd7b4020e46b9bd1a2f1dd5baeb2b412b1482692253f27669f4fcdbc26ba915`. Journal receipt: 2026-10-30T02:22:35.575Z; isolation receipt: 2026-10-30T02:24:15.359Z. The private read-only audit verified all eight application-suite receipts and the nine-assertion live receipt using their actual hash algorithms. Source HTML/XML/YAML/NOTICE files are included in the source-suite hash. Receipts remain ignored under `private/`, with no credentials stored in the tracked report.

## 24. Replay

Actual RPC tests passed same-task replay with zero upstream HTTP/extra completion, new-run replay with no duplicate canonical/source record or revision changes, and changed deadline with same canonical/round ID plus revision increment. Final nine-assertion live replay also passed on the final source hash. No exactly-once delivery claim is made; no notification was sent.

## 25. Failure isolation

Four-family hosted fixture matrix passed: each conference/position/funding/journal transport failure leaves all three other families usable and its own cursor unadvanced. Journals also passed valid/malformed/valid durable accounting, bounded detail failure with valid sibling, disable/re-enable retaining identity/health, and shared-canonical cleanup. Offline cases include timeout/oversize/content type, malformed framing/HTML, whole listing/policy drift, fixed-detail drift/removal, stale directory, unsafe URL, script/DTD/depth/token limits and explicit empty-valid marker. No 304 is requested/accepted as success.

## 26. Manual official-page verification

2026-10-29: compared directory and official 230 detail to theme/8.2 (2027), three guest editors, abstract 2027-02-28, decision 2027-03-31, manuscript 2027-07-15, English/max 8,000 words, prerequisite and lack of clock/zone. Original 174/reminder 190 agree on 6.2 (2025), 2025-07-15, unthemed author articles and solicited-only reviews; rolling acceptances do not reopen it. Policy confirms EACS publisher versus Vienna host, ISSN and no submission/publication fees. No observed date disagreement in the sampled official pages; deliberate conflict cases are fixture mutations. Final live assertions and receipt inspection matched those persisted facts. All five final factual snapshots omit contacts/full HTML; 174's topics are empty because review/contact bullets are not taxonomy. Only explicitly introduced source topic lists supply tags.

## 27. Validation commands and results

Pinned Deno 2.9.6 / TypeScript 6.0.3, Supabase CLI 2.122.0, Supabase-js 2.118.0; pure parser parse5 8.0.0 with exact lockfile. npm-cache wrapper on this host: `npx.cmd --yes --package deno@2.9.6 --package supabase@2.122.0 deno task <task>`. Local credentials remain in ignored environment/target files and are never printed.

| Command | Result |
| --- | --- |
| `deno task check` | Passed final format/lint/types/boundaries, five guards, 86 unit/31 contract, documentation and credentials |
| `deno task test:unit` | Standalone final command passed: 86 tests |
| `deno task test:contract` | Standalone final command passed: 31 tests |
| `deno task db:plan` | Passed read-only, zero application data and zero pending migrations |
| `deno task db:verify` | Passed 100 SQL/ten plans/concurrency/cleanup/types |
| `deno task test:journals` | Earlier focused diagnostic passed; final journal 19 + isolation 18 assertions passed again in full integration |
| `deno task test:integration` | Passed: 125 application assertions, matching receipts, concurrent clients/rollback/fences and cleanup |
| `deno task sources:smoke --source jeacs-journal-calls` | Passed: nine assertions, 5 real canonicals/10 deadlines, replay and cleanup |
| `deno task sources:journals-benchmark` | Passed small and synthetic maximum; measurements above |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-docs.ps1` | Passed: 45 Markdown documents, ten phase/status contracts, links, ADRs, fences and whitespace |
| `deno task secrets:scan` | Passed through check and final standalone command: 181 files, no matching credentials printed |
| `git diff --check` | Passed; staging empty, only intended Phase 06 files modified/added |

Earlier failures were diagnostic and fixed, not omitted passing gates: absent fixture manifest, unused import lint, wrong cross-source test setup and reproduced missing-versus-conflict regression. The first live smoke caught a review/contact bullet incorrectly included as a topic; cleanup passed, extraction was restricted to explicitly introduced topic lists, and a pure regression plus the repeated nine-assertion live smoke passed. No unsafe remote reset, unscoped deletion or permission expansion was used.

## 28. Cleanup

Every completed SQL/focused hosted run cleaned UUID-owned sources/observations/canonicals/deadlines/identities/runs/tasks and restored collection pause. Failed diagnostic assertion cleanup also passed. Final integration and live receipts plus 2026-10-30 inventory confirm no application data, the same seven migrations and preserved reference state. Live cleanup removed all 15 observations, five canonicals, ten deadlines and owned run/task/identity state after replay; no notification/profile was created. No production data or migration/reference state was deleted. Never bypass the inventory guard if an interrupted run leaves rows.

## 29. Files changed

Implementation/tooling/tests:

```text
deno.json / deno.lock
scripts/db/main.ts
scripts/sources/evidence.ts
scripts/sources/journals-benchmark.ts
supabase/functions/_shared/adapters/sources/registry.ts
supabase/functions/_shared/adapters/sources/jeacs/{adapter,html,mapping,manifest}.ts
supabase/functions/_shared/domain/reconcile.ts
tests/jeacs_support.ts
tests/{unit,contract}/jeacs_test.ts
tests/unit/domain_test.ts
tests/integration/{journals,source_isolation}.ts
tests/fixtures/jeacs/{directory,policy,detail-230,detail-174}.html
tests/fixtures/jeacs/{manifest.json,NOTICE.txt}
```

36 reviewable files changed: 19 modified and 17 new, including the documentation below. No migration, RPC, Supabase configuration, generated type content, worker/application interface or existing conference/job/funding adapter changed. Private diagnostics/receipts/captures are ignored and not deliverables or credentials in Git. Staging remains empty.

## 30. Documentation updated

Updated `README.md`, `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `DATABASE.md`, `DATA_SOURCES.md`, `OPERATIONS.md`, `PLANS.md`, `CHANGELOG.md`, `docs/TESTING.md`, `docs/DATABASE_WORKFLOW.md`, `harness/build/06-journal-cfp-sources.md`, `docs/sources/jeacs-journals.md` and this report. They record source rights/coverage, current behavior, resources/manual evidence, the shared correction, exact checks and readiness. Roadmap/completion was updated after all required checks passed. Historical ADRs/reports remain unchanged; no material architectural decision needed a new ADR.

## 31. Architecture deviations

No platform, schema, model, SourceAdapter, RPC, HTTP contract or pipeline redesign. A pinned inert HTML parser is an adapter dependency. The only shared logic change is the proved intrinsic-conflict reconciliation correction in section 19, needed to implement the already documented conflict invariant. It applies to all sources and preserves reviewed authority. Upcoming/source-state/fee/eligibility metadata concretizes existing JSONB extensibility. One-journal humanities technical scope is an explicit assumption while personal preferences remain unavailable.

## 32. Unresolved risks

One journal and discipline; currently no open unthemed regular-issue CFP. Listings/HTML/current terms may change; no numerical rate limit, freshness/SLA or completeness guarantee. Fixed detail enrichment covers 230 only; other records use directory evidence and cannot be claimed independently reconciled with arbitrary detail pages. Abstract prerequisites can restrict later manuscript stages. Dates often lack timezone; no precise reminder instant is invented. Local memory/timing is not a deployed Edge benchmark. Personal relevance, deployed DNS/runtime protection, production plan/backups/restore, unattended reliability and source-rights re-review remain later gates. No Phase 06 exit blocker remains after final repository documentation/credential closeout.

## 33. Exact readiness checklist for Phase 07

1. Confirm Phase 06 complete, active phase none and 07 pending; review the passing checks, matching hosted/live receipts, manual comparison and empty-data/pause-restored cleanup in this report.
2. Review Phase 06 diff and this report, source limitations, manifest/fixtures and the conflict regression. Create a clean committed baseline only under separate explicit commit authorization.
3. Obtain explicit Phase 07 activation; re-read AGENTS/PLANS/full 07 spec and current product/architecture/database/testing/workflow/ADRs/generated types. Recheck root/main/status/HEAD; do not assume phase completion authorizes its successor.
4. Reverify isolated hosted identity/auth/TLS/empty inventory, seven immutable migrations/schema/type/receipt and scoped cleanup before writes; no production target or local fallback.
5. Use a supplied single-user profile/Telegram ID configuration or clearly labeled synthetic test profile. Do not infer topic/country/eligibility/timezone/chat binding or introduce real credentials in Git.
6. Implement only authorized Phase 07 UI/auth/inbox/action/reply use cases using mocked Bot API for deterministic checks; assess existing narrow RPC/query boundaries first. Preserve source-neutral domain and fixture pipelines.
7. Require webhook secret, lossless IDs, allowlist/private-chat binding, callback authorization, dedupe and durable attempts including uncertain sends. Render source attribution, lifecycle, date-only/unknown/conflicted deadlines and abstract/eligibility restrictions honestly. No Cron, real webhook registration, live bot sends, ranking calibration or production deployment without their owning phase/authorization.

## 34. Recommended commit message

`feat(sources): add bounded journal author-call ingestion`

Recommendation only. No commit, push or Phase 07 activation in this task.
