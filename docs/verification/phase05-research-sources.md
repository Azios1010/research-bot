# Phase 05 — research positions, internships and funding verification

Completed 2026-10-29. Checkpoints A, B and C and all six type gates passed. Active phase is none; Phase 06 remains pending. No commit, push, deployment, Telegram, Cron, CV processing or LLM work occurred.

## 1. Git baseline

Root `D:/projects/research-bot`, branch/default branch `main`, initial clean worktree, baseline `b09b30388c8ac8e9fa0aec77654f0c3ff638f53c` (`feat(sources): add bounded conference workshop and CFP ingestion`). Origin `https://github.com/Azios1010/research-bot.git` matched this commit. Root/branch/HEAD remained unchanged and staging stayed empty. No parent repository/history modification.

## 2. Sources evaluated

Current official evidence was reviewed for Bath, EURAXESS, Kent, CERN, SmartRecruiters, Inria, Max Planck, CERN openlab, TUM, ETH, Oulu, Grants.gov NSF/NIH and UKRI. [DATA_SOURCES.md](../../DATA_SOURCES.md) separates selected, evaluated/not selected, rejected access paths and unresolved candidates; historical Phase 01 estimates are labeled. Each selected path has current rights, identity, bounds, fixtures and measurements.

## 3. Sources selected

Three adapters are the minimum evaluated set: `bath-research` for research assistant/postdoc, `cern-students` for doctoral research placements/internships, `grants-gov-research` for grants/cooperative research funding. A closed at 11:05Z; B after CERN live/hosted evidence at 13:54Z; C after funding live/hosted evidence at 14:49Z. Implementation respected these sequential gates. Additional conference adapters were not added or refactored.

## 4. Sources/access paths not selected

EURAXESS search returned 403 and no documented permitted public read API was established; employer XML publishing is not a read API. Kent RSS duplicates Bath's pilot purpose. CERN's independently offered RSS was preferred to SmartRecruiters' documented API because the linked SAP API policy restricts extraction/autonomous integration; no ATS API ingestion or private WordPress API bypass occurred. Inria reuse permission remained unresolved; Max Planck added no internship gap closure; openlab's advertised feed returned 404. TUM/ETH/Oulu lacked verified usable bounded feed access. NIH would select an unconfirmed biomedical discipline; UKRI's sampled UK-host constraints added no alignment advantage. These are scoped decisions, not claims that the providers can never be used.

## 5. Rights and access

Bath explicitly offers RSS for updates and permits personal noncommercial prospective-applicant use; its robots allows the selected path. CERN advertises Job offers RSS in official HTML and permits feed/job paths in robots; narrow factual personal syndication was selected, with no open-content redistribution license claimed. Fixtures rewrite factual information rather than copy full protected advertisements. Grants.gov expressly documents unauthenticated read APIs and permits retrieval/analysis/display subject to attribution and accurate representation; its robots endpoint returned 403, so no robots permission was invented. API documentation/terms, not crawling assumptions, justify those two exact read endpoints. No quantitative API quota/SLA was found. [Bath](../sources/bath-jobs.md), [CERN](../sources/cern-students.md), [Grants.gov](../sources/grants-gov.md) contain dated primary links and limitations. Recheck rights before production or redistribution.

## 6. Adapter modules

Source-local `adapter.ts`, `manifest.ts`, `mapping.ts` plus Bath `rss.ts` and Grants.gov `json.ts` were added under `_shared/adapters/sources/`. Shared `rss.ts` supplies bounded XML parsing/plain-text extraction; `retry.ts` interprets bounded Retry-After hints. Registry/composition use the existing worker, pipeline and repository. SourceAdapter, domain model, normalization/identity/reconciliation rules, schema, migrations, RPCs and generated types remain intact.

## 7. Manifest limits

| Slug | Exact reviewed interface | Per-task/per-run bounds |
| --- | --- | --- |
| `bath-research` | Bath `/jobs/rss/rss.aspx?cat=391` | One GET/page/run, 512 KiB, 40 items, 64 KiB/item, 15 seconds, no details |
| `cern-students` | CERN `/jobs/feed/`, exact `paged=2..6`, one fixed `/jobs/short-term-internship/` | Ten items/64 KiB feed, at most one 256 KiB detail/page, shared 15 seconds, six pages/run; conservative twelve requests/run |
| `grants-gov-research` | `api.grants.gov/v1/api/search2` and `/fetchOpportunity` | One page, latest one NSF/ST/research G + one CA; two searches/max two details, 128/256 KiB responses, 4 KiB JSON requests, shared 15 seconds |

