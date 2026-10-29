# ADR 0011: Allow reviewed read-only JSON POST source endpoints

Date: 2026-10-29

Status: accepted

## Context

Phase 05's official Grants.gov [search2](https://www.grants.gov/api/common/search2) and [fetchOpportunity](https://www.grants.gov/api/common/fetchopportunity) use POST for public data reads. GET/HEAD-only transport cannot use them correctly. Adding another client/server or pretending POST is GET would bypass the bounded transport boundary.

## Decision

Extend the injected HTTP request with POST and an optional JSON string body. The existing bounded client denies POST by default. Composition explicitly lists exact reviewed read-only POST URLs, also present in approved HTTPS destinations. Only those URLs may receive POST. Body must be a JSON object, 1–4096 UTF-8 bytes; GET/HEAD cannot carry bodies. Set Content-Type application/json internally. Preserve header allowlist, strict UTF-8 streaming response bounds, timeouts, redirect denial and concurrency. No auth/credentials for public Grants.gov reads.

## Alternatives considered

Verified RSS remains preferable where suitable. UKRI's current sampled scope is predominantly UK-organisation funding and adds no eligibility alignment advantage for this nonpersonal technical subset. Private endpoints, unrestricted POST, a new HTTP framework and separate runtime are rejected.

## Consequences

Source-neutral transport extension; SourceAdapter/domain/database contracts stay unchanged. External data cannot expand trusted method/destination configuration. Current funding subset is NSF research/ST-category calls, one latest grant and one latest cooperative agreement; institutional/US restrictions remain explicit and actual researcher eligibility unknown. This is technical validation, not an eligible-funding recommendation or complete catalogue. No upstream mutation, application submission, deployment or schedule.

## Validation

Test default-denied/unapproved POST, body/type/size/method/header rejection, unchanged redirects/timeouts/response/concurrency and actual allowed read-only POST. Run fixture contracts, isolated hosted/live evidence, regression and secret scan. Update architecture/source/testing evidence. Phase 10 retains deployed resources/rights/eligibility review.
