# Telegram adapter runbook

Phase 07 implements local code and isolated development tests. No bot/function/webhook or schedule is deployed. Production registration, secrets and gateway checks belong to Phase 10. No temporary test bot is authorized or required. See [ADR 0012](adr/0012-durable-telegram-interactions.md), [verification](verification/phase07-telegram.md) and [rendering review](verification/phase07-rendering.txt).

## Configuration and provisioning

The future Edge configuration uses these secrets/settings, supplied securely by the operator:

| Name | Validation / purpose |
| --- | --- |
| `TELEGRAM_WEBHOOK_SECRET` | Independent 32–256 ASCII letters/digits/underscore/hyphen; required before accepted parsing or database construction. |
| `TELEGRAM_BOT_TOKEN` | Server-only Bot API credential; its numeric prefix must match the configured bot. Never log token-bearing URLs. |
| `TELEGRAM_BOT_ID` | Canonical decimal string, no exponent/fraction/leading zero. |
| `TELEGRAM_BOT_USERNAME` | Command suffix routing only; never authorization. |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated canonical decimal strings; at most ten. Only a matching binding authorizes a user. |
| `TELEGRAM_BINDINGS_JSON` | Exactly one initial binding: `[{"userId":"USER_ID","chatId":"SAME_USER_ID","targetId":"TARGET_UUID"}]`. Values shown are invalid placeholders. |
| `SUPABASE_URL`, server secret/service-role key | Existing runtime persistence configuration; operator PAT/database URL are never runtime inputs. |
| `RADAR_INTERNAL_JOB_SECRET` | Existing independent authenticated worker gate; unchanged by the Telegram endpoint. |

Provision one disabled `research_profiles` row and its enabled private-chat `delivery_targets` binding through a verified operator setup before installing the runtime configuration. No username-based registration or automatic profile creation is exposed. The target must already match the supplied profile, user, chat and bot. No actual profile or personal preferences are seeded by this phase. Test fixtures provision explicitly synthetic rows and remove them afterward.