Daily cadence is proposed only. No source is persistently enabled/scheduled after cleanup. Endpoints are code-reviewed exact HTTPS URLs, not arbitrary database/source links. Redirects are denied. Funding POST is separately allowlisted and defaults to denied; no second HTTP framework was created.

## 8. Fixture provenance

Bath `research.xml` contains seven rewritten factual items, including current references and historical assistant SS13911. CERN `students.xml`/`internship.html` preserve current STAG facts and manually verified historical Doctoral Student Programme 2027-1; the historical CMS ID/doctoral RSS URL wrapper is explicitly synthetic, not a captured historical feed or a live vacancy. Funding fixtures retain selected public factual fields from actual NSF 363764/20-558 and 363481/26-513; real HHS 364150 is an outside-scope forecast/schema negative fixture. Status/date/repost/malformed variants are labeled synthetic tests. Each directory has an access-date/rights/parser/checksum manifest. Tokens, contacts, full protected adverts and personal documents are absent. Fixture checksum contracts passed.

## 9. Resource measurements

Final offline benchmarks use thirty iterations, pinned Deno 2.9.6, realistic small factual fixtures and explicitly synthetic maximum-sized padding. MB below is decimal process RSS before→after, not a measured allocation peak or deployed Edge measurement.

| Path | Maximum measured input / rows | Parse max | Mapping max | RSS proxy |
| --- | --- | --- | --- | --- |
| Bath | 524,288-byte RSS / 40 | 20.00 ms | 5.58 ms | 63.5→128.8 MB |
| CERN | 65,536-byte RSS + 262,144-byte HTML / ten | 3.36 ms | 2.51 ms | 55.5→70.8 MB |
| Funding | Two 131,072-byte searches + two 262,144-byte details / two calls | 1.32 ms | 2.44 ms | 57.6→60.6 MB |

Actual Bath feed: 220,190 decoded bytes/19 records/one request/run, final combined parse+mapping max 23.20 ms. CERN: 5,684 + 5,729 + 5,666 + 2,091 bytes plus 123,993-byte detail = 143,163 decoded bytes/five requests/run. Funding: 1,736 + 23,577 + 1,600 + 31,767 = 58,680 decoded bytes/four requests/run; public diagnostic collection 3.26 seconds, projection 4,203 bytes, mapping 6.75 ms. The funding fixture-only upper benchmark projection is 3,946 bytes because its documents are deliberately stripped factual selections. No compressed-wire-byte claim; HTTP limits apply to decoded streams. Deployed Edge CPU/memory remains Phase 10 evidence.

## 10. Research-role filtering

Bath requires Education & Research family plus reviewed role title; Research Associate additionally needs explicit postdoctoral/PhD-level evidence. Faculty, clinical, KTP/support and ambiguous-level records have explicit rejection codes. CERN accepts only reviewed doctoral editions and the fixed STAG programme; all other roles are excluded. The word research alone never classifies a job. Deterministic exclusions are durable rejected observations under the existing accepted/rejected accounting model, so expected broad-feed exclusions can produce partial/degraded runs without representing a transport outage.

## 11. PhD mapping

CERN's paid, bounded doctoral research placement contributes to an enrolled doctorate and maps to `phd`. Explicit programme edition is mandatory; generic admissions/scholarship pages are not mapped as jobs. Official 2027-1 closed 16 October 2026 at 23:59 Geneva and is absent from all four current RSS pages. The historical fixture plus approved RSS path proves seasonal coverage; no fake live doctoral opportunity was inserted. Feed-only qualification/location/deadline facts remain unknown.

## 12. Postdoc mapping

Explicit Postdoctoral Research Associate titles, or supported Associate titles with explicit source postdoctoral/doctoral evidence, map to `postdoc`. Not every Research Fellow/Associate qualifies. Current Bath has five accepted postdoctoral roles. Completed-or-nearing and equivalence evidence are preserved separately; absence of equivalence is null, not a false denial.

## 13. Research assistant mapping

