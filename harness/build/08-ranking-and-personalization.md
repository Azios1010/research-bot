# Phase 08 — Deterministic ranking and personalization

## Goal

Make relevance useful and explainable for the actual researcher with versioned preferences, calibrated deterministic rules and safe re-ranking.

## Context

Phase 03 supplied baseline scoring; Phase 07 exposed basic profile setup and query views. This phase owns calibration and validated profile changes, not another ranking pipeline or an LLM launch.

## Dependencies

07 complete, 08 active; actual researcher topics/types/geography/institution/qualification preferences and timezone obtained securely; representative sanitized opportunity fixtures from source phases. If personal answers are unavailable, implement mechanics with labeled test profiles but keep actual calibration acceptance open.

## Non-goals

No LLM provider integration, embeddings/semantic deduplication, trained recommender, automatic preference learning, multi-user management, new sources, production schedule or deployment.

## Implementation scope

- Finalize schema-validated profile rules, safe defaults and versioned edits via `/profile` help/subcommands/buttons. Permit explicit positive/blocked/ignored topics, enabled types/type weights, preferred/hard countries, institutions, qualification facts, unknown-data policy, timezone/digest time and reminder offsets. Bound text/arrays and reject unsupported fields rather than execute arbitrary JSON.
- Calibrate the documented score components/threshold on a small researcher-reviewed relevance set containing positives, negatives and uncertain cases. Record the final rule version, rationale and known limits; no undocumented weight changes.
- Ensure deterministic filters precede scoring, Unicode-aware phrase/alias matches avoid substring errors, and stable tie breaks/reasons are visible through details.
- Invalidate/upsert assessments by opportunity/profile/rule revisions and time expiry; process re-ranking in bounded tasks. Profile edits cannot duplicate historical digest claims or resurrect ignored records.
- Persist feedback with exposure/rule context for later evaluation. Save/Open intent do not automatically rewrite weights; ignore remains a hard per-item gate. Document future `ShortlistReranker` contract and deterministic fallback without adding a provider implementation.

## Expected files/modules

Domain ranking/profile policies and tests, profile/reranking application use cases, Telegram profile adapter UI, versioned rule configuration, golden relevance fixtures and review notes, assessment projection/RPC refinements, updated ARCHITECTURE/PRODUCT_SPEC/DATABASE/PLANS/CHANGELOG.

## Acceptance criteria

- Actual profile is valid and its relevance fixture review is recorded without committing private profile exports. Unknown eligibility remains honest; known conflicts and blocked topics exclude before score.
- Every score component/exclusion is reproducible and explained; ties, threshold/time boundaries and malformed preferences are tested.
- Profile/data/rule changes invalidate stale assessments and bounded re-ranking completes without recollecting sources or losing feedback.
- Save/ignore/Open intent remain profile-scoped; ignored-and-saved behavior is deterministic. Existing notification claims survive score/profile changes.
- Every planned feature works with no LLM key, API call or provider dependency. Full LLM integration stays deferred.

## Validation commands

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:verify
deno task test:integration
```

Golden ranking/phrase/qualification/temporal tests are part of unit tests. Hosted integration covers profile revisions, feedback, assessment invalidation and notification claim preservation. No external website or LLM is needed.

## Manual verification

Researcher reviews a bounded ranked sample with reasons and exclusions. Edit profile preferences, verify revision/changed ordering and stale-assessment replacement, then restore intended settings. Check unknown data labels and that Save does not override Ignore. Record agreed timezone/digest/reminder behavior without disclosing secret/private settings in evidence.

## Known risks

Overfitting a small fixture set, inferred qualification/geography facts, phrase-language mismatch, feedback selection bias, mutable rule versions and stale time-sensitive scores. Make limits visible and keep one reproducible deterministic fallback.

## Exit criteria

Calibration/profile review and all validation pass; final deterministic rules and deferred LLM boundary documented; 08 complete and active phase none. Stop before activating automation.