Only `[functions.telegram-webhook] verify_jwt=false` is added in `supabase/config.toml`. The pre-existing worker configuration remains unchanged. This selects application secret authentication; it grants no database/user authorization. The supported per-function behavior is documented by [Supabase](https://supabase.com/docs/guides/functions/function-configuration), reviewed 2026-10-30. Actual hosted gateway verification remains Phase 10.

## Ingress and durable processing

Accept POST/application-json only; enforce 65,536 decoded bytes using streaming reads, including requests without Content-Length. Reject wrong method with 405, oversized body with 413, unsupported content type with 415 and malformed JSON with 400. Body reads have a five-second abort. Unconfigured runtime fails closed. The independent `X-Telegram-Bot-Api-Secret-Token` is compared through SHA-256 digests and a fixed 32-byte XOR loop; missing/wrong values return 401. No header/payload/secret logging occurs.

Validate the actual sender, private chat, configured allowlist and exact binding before constructing the privileged client. A callback additionally requires the originating bot identity. Numeric ID lexemes are preserved as decimal strings before DTO construction; numeric parse results are never used for identity. User/chat/bot/message IDs remain text; update IDs enter a text-argument RPC and are cast to bigint only inside PostgreSQL. Actual generated numeric bigint signatures are not used for external IDs.

`rr_receive_telegram` rechecks database binding and uses the original atomic inbox/enqueue contract. Minimal commands, validated basic patches, or callback token/message reference are stored; raw messages/usernames/updates are discarded. `(bot_id,update_id)` tombstones deduplicate independently of order. Authorized unsupported/malformed actions and stale callbacks get reduced rejection rows without tasks. Valid-secret unauthorized/unsupported external requests receive 2xx without private reads. Receipt failure returns 503 so Telegram may retry; post-receipt processing failure leaves durable work and returns 2xx.

The webhook awaits up to five UI tasks within a 20-second bound; it never claims collection work. The authenticated `job-worker` can recover UI tasks when valid Telegram runtime configuration exists. No detached promises, source IO, schedule, polling or persistent process is introduced. Phase 09 owns scheduled recovery; Phase 10 owns deployed latency measurements. Database task leases remain fenced and capped at three claims/90 seconds.

`rr_execute_interaction` journals each reduced effect result under its inbox/task fence. Feedback, profile edits and refresh requests cannot be repeated after a crash before reply creation. `rr_commit_interaction_reply` atomically freezes notification parts and completes the command under `command:<task UUID>`. Replaying the accepted update cannot create another logical reply.

## Commands and setup

| Command | Behavior |
| --- | --- |
| `/start`, `/help` | Readiness/missing fields, concise command list. |
| `/today` | Fresh eligible assessments for the last seven days; no ranking if disabled/incomplete; forecasts/upcoming journal windows excluded. Does not consume a digest claim. |
| `/deadlines` | Next 30 days plus separately labeled unknown/rolling/conflicted evidence. Calendar dates never become exact countdowns. |
| `/conferences` | Conference/workshop/standalone conference CFP records; events remain browsable after submission closure. |
| `/jobs` | Four position types; funding remains in today/deadlines/saved/details. |
| `/journals` | Journal CFPs/special issues, including explicit upcoming/prerequisite notes. |
| `/saved` | Saved records, including closed/ignored items; Ignore does not erase Save. |
| `/profile` | Basic view and one-field explicit setup; no inferred interests or conversational wizard. |
| `/refresh` | Atomically enqueue approved enabled source runs; existing active runs coalesce. Five-minute per-profile throttle, at most twenty sources, pause/cooldown respected. No fetch occurs in the handler. |
| `/status` | Redacted readiness, up to twenty latest source checks, stale coverage, queued/running work, reply backlog and unresolved deliveries. No raw error text or connection/config data. |

Basic setup syntax: `/profile timezone Area/City`, `/profile topics phrase one; phrase two`, `/profile types conference,postdoc`, `/profile time 08:00`, `/profile enabled true`, `/profile digest false`. Booleans must be `true`/`false`; schedule must be HH:MM. Timezone, topics and enabled types must be explicitly supplied before enabling. Clearing a required field while enabled is rejected. Digest configuration can be viewed/set but schedules stay inactive. Matching changes invalidate assessments by profile revision; Phase 08 owns calibrated editing/re-ranking. Basic enabled types are deterministic exclusions, never scoring weights.

## Pagination, callbacks and rendering

Each initial list freezes at most 100 ordered opportunity UUIDs in its existing reply snapshot, showing three slots per page for 30 minutes. A cap is labeled and a new command refreshes the snapshot. Fresh collections cannot reorder these pages. Current fields/state are reread; unavailable slots are omitted, not refilled from another page. Profile changes expire snapshot buttons. Details/feedback buttons expire after 24 hours or loss of their original binding/message.

Callback format is `1:<code>:<32 hex opaque command task token>:<0..2>`, exactly 38 ASCII bytes, below Telegram's 64-byte limit. Codes: `d` details, `s` save, `u` unsave, `i` ignore, `r` unignore, `o` tracked Open intent, `p` next page. The token carries no profile, query state, URL, preference or secret. PostgreSQL resolves the stored button, exact part, definite sent message ID, original actor/chat, current profile/target/bot and item reference. Copied, uncertain, cross-target, malformed and stale callbacks cannot authorize work. Acknowledgement uses bounded best-effort `answerCallbackQuery` even for rejected supported callbacks; no business effect depends on acknowledgement success.

Save/Unsave and Ignore/Undo Ignore set desired states through transactional feedback/event storage. Repeating Save cannot Unsave. A direct safe URL button records no event. Only explicit `o` callbacks record `open_intent`, which is labeled as intent rather than proof of a browser visit. The [Telegram Bot API](https://core.telegram.org/bots/api#inlinekeyboardbutton) and [callback acknowledgement reference](https://core.telegram.org/bots/api#answercallbackquery) were reviewed 2026-10-30.

HTML is the single parse mode. Escape every source/user text before sending; disable link previews; pass only URLs validated by the existing safe-URL policy. List titles/organizations are compact excerpts with explicit ellipses; list rounds are summarized, details retain up to eight rounds and the official link. Split plain text at at most 3,000 UTF-16 units before escaping, preserving Unicode scalars and complete HTML entities. URL buttons are never split/truncated. Store at most ten immutable parts, bounded below the database 64-KiB plan ceiling. Mobile preview is a synthetic 38-column text approximation, not live Telegram evidence.

## Delivery and uncertainty

Persist `sending` before any external request, then send once with an eight-second timeout and a bounded 32-KiB response. The adapter supports only sendMessage and answerCallbackQuery. It contains no webhook lifecycle method. Ordered parts must pass predecessor checks; a concurrent early claim defers for 30 seconds within the existing claim budget. Definitely unsent successors of failed/uncertain parts are canceled visibly. Rebinding cannot redirect a prepared reply to a different account.

| Mock outcome | Durable result |
| --- | --- |
| Verified success with matching bot/chat and lossless message ID | `sent` attempt/part/task. |
| Definite 429 rejection | `retryable_failure`, persisted Retry-After, delayed capped task retry; no immediate loop. |
| Definite permanent 400/401/403/404 | Terminal permanent failure; forbidden/auth failure disables the target. |
| Timeout, connection ambiguity, malformed response, unclassified 5xx | `uncertain`; task terminalized and claims retained. |
| Crash after marker or possible send, before outcome write | Marker remains `sending`; expired-lease recovery quarantines it as uncertain. No automatic resend. |

The conservative resolution policy in [OPERATIONS.md](../OPERATIONS.md) applies. No exactly-once Telegram guarantee is made, and Phase 07 adds no uncertain-send resolution/resend tool. Production plan-specific safe windows and live gateway/transport behavior remain Phase 10 gates.

## Validation and boundary

Run `deno task check`, `test:unit`, `test:contract`, guarded `db:verify`, `test:integration`, focused `test:telegram`, `telegram:preview`, documentation validation, credential scan and `git diff --check`. Hosted tests use real RPCs and deterministic mock Telegram; cleanup removes synthetic rows and restores both pause flags. The runner requires the verified isolated development target/history/schema/receipt and exclusive verification lock. Never point it at production or bypass interrupted-fixture inventory failures.

No production `setWebhook`, function deploy, Telegram secret installation, Cron activation, digest/reminder generation or live bot send is part of Phase 07. No Phase 08 activation follows from this implementation.
