# ADR 0013: Validated profiles and fenced persisted-data reranking

Date: 2026-10-30

Status: accepted; extends ADRs 0005/0008/0012. Personal calibration remains open.

## Context

The Phase 03 scorer and Phase 07 profile edits exist. Inspection found permissive rule JSON, missing rule-version gates in projections, daily validity crossing score boundaries, and no durable rerank after edits. Existing assessment writes compared content/profile revisions but could overwrite a newer time evaluation. Feedback lacked the assessment shown in the original message.

## Decision

Extend the same scorer as `deterministic-v2`, retaining the seven component weights. Version the punctuation/hyphen and combining-mark matching correction, explicit excluded countries and known student/citizenship conflicts, unknown-work-mode exclusion policy, and precise time validity. Keep schema version 1 for additive optional profile fields; malformed or unknown fields fail closed. Existing absent legacy fields remain empty/unknown, with no inferred personal facts. [Profile contract](../RANKING.md) enumerates bounds and migration behavior.

Use the existing `assess_batch` kind. A profile revision atomically starts a UUID-keyset chain of at most 50 persisted IDs per task, with an initial upper UUID bound. Its coalescing scope contains profile/revision/rule; completion and continuation commit together. Explicit `/profile rerank` or backend-only `rr_request_rerank` starts a coalesced pass for rule/time changes. No timer, source collection or new entity is introduced. Superseded chains cancel conservatively; new profile revisions have independent chains.

Fence writes by live lease, membership, current profile/content revision, current rule, evaluation timestamp, unexpired bounded validity and current Ignore state. Reject older evaluations and stale ordinary batches with PT409. Every personalized projection and delivery eligibility check pins current rule/revisions/time. Historical notification claims and feedback remain untouched.

Freeze bounded rule/score/revision/evaluation context with rendered reply parts; callbacks retrieve that original exposure context through the existing exact message/binding checks. Direct links produce no telemetry. Save, Ignore and Open intent never change preferences. The future `ShortlistReranker` interface has no provider implementation.

## Alternatives considered

A second ranker, unbounded Telegram rerank, source refetch, broad table grants, background promises, automatic learning and a second queue/outbox violate existing contracts. Changing v1 in place would hide material matching/validity changes. Selecting a threshold from synthetic fixtures would fabricate personal calibration.

## Consequences

Five forward migrations preserve applied history, eighteen private tables, invoker security and restrictive grants. The additional public RPC only requests bounded rerank work. The second migration allows canceled assessment tasks, which the older finish primitive restricted to collectors, and immediately labels an ignored details view while reassessment is pending. The third serializes assessment CAS with feedback using the existing profile lock; the fourth corrects the SQL country catalog to match the domain, with a parity guard. A fifth aligns canonical whitespace, normalized-empty rejection and raw UTF-16 bounds between the basic editor and SQL validation. Actual types must be regenerated after hosted verification.

Default threshold 40 remains provisional. A bounded, all-type synthetic review tests configurations and reveals false positives; it does not establish actual researcher relevance. No personal profile/timezone has been supplied. Phase 08 cannot close until the researcher supplies and reviews preferences, representative labels and a justified threshold. No LLM, schedule or production activation follows.

## Validation

Exact golden component/reason/validity tests, strict profile and Unicode tests, transport-neutral contract tests, real isolated SQL and HTTPS profile/replay/CAS/concurrency/keyset/claim tests, scoped cleanup, and mock profile/details review. The full required checks and actual human calibration are separate acceptance gates.
