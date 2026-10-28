# Phase 07 — Telegram webhook and user interface

## Goal

Implement the complete Telegram command/callback adapter and safe durable ingress/delivery boundaries around existing use cases, using mocked transport for normal validation.

## Context

Opportunity/source/core data paths exist. Telegram must not become the domain or collector runtime. A real production bot/webhook is activated only in Phase 10; this phase proves handler behavior and adapter tests.

## Dependencies

03-06 complete, 07 active; inbox/task/outbox RPCs, deterministic queries/assessments and test fixtures available; secure operator configuration for a supplied profile or clearly labeled test profile. Real secrets are not required for deterministic tests.

## Non-goals

No production webhook registration, Cron, automatic daily delivery, LLM, new collector, multi-user onboarding, public web UI or redesign of ranking. Optional separate test-bot smoke requires explicit authorization and cannot replace mocked tests.

## Implementation scope

- Add `telegram-webhook` with POST/body bounds, verified secret header, lossless IDs, configured user allowlist, private-chat/target binding, durable update receipt/enqueue and duplicate/out-of-order handling.
- Translate updates to application actions; bounded immediate claim can serve common queries quickly, while durable tasks provide recovery. No correctness depends on a best-effort worker kick.
- Implement all eleven commands. `/today`, `/deadlines`, `/conferences`, `/jobs`, `/journals`, `/saved` use paginated projection queries. `/refresh` coalesces/throttles queued work; `/status` exposes redacted run/backlog/outbox health. `/profile` displays and validates basic setup (timezone, topics, enabled types/schedule); Phase 08 adds full preference editing/calibration.
- Add details, Save/Unsave, Ignore/Undo Ignore, tracked Open intent and direct URL buttons, stable opaque callback/pagination encoding, authorization at every action, callback acknowledgement and escaped rendering.
- Implement delivery adapter and persisted command-reply parts/attempts with definite versus uncertain outcomes; automatic scheduled digests remain Phase 09. A command replay must not repeat feedback or create another logical reply.
- Add user-readable setup-incomplete, empty results, stale coverage, unknown deadline and temporary failure responses. Keep infrastructure details out of normal user flow except meaningful status.

## Expected files/modules

`telegram-webhook/index.ts`, `_shared/adapters/telegram/`, application query/feedback/refresh/profile use cases, command task handler, projection RPCs/corrective migrations as needed, Telegram Update/Bot API fixtures, formatting/auth/replay/integration tests, lifecycle/config/runbook docs.

## Acceptance criteria

- Every required command routes and formats bounded useful results; all callback actions set desired state idempotently and inspect originals safely.
- Unknown users, group chats, invalid secrets, oversized/wrong-method payloads and cross-target callbacks cannot query data or enqueue privileged work.
- Database outage before receipt returns retryable failure; repeated accepted/completed updates do not repeat business effects. Different out-of-order updates remain valid.
- Rendering handles escaping/multilingual text/length/part boundaries/callback byte limits; direct link clicks are not falsely counted as Open telemetry.
- Setup can create/validate one supplied profile without registration. Incomplete profile disables automatic matching/delivery rather than inventing preferences.
- Mocked success/rate-limit/permanent/ambiguous sends and crash windows leave correct persisted attempts/claims. No real webhook, production secret or live notification is required for completion here.

## Validation commands

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:verify
deno task test:integration
```

Unit/integration suites include every route, ingress auth, duplicate update, state mutation, pagination and fake Bot API scenario. Hosted database remains isolated. Inspect function auth configuration statically; actual production gateway behavior is tested in 10.

## Manual verification

Replay representative authorized/unauthorized/duplicate/out-of-order fixtures, inspect one inbox/action/task/reply chain and one saved/ignored state. Read rendered digest-style/details/query messages on narrow-screen mock text. Confirm `/refresh` does not scrape synchronously and `/status` shows uncertainty without secrets. If separately authorized test-bot interaction occurs, record bot/target class and restore its configuration safely.

## Known risks

Gateway JWT rejection before custom auth, authorizing by username/chat alone, JSON bigint precision, stale callback ownership, repeated boolean toggles, leaking Telegram DTOs inward, command reply ambiguity and callback limits. Keep routing/rendering in the adapter and use persisted application idempotency keys.

## Exit criteria

Command/callback/security/replay/delivery-boundary suites pass and manual adapter review is recorded; docs updated; 07 complete and active phase none. Stop before ranking calibration or production webhook registration.
