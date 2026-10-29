# Phase 05 — Research positions, internships and funding sources

## Goal

Add relevant, evaluated sources covering all four position types plus grants and research funding without broad crawling or a new pipeline.

## Context

Candidate access differs: EURAXESS public search is confirmed but a read API is not; Bath advertises structured job feeds; CERN is an internship candidate; Grants.gov has a documented search API but may be institution/geography mismatched. Final choices follow the researcher's actual interests/eligibility.

## Dependencies

03-04 complete, 05 active; source framework/persistence tested; researcher relevance/eligibility scope available or explicitly unresolved source-choice gate. Current access/rights review is mandatory for each chosen host.

## Non-goals

No general university crawler, assumed private API, automated application submission, CV parsing, ranking redesign, Telegram integration, production schedule/deployment or LLM.

## Implementation scope

**Checkpoint A — position pilot:** Verify a structured institutional feed (Bath or relevant alternative), capture RSS/XML/JSON fixtures and implement one bounded adapter. Filter research roles using explicit evidence; broad academic boards include nonresearch jobs. Add a broad approved source such as EURAXESS only if it adds useful coverage. No public readable API is assumed without documentation.

**Checkpoint B — position coverage:** Prove `phd`, `postdoc`, `research_assistant`, `research_internship` mappings, degree/qualification/eligibility uncertainty, organization/location/work mode, publication/application dates, rolling recruitment, explicit closure and employer/aggregator duplication. Evaluate a targeted internship source only if needed; CERN is a candidate subject to actual eligibility, not mandatory.

**Checkpoint C — funding coverage:** Evaluate a relevant structured funder/portal. Implement a bounded adapter only where needed to cover `grant` and `research_funding`. EURAXESS funding or Grants.gov are candidates; choose a different official source if researcher/institution eligibility does not fit. Distinguish grant schemes/cycles, forecasts, open calls and non-grant research funding. A generic job row or ineligible grant catalogue cannot satisfy this checkpoint.

Close checkpoints sequentially and retain working adapters. Do not refactor unrelated conference code or add adapters that duplicate proven coverage without a measured benefit.

## Expected files/modules

Chosen `_shared/adapters/sources/<slug>/` modules/manifests; realistic RSS/XML/HTML/JSON fixtures with rights/provenance; parser/normalization/identity/contract tests; isolated integration runs; six-type coverage matrix and source evaluation/resource notes in DATA_SOURCES/PLANS. Update type attributes only through documented domain/database changes if observed data requires them.

## Acceptance criteria

- Every one of the six owned type codes has a realistic fixture and an approved configured collection path; live seasonal absence has explicit source evidence, not fake records.
- At least one structured research job feed and one relevant funding path are proven end to end against the isolated database. Choose minimum adapters sufficient for coverage.
- Nonresearch jobs and known ineligible records are handled with explicit reason codes; missing qualifications do not become false exclusions.
- Stable source IDs, re-posts, reused funding URLs/cycles, updated deadlines and cross-portal duplicates obey core policy.
- Rights, endpoint auth, rate/payload limits, resource measurements and disable/retry behavior are documented. Deterministic tests use no live websites.

## Validation commands

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:plan
deno task db:verify
deno task test:integration
deno task sources:smoke --source bath-research
deno task sources:smoke --source cern-students
deno task sources:smoke --source grants-gov-research
deno task sources:jobs-benchmark
deno task sources:funding-benchmark
```

These selected slugs close the six-type matrix with three adapters. Record exact results in PLANS and the phase report. `db:plan` is read-only; all persisted smoke data is test-only. `test:positions`/`test:funding` are focused hosted diagnostics; the full integration task includes both. Baseline tasks and offline benchmarks must not call websites. Also run the documentation validator, credential scan and `git diff --check`.

## Manual verification

Compare representative job/internship/funding records with the official original pages, including qualification and applicant/institution eligibility. Check unknown/multiple countries, remote versus hybrid, source publication versus fetch, rolling dates, salary/currency only when explicit, grant cycle identity and original links. Verify disabling a failed source leaves healthy event/jobs/funding tasks usable.

## Known risks

Unverified EURAXESS API/read rights, stale/truncated feeds, employer ATS redirects, institutional eligibility mismatch, ambiguous role titles, annual funding URL reuse and oversized detail enrichment. This phase is larger in category count; its three checkpoints constrain work without creating an unrelated crawler framework.

## Exit criteria

All three checkpoints and six-type coverage gates pass with fixture/live isolated evidence, required commands green and source register current. Mark 05 complete, active phase none; stop before journals. A missing funding/internship path keeps this phase incomplete rather than silently deferring it to production.

## Verified exit evidence — 2026-10-29

- [x] A: official bounded Bath RSS, explicit role/qualification filtering, realistic fixtures, current terms/robots, resource benchmark, hosted persistence/live/replay/cleanup.
- [x] B: Bath/CERN cover four position codes; historical/seasonal PhD and assistant absence disclosed; real internship mapped with assignment/eligibility restrictions, dates/reposts/cross-source identities and partial detail failure tested.
- [x] C: official Grants.gov documented read API; NSF/ST research G and CA calls prove distinct grant/research_funding paths, cycle/amendment/status/eligibility evidence, four-request cap and resource measurements.
- [x] Five guard, 73 unit, 25 contract, 100 hosted SQL, ten plan and 99 hosted application assertions pass. All three final live smokes pass (7/7/9 assertions); eight real opportunities/eight deadlines verified and cleaned. Two earlier Bath transport timeouts remained visible and bounded, followed by a successful final invocation.
- [x] Hosted three-family failures and disable/re-enable preserve unrelated work, existing canonicals and deterministic identity; cleanup/empty inventory pass. Seven migrations/types/schema/RPCs unchanged.
- [x] Rights/register/manifests/checksums/manual comparisons, exact validation/evidence, documentation/credential/diff checks and readiness are recorded in [the Phase 05 report](../../docs/verification/phase05-research-sources.md). The only material boundary extension is [ADR 0011](../../docs/adr/0011-bounded-read-only-json-post.md), default-denied exact read-only JSON POST.

Technical source coverage uses a disclosed nonpersonal test subset; actual researcher interests, host and personal eligibility are not fabricated. Later profile/release work must validate fit before delivery. Phase 05 is complete. Phase 06 remains pending and requires separate activation.