Bath's explicit Research Assistant title/family maps to `research_assistant`; the realistic SS13911 fixture closes this gate. It was absent from the inspected current feed after its historical closing date. Missing qualification facts remain unknown. The configured category feed can discover future assistant vacancies without another adapter.

## 14. Internship mapping

STAG 2026 maps to one `research_internship` programme, explicitly covering scientific/technical fields including applied physics/data science/IT and also administrative assignments. Research assignment is not guaranteed and this limitation is retained in attributes. Full-time student, degree alternatives, country-group/exceptions, language and onsite/Geneva evidence are preserved; no personal eligibility inferred.

## 15. Grant mapping

Explicit NSF/ST research category plus legal instrument G maps to `grant`. Live 363764/20-558 is engineering-formation research support with PI restrictions; it is not a generic personally eligible award. One call carrying both G/CA remains one grant with both instruments.

## 16. Other research funding mapping

CA-only research support maps to `research_funding`: live 363481/26-513 AI infrastructure support is a Cooperative Agreement rather than a second copy of a grant. PC/O instruments are excluded pending review. Selected scope is deliberately two latest research calls, not all US grants or all funding programmes.

## 17. Eligibility

Versioned position/funding attributes retain source evidence, applicant categories and bounded eligibility excerpts with truncation flags. Null nationality/residency/qualifications are not negative eligibility. Existing assessment tests prove an explicit profile qualification conflict excludes while unknown evidence stays eligible; no calibration or personal profile was added. Actual interests, nationality, host institution and student status remain unconfigured. Technical source suitability is established; personal fit/notification activation must be reviewed in profile/release phases. No CV inference.

## 18. Dates, status and rolling recruitment

Publication never defaults to fetch time. Bath's labeled closing date remains date-only; CERN's explicitly stated Geneva cutoff becomes `2026-11-01T22:59:00Z`, with Europe/Zurich evidence, while RSS publication remains 2025-10-21 independently of STAG 2026. Grants.gov zero-time date strings remain calendar dates: closing date-only/zone null, publication date in attributes and published_at null. Rolling, missing/TBD and invalid values have distinct tested handling. Posted/closed/archived/forecast/unknown source states are retained. A new forecast has unknown coarse lifecycle and an estimated label, not open. Existing reconciliation preserves stronger known lifecycle on later unknown evidence; future acceptance/notification projections must inspect latest explicit forecast attributes even if the coarse lifecycle retains an earlier open fact. No lifecycle enum/schema redesign was introduced.

## 19. Reposts and source identity

Bath reference is the stable key/cycle; a changed deadline preserves identity, a new reference is a distinct hiring cycle. CERN uses explicit STAG reference or doctoral edition, not publication time or mutable deadline; reused internship homepage with a new reference stays separate. Raw CMS IDs remain provenance, not sole STAG cycle identity. Stable semantic `application` round keys survive changed dates. None of these source keys uses array position.

## 20. Employer/aggregator deduplication

Sanitized overlap fixtures prove reviewed compatible listing identity merges and reviewed employer field authority wins. Equal weak fingerprints with multiple candidate jobs remain separate/flagged; cycle conflict is not merged. Authority numbers are explicit test configuration, not a real-source global priority list. No fuzzy/semantic/LLM matching. Existing hosted identity-convergence/concurrent-claim tests passed unchanged.

## 21. Funding-cycle identity

Portal ID + opportunity number identify the call. New portal ID with reused programme number/funder homepage persists a distinct cycle. Amended deadline/document version/revision is evidence, not identity. A continuing multi-year announcement stays one announcement; no annual subcalls are manufactured from a date. Hosted tests also prove a single mixed-instrument call returned by both queries has one observation/disposition and no double counters.

## 22. Six-type coverage

| Type | Realistic fixture | Approved live path | Current live example / seasonal evidence |
| --- | --- | --- | --- |
| `phd` | CERN Doctoral Student Programme 2027-1 facts with declared synthetic RSS wrapper | `cern-students` doctoral edition classification | Absent after official 16 October closure; four-page feed inspected |
| `postdoc` | Bath SS14039/SS13981 and realistic qualification variants | `bath-research` category 391 | Five actual roles, including SS14039 |
| `research_assistant` | Bath SS13911 historical factual advert | Same Bath feed | Absent from current 19 items; no fake live assistant |
| `research_internship` | Actual STAG 2026 factual detail/RSS structure | `cern-students` + one fixed detail | STAG 2026, closes 1 November; mixed assignment scope retained |
| `grant` | Actual 363764/20-558 G response fields | `grants-gov-research` G query/detail | PFE: RIEF, closes 10 November 2026 |
| `research_funding` | Actual 363481/26-513 CA response fields | Same funding adapter's CA query/detail | AI Infrastructure Hubs, closes 4 November 2026 |

