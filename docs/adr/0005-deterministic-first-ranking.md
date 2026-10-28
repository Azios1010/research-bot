# ADR 0005: Deterministic filtering before optional LLM ranking

Date: 2026-10-28

Status: accepted

## Context

The system must be useful, explainable and affordable without an LLM. Most collected records should be excluded or scored from explicit profile rules. Automatic provider calls on every record add cost and failure coupling.

## Decision

Run hard deterministic exclusions first, deterministic component scoring second, and bound the eligible shortlist before any optional reranker. Persist profile/opportunity/rule versions and explanations. A future `ShortlistReranker` cannot restore excluded items or mutate canonical facts; timeout/invalid output falls back to deterministic order. Baseline scoring is in 03; profile calibration/editing in 08. LLM implementation is deferred beyond the ten phases pending measured need and an authorized scope change.

## Alternatives considered

LLM-first classification of every item is costly and less reproducible. Pure keyword substring matching creates avoidable false positives. A trained recommender has no initial labeled dataset and is outside current scope.

## Consequences

Explicit profile data, Unicode-aware phrase matching, unknown-eligibility policy, stable tie breaks and assessment invalidation are required. Feedback is collected as evidence for later evaluation, not automatically treated as labels that rewrite rules. Scores are relevance heuristics, not calibrated probabilities.

## Validation

Golden researcher-reviewed fixtures in 08 cover exclusions, threshold boundaries, missing fields, changes over time, re-ranking and stable explanations. Entire production behavior must run with no LLM provider credentials. See [product behavior](../../PRODUCT_SPEC.md).
