# Phase 06 — Journal calls and special issues

## Goal

Add a small permitted publisher/CFP source path that produces relevant journal calls and special issues through the existing pipeline.

## Context

Publisher directories and journal pages are candidates, not proven reusable feeds. Published article collections and article RSS do not necessarily describe open calls. Wiley's observed rights notice needs resolution; Springer community rendering and ScienceDirect access need feasibility checks.

## Dependencies

03-05 complete, 06 active; actual journal/topic scope, current publisher terms/robots/license review and bounded readable endpoint evidence. No source is enabled while permission remains unresolved.

## Non-goals

No publisher-wide mirror, paywall/login/anti-bot bypass, browser service, manuscript submission, journal-quality certification, LLM extraction, Telegram change or production activation.

## Implementation scope

1. Evaluate Springer Nature/Elsevier or a relevant official journal/structured CFP feed. Choose the smallest approved path that covers `journal_cfp` and `journal_special_issue`; a rights-blocked candidate is replaced, not worked around.
2. Implement fetch/parse/mapping/manifest and sanitized HTML/JSON/RSS fixtures for that path. Add another source only if a specific coverage/relevance gap remains.
3. Capture journal, publisher, ISSN/guest editors/submission window and fees only when supplied, in validated per-type attributes. Map title/organization/topics/original links to common fields.
4. Treat a special issue and its call as one opportunity when identity evidence agrees; preserve separate themes/cycles and distinguish proposal calls from author submission calls. No duplicate rows for every URL/view.
5. Handle date-only/unknown/rolling deadlines, closed calls, conflicting dates and stale published-collection pages. Persist/replay with existing core and isolated database.

## Expected files/modules

Chosen `_shared/adapters/sources/<publisher-or-feed-slug>/`, manifest/rights record, minimal original-format fixtures and expected drafts, parser/contract/integration cases, two-type coverage matrix, bounded smoke/resource evidence, updated DATA_SOURCES/DATABASE attributes docs if required.

## Acceptance criteria

- Both journal type codes have realistic fixtures and approved ingestion paths. A special issue with an author call is not duplicated merely to populate both codes; standalone journal-call mapping is also proven.
- At least one live approved path produces real isolated persisted data and reliable original URLs; seasonal absence is documented where relevant.
- Open author calls are distinguishable from published collections, editor-proposal invitations and expired pages; deadline precision and eligibility remain explicit.
- Duplicate directories/details/call pages resolve conservatively, without merging distinct themes or years.
- Parser drift/empty-valid/partial failures and safe URL/markup cases pass offline. Permission and resource gates are documented; unapproved endpoints remain disabled.

## Validation commands

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:plan
deno task db:verify
deno task test:integration
deno task sources:smoke --source jeacs-journal-calls
deno task sources:journals-benchmark
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-docs.ps1
deno task secrets:scan
git diff --check
```

Record the actual slug and exact command. Smoke is a bounded opted-in read and test-only persistence, never an implicit dependency of unit/contract tests or a notification send.

Selected implementation: one JEACS official journal announcements/policy/fixed-detail HTML adapter, with current CC BY 4.0/robots evidence and explicit nonpersonal humanities test scope in [source decision](../../docs/sources/jeacs-journals.md). Springer/Elsevier were rejected at rights/access gates and MDPI remains unresolved. No second live journal adapter is needed for type coverage. `test:journals` is an additional focused hosted diagnostic, also included in full integration; it is not a substitute for `db:verify` or full regression.

The single shared correction addresses explicit conflicting evidence that has unknown normalized precision: it must not be treated as a missing date and leave a previously known round usable. Preserve prior candidate/provenance, mark conflicted at equal/greater authority, retain stronger reviewed evidence and test resolution. SourceAdapter, persistence/RPC/schema boundaries remain unchanged; no new pipeline or journal-specific domain branch.

## Manual verification

Compare a relevant sample to official call/detail pages. Inspect active status, title/theme/cycle, journal/publisher mapping, original link, date-only labels, submission-window end, fees/eligibility evidence and provenance. Check that indexed old articles do not appear as new opportunities. Review current rights and failed-source isolation.

## Known risks

Publisher text/data-mining restrictions, changing HTML/JS rendering, article-versus-call confusion, anti-bot systems, undated/rolling calls, predatory aggregator listings and false journal/issue merges. No publisher is mandatory; source replacement is preferable to an unapproved runtime or access workaround.

## Exit criteria

Both category gates, rights review, deterministic suites and hosted persistence checks pass; source/coverage/evidence current; 06 complete and active phase none. Stop before Telegram implementation.

Completed 2026-10-30. [Verified handoff](../../docs/verification/phase06-journal-sources.md): 86 unit/31 contract/five guards, 100 hosted SQL/ten plans/real concurrency and 125 application assertions; final nine-assertion JEACS live smoke, five real opportunities/ten deadlines, manual comparison, replay and cleanup all pass. One-journal scope and seasonal open regular-CFP absence are disclosed. Source/fixture/resource/rights register and repository checks pass. No Phase 07 activation, commit, push or deployment.