All six paths/fixture gates pass. Coverage is narrow by institution, programme, discipline and geography; it is not broad discovery or personally eligible coverage.

## 23. Live smoke results

All ran only against verified isolated hosted development `ihxoffjtrtyxgctcfgmy` and cleaned afterward:

| Source | Final UTC receipt | Assertions | First-run durable result |
| --- | --- | --- | --- |
| Bath | 2026-10-29 14:51:18.546Z | 7 | 19 observations: five canonicals/five deadlines + 14 explicit exclusions |
| CERN | 2026-10-29 14:49:06.053Z | 7 | 32 observations/four pages: one canonical/deadline + 31 exclusions |
| Funding | 2026-10-29 14:49:57.941Z | 9 | Two observations/two distinct canonicals/two date-only deadlines |

Each new-run replay inserted zero; completed-task replay made no upstream IO. Total successful first runs: 53 observations, eight real opportunities/eight deadlines, 45 explicit exclusions. Two final-validation Bath invocations initially hit the unchanged 15-second transport timeout (one after successful first persistence); both cleaned up and failed visibly. A final bounded invocation after the independent CERN/funding checks passed both public reads. No timeout/limit was increased or converted into empty success; no uncontrolled retry loop. This observed intermittency remains an operational risk.

## 24. Hosted integration

PostgreSQL 17.11, Deno 2.9.6 and Supabase CLI 2.122.0; scoped read-only Management token and verified session-pooler TLS. No local database/Docker. RTK executable was unavailable: commands used a disclosed process-local transparent passthrough, not claimed RTK filtering. Target inventory showed no unrelated/valuable/application data, radar unexposed, seven immutable migrations and no pending plan. Plan hash `eb8d3e7aa666b2b2d259461230a85aadcb7b325fdf031485987fa9ae8aee822a`.

`db:verify` at 14:30Z passed 100 SQL assertions, ten query plans, real concurrent clients, restrictive grants/RLS, rollback/cleanup and actual hosted type regeneration. Schema fingerprint remains `f64c621637966fe7e60ae486662f6eb6cbff5e21f99687de29545410a968e7d1`; generated types unchanged.

Full `test:integration` passed **99 named application assertions**: Phase 03 24; SIGMOD 13; HotOS/OpenReview 15; Bath 12; CERN 10; funding 14; three-family isolation 11. This includes actual Supabase-js RPC persistence, observation provenance, page counters/cursor commits, amended deadlines, distinct cycles, quarantined siblings, replay, stale fences, concurrent identity/task claims and controlled transaction rollback/retry. Initial harness mistakes (delay zero and a bigint-string comparison) were corrected to the existing contracts and rerun; no schema workaround was made.

Nine source integration/smoke success receipts bind final source-input hash `c611b8552f6a807a2f11618e1038bd5aecdf05fa5fb06f803ea0b29769c7db20`; all match target class/development ref and cleanup. Phase 03 has its own narrower input-hash recipe and internally checks it. Receipts are ignored private operator evidence; this tracked report contains sanitized results only.

## 25. Failure isolation

Actual Bath, CCFDDL and funding adapters with injected fixture transport ran through real hosted RPCs. Each family was failed with 503 in turn: zero committed pages/records on that failed run, explicit retryable transport failure, and both other families still persisted successfully. Bounded detail failure committed the valid doctoral/funding sibling plus durable rejection, with no invalid partial canonical state. Invalid XML/JSON, schema drift, individual malformed records, content type, oversized input, timeout, redirects, unsafe/default-denied POST and valid empty results have independent deterministic tests. Only Bath uses conditional validators; an unsolicited/invalid 304 is refused.

## 26. Disable behavior

Hosted checks disable a claimed source before collection: canceled fenced work, no deletion of existing canonicals/identities or failure-health penalty. Healthy conference/funding sources still commit. Re-enable rediscovers the same keys and canonical IDs; no duplicate opportunities. No production admin endpoint/tool was introduced.

