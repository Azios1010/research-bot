# ADR 0003: Telegram webhook as the primary UI

Date: 2026-10-28

Status: accepted

## Context

The researcher needs a real Telegram bot with commands, buttons and notifications. Long polling requires a persistent process. Telegram retries webhooks, so ingress and side effects must tolerate duplicate and out-of-order updates.

## Decision

Use Telegram HTTPS webhook to a dedicated Edge Function. Disable gateway JWT verification only as needed for this external authentication mode; verify Telegram's configured secret header, sender-ID allowlist and private chat before privileged work. Persist update receipt and task enqueue atomically by `(bot_id, update_id)`. Translate to application actions; Telegram DTOs/rendering stay in the adapter. Phase 07 implements/mock-tests; Phase 10 registers and verifies the real bot.

## Alternatives considered

Long polling conflicts with the runtime model. A web UI or Supabase Auth login adds unnecessary user infrastructure. Replying with untracked external side effects during receipt makes crash/retry behavior harder to account for.

## Consequences

Webhook lifecycle and secrets need explicit operations. Delivery uses an outbox; send timeouts can remain ambiguous because Telegram does not expose an application send idempotency key. Direct source-link clicks are unobservable; a tracked Open action records intent only. The domain remains channel independent.

## Validation

Use the [official Bot API](https://core.telegram.org/bots/api) for current limits/lifecycle. Phase 07 tests authorization, replay, callbacks, formatting and transport ambiguity. Phase 10 checks actual gateway config, webhook status, real commands and notifications. See [operations](../../OPERATIONS.md).
