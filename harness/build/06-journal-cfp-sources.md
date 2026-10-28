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
deno task db:verify
deno task test:integration
deno task sources:smoke --source <approved-journal-slug>
```

Record the actual slug and exact command. Smoke is a bounded opted-in read and test-only persistence, never an implicit dependency of unit/contract tests or a notification send.

## Manual verification

Compare a relevant sample to official call/detail pages. Inspect active status, title/theme/cycle, journal/publisher mapping, original link, date-only labels, submission-window end, fees/eligibility evidence and provenance. Check that indexed old articles do not appear as new opportunities. Review current rights and failed-source isolation.

## Known risks

Publisher text/data-mining restrictions, changing HTML/JS rendering, article-versus-call confusion, anti-bot systems, undated/rolling calls, predatory aggregator listings and false journal/issue merges. No publisher is mandatory; source replacement is preferable to an unapproved runtime or access workaround.

## Exit criteria

Both category gates, rights review, deterministic suites and hosted persistence checks pass; source/coverage/evidence current; 06 complete and active phase none. Stop before Telegram implementation.