## 27. Manual official-source comparison

Bath official SS14039 and SS13981 pages agree with RSS reference/title/deadline and qualification evidence. Publication was not independently visible on inspected detail pages, so only RSS pubDate evidence is claimed. Missing location/remote evidence was not replaced with the employer address. CERN's official STAG detail agrees on reference, Geneva/onsite, student/country/language rules and cutoff; archived official doctoral 2027-1 confirms the seasonal absence. Manual ATS-page inspection was not API ingestion.

NSF [20-558](https://www.nsf.gov/funding/opportunities/pfe-rief-pfe-research-initiation-engineering-formation/nsf20-558/solicitation) agrees on research grant/engineering PI conditions; [26-513](https://www.nsf.gov/funding/opportunities/us-national-science-foundation-state-regional-artificial/nsf26-513/solicitation) agrees on cooperative agreement/US institution conditions. The [RIEF page](https://www.nsf.gov/funding/opportunities/pfe-rief-pfe-research-initiation-engineering-formation) and [AI Hubs page](https://www.nsf.gov/funding/opportunities/us-national-science-foundation-state-regional-artificial) match the portal calendar deadlines. Official pages supply 17:00 submitting-organisation local time, greater precision than the API; runtime intentionally preserves portal date-only evidence. No sampled calendar-date disagreement or unverified extra personal-eligibility claim. Official links were compared manually; no general detail crawler.

## 28. Deterministic validation and exact commands

All commands used the repository-pinned wrapper `npx.cmd --yes --package deno@2.9.6 --package supabase@2.122.0 deno task <task>`:

| Task | Result |
| --- | --- |
| `check` | Format/lint/type checks, five DB guards, 73 unit, 25 contract tests, credential/document checks passed |
| `test:unit` | 73 passed, no network/environment access; invoked explicitly by `check` |
| `test:contract` | 25 passed, offline fixtures/checksums; invoked explicitly by `check` |
| `db:plan` | Read-only, exact seven migrations, pending none |
| `db:verify` | 100 SQL assertions, ten plans, real concurrency, cleanup, generated actual types |
| `test:positions` | Focused earlier Bath/CERN fixtures passed; final full suite repeats them |
| `test:funding` | Fourteen funding + eleven isolation assertions passed; final full suite repeats them |
| `test:integration` | 99 named application assertions passed; cleaned |
| `sources:smoke --source bath-research` | Final pass, seven assertions; two earlier bounded timeout failures recorded above |
| `sources:smoke --source cern-students` | Pass, seven assertions |
| `sources:smoke --source grants-gov-research` | Pass, nine assertions |
| `sources:jobs-benchmark` | Offline realistic/maximum RSS+HTML passed |
| `sources:funding-benchmark` | Offline realistic/maximum JSON passed |
| `secrets:scan` | Git-scoped tracked/untracked nonignored files passed; no values printed |

Independent `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-docs.ps1`, `git diff --check`, final Git/staging review and current receipt/hash audit passed. No required hosted/live check was replaced by mocks. No production deployment claim.

## 29. Cleanup

Every successful/failed hosted invocation removed only its test-owned sources, records, identities, canonicals, deadlines, tasks/runs/profile/notification fixtures and restored pause state. Final inventory: no application data, no enabled source/profile/schedule, seven migration/reference state entries preserved. No reset/truncate or production target. Runtime data was persisted for verification, not retained as a seeded production corpus.

## 30. Files changed

Nineteen existing files updated: `ARCHITECTURE.md`, `DATABASE.md`, `DATA_SOURCES.md`, `OPERATIONS.md`, `PLANS.md`, `PRODUCT_SPEC.md`, `README.md`, `CHANGELOG.md`, `harness/build/05-research-job-sources.md`, `docs/TESTING.md`, `deno.json`, `deno.lock`, `scripts/db/main.ts`, `scripts/sources/evidence.ts`, `_shared/adapters/sources/registry.ts`, `_shared/application/ports.ts`, `_shared/infrastructure/http/bounded.ts`, `job-worker/index.ts`, `tests/contract/conference_coverage_test.ts`. The `_shared`/worker paths are under `supabase/functions/`.

Forty-five new files, grouped by directory (braces list exact filenames):

```text
docs/adr/0011-bounded-read-only-json-post.md
docs/sources/{bath-jobs,cern-students,grants-gov}.md
docs/verification/phase05-research-sources.md
scripts/sources/{jobs-benchmark,funding-benchmark}.ts
supabase/functions/_shared/adapters/sources/bath/{adapter,manifest,mapping,rss}.ts
supabase/functions/_shared/adapters/sources/cern/{adapter,manifest,mapping}.ts
supabase/functions/_shared/adapters/sources/grantsgov/{adapter,manifest,mapping,json}.ts
supabase/functions/_shared/adapters/sources/shared/{rss,retry}.ts
tests/contract/{bath,cern,grants}_test.ts
tests/unit/{bath,cern,grants,position_identity,read_post}_test.ts
tests/integration/{positions,cern,funding,source_session,source_isolation}.ts
tests/grants_support.ts
tests/fixtures/bath/{research.xml,manifest.json}
tests/fixtures/cern/{students.xml,internship.html,manifest.json}
tests/fixtures/grantsgov/{search-G.json,search-CA.json,detail-G.json,detail-CA.json,forecast-outside-scope.json,manifest.json}
```

No migration, generated type, credential file, conference parser or domain rule file changed. No files staged.

## 31. Documentation

Updated current source register/coverage and primary permission evidence, source resource/manual notes, architecture/HTTP boundary, versioned JSONB projections, product mapping, operations, testing tasks, phase specification, roadmap/readiness, README status/Grants.gov attribution and changelog. ADR 0011 records the only material transport extension. Historical ADRs/reports remain intact; intermediate Phase 05 work notes were consolidated here.

## 32. Deviations and assumptions

GET/HEAD-only transport could not call the official funding read APIs. [ADR 0011](../adr/0011-bounded-read-only-json-post.md) adds exact-URL, default-denied, bounded JSON POST; all existing safety controls and SourceAdapter/domain/DB contracts remain. Shared XML extraction supports the second RSS adapter without a new pipeline. Product/JSONB documentation makes paid doctoral placements and cooperative research funding concrete. Actual researcher preferences/host eligibility were unavailable; source choice is a disclosed nonpersonal technical verification subset, consistent with the Phase 05 entry checklist. The older open question about personal source fit is clarified as distinct from this completed technical/type coverage gate; personal delivery suitability remains a profile/release requirement. No actual profile or eligibility was fabricated.

## 33. Remaining risks

Bath had real transient timeouts and broad-feed exclusions; no uptime guarantee. CERN paginated RSS can shift and has seasonal gaps, minimal doctoral details and mixed internship assignments. Funding selects only two latest NSF research calls, may be institution/geography mismatched for the researcher, has unknown quotas/SLA and no verified robots directives. Calendar dates retain timezone uncertainty. Forecast/source-state display must honor explicit latest attributes. Feed advertisement copyrights are retained. Actual DNS pinning, deployed Edge performance, unattended reliability, production plan/backups/restore and current rights/user fit remain explicit later gates. No unresolved Phase 05 exit blocker remains after the final successful smokes and cleanup.

## 34. Exact readiness checklist for Phase 06

1. Review Phase 05 diff, this report, manifests/fixtures and ADR 0011; create a committed clean baseline only under separate user commit authorization.
2. Obtain explicit Phase 06 activation; verify root/main/status/HEAD and read AGENTS, PLANS, full 06 specification, source/domain/database/testing/workflow contracts and relevant ADRs. Do not activate it as part of Phase 05.
3. Reverify isolated hosted identity, TLS/auth, empty/valueless inventory, seven immutable migrations, exact schema/type/verification receipt and cleanup before writes.
4. Confirm journal/topic scope or disclose a nonpersonal technical subset; do not infer personal discipline/eligibility.
5. Re-evaluate a minimal publisher/feed path's current terms/robots/reuse, stable IDs, size/resources and actual open-call semantics. Close both journal CFP and special-issue gates with realistic fixtures and real permitted hosted/live evidence.
6. Preserve shared pipeline/model/RPCs, JSONB/provenance/temporal uncertainty and source attribution. No Telegram, Cron, LLM, ranking calibration, CV processing or production deployment in Phase 06.

## 35. Recommended commit message

`feat(sources): add bounded research position internship and funding ingestion`

Recommendation only; nothing was committed or pushed. Stop before Phase 06.
