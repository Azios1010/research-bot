# ADR 0012: Bound Telegram interactions to persisted command replies

Date: 2026-10-30

Status: accepted

## Context

Phase 07 requires bounded private projections, basic profile setup, refresh throttling and callbacks. Existing inbox, feedback and notification primitives are authoritative, but lack these reads and actual-message ownership checks. Generated bigint signatures use JavaScript numbers, which cannot safely carry external IDs.

## Decision

Add six invoker backend RPCs with empty search paths and explicit service-role grants. Receive external IDs as decimal text, verify target/account/chat/bot, then cast the update ID inside PostgreSQL before using the original inbox primitive. Never coerce external IDs through a generated numeric argument.

Callbacks use `1:<action>:<command-task UUID without hyphens>:<item index>`. The opaque UUID references a persisted reply through its unique `command:<task UUID>` schedule key. Each callback must match a button in the exact part with a definite successful attempt/message ID for the current target and bot. Reject copied, uncertain, expired, cross-target and malformed callbacks. Callback acknowledgements are bounded best effort, independent of durable business effects.

Freeze at most 100 ordered opportunity IDs in reply parts for stable three-item snapshot pages, expiring after 30 minutes. New collections cannot move items between these pages. Re-read item fields and saved/ignored state; removed/ineligible slots are not refilled from elsewhere. A capped snapshot is labeled; a new command starts a new snapshot. Details/feedback expire after 24 hours. No new callback/delivery table or exposed schema is needed.

Execute a command effect once and journal its reduced result in its existing inbox action under the task fence. Reply preparation and command completion commit atomically through the original notification model. Crashes between effect and reply replay the journaled result, never reapply a profile edit or refresh. Sends persist attempts before IO; only definite rejections are retryable. No automatic digest/reminder generation or uncertain-send resolution is introduced.

Review follow-up: forward migration `20261030000200_reply_order_and_binding.sql` orders outgoing parts, checks predecessors under the profile lock, and cancels definitely unsent successors of uncertain/failed parts. Concurrent early claims defer within the existing task budget. Callback and send checks also compare the original inbox actor/chat to the current target, so rebinding a target row cannot redirect an older reply or authorize copied buttons. Applied migrations remain immutable.

Display follow-up: `20261030000300_projection_lifecycle.sql` retains authoritative forecast/upcoming source states in UI labels even when coarse canonical lifecycle preserves an older open fact. It prioritizes current actionable rounds and labels elapsed submissions separately from event lifecycle. It changes only the existing bounded projection helper, with no ingestion/scoring/signature/grant change.

## Alternatives considered

Raw opportunity/profile/query JSON in callbacks does not prove ownership. A second outbox/token table duplicates durable state already present. Stateless live-offset pagination shifts under concurrent ingestion. Direct table access or the operator SQL client would bypass the private-schema contract. Editing applied migrations would rewrite history.

## Consequences

The first release intentionally caps each list snapshot at 100 items. Callback availability requires definite message persistence; an uncertain send cannot authorize buttons until operator disposition is implemented later. Basic enabled types become an explicit deterministic exclusion; no weight calibration or learned preferences are added. Operators provision the one disabled profile/target securely before setup; no user registration or invented personal facts. Regenerate types only after actual hosted application/verification.

## Validation

Offline synthetic ingress/rendering/transport/replay tests plus isolated hosted RPC, grant, concurrency, feedback, profile, projection, refresh and crash-window tests are required. Reuse the guarded target/plan/verification/cleanup workflow. No production webhook, bot secrets, deployment or Cron activation.
