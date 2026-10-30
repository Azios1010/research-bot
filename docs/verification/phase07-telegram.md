# Phase 07 Telegram adapter verification and handoff

2026-10-30. Phase 07 is complete; active phase is none and Phase 08 remains pending. All gates passed on final frozen inputs: 102 unit, 36 contract, five guard, 140 hosted SQL, ten query-plan and 177 hosted application assertions. Documentation, manual rendering, credential/diff checks, receipt audit and final empty-data inventory passed. Production bot/webhook/secrets, Edge deployment and Cron remain untouched. No commit or push was made.

1. **Git baseline.** Clean `D:/projects/research-bot`, branch `main`, HEAD `ce9e3f541436c2032ad8156fa1974e4ad1489a22` (`feat(sources): add bounded journal author-call ingestion`). Read-only `git ls-remote origin refs/heads/main` matched this SHA. Phase 06 was committed/pushed before entry; no history or parent metadata changes.

2. **Modules.** Added Telegram protocol/authorization/translation, ingress, HTML rendering and small delivery adapter; transport-neutral interaction use cases/ports; Supabase inbox/query/effect/reply mapping and lazy composition; webhook root. The existing worker accepts command/reply kinds only when valid Telegram runtime configuration exists. Collectors remain independent.

3. **Edge configuration.** Only the new `[functions.telegram-webhook] verify_jwt=false` declaration is added. Existing worker authentication/configuration is preserved. This is local configuration, not a deployed gateway result.

4. **Secret validation.** Mandatory independent secret, 32–256 permitted ASCII characters; SHA-256 digest comparison through a fixed 32-byte XOR loop. Missing/wrong secret returns 401, absent configuration fails closed. No secret/header/payload logging or production secret installation.

5. **Authorization.** Actual numeric sender in configured allowlist, private chat, exact supplied account/chat/target and bot. Database receipt repeats the target/account/chat/bot check. Callback origin must have the expected bot author and match a definitely sent original message and current binding. Username never authorizes anything. Runtime starts with exactly one configured binding.

6. **ID representation.** Preserve JSON numeric lexemes as decimal strings before accepted DTO construction. No ordinary numeric parse result is used as identity. External IDs never pass through generated numeric bigint arguments: the new receive RPC accepts update text and casts inside PostgreSQL. Message/account/chat/bot IDs remain text. Synthetic fixtures exceed JavaScript's safe integer range.

7. **Durable receipt.** Reuses original atomic inbox plus command-task enqueue, with a reduced versioned command/validated patch or callback token/message reference. Authorized malformed/unsupported actions can create a small rejected tombstone without work. Database failure before receipt returns 503; after durable receipt, failed immediate processing leaves recoverable tasks and returns 2xx.

8. **Duplicate/out-of-order behavior.** Composite `(bot_id,update_id)` tombstones, never a high-water mark. SQL and actual HTTP tests pass duplicate receipt/task prevention and 1002-before-1001 acceptance. Completed replay cannot make another logical reply. Concurrent real HTTP receipt deduplication passed.

9. **Eleven commands.** `/start`, `/help`, `/today`, `/deadlines`, `/conferences`, `/jobs`, `/journals`, `/saved`, `/profile`, `/refresh`, `/status` all route in passing deterministic tests. Today requires readiness/fresh eligible assessments within seven days; deadlines use a 30-day window with labeled unknown/rolling/conflicted evidence. Browsing queries persistence only.

10. **Pagination.** Freeze at most 100 ordered IDs in the original notification snapshot, three slots/page, 30-minute expiry. A cap is explicit. New ingestion cannot reorder pages. Reread current fields/state; omitted slots are not replaced from another page. Profile revision changes expire snapshot buttons. [ADR 0012](../adr/0012-durable-telegram-interactions.md) records the bounded snapshot decision.

11. **Callback encoding.** `1:<code>:<32 hex opaque task token>:<0..2>`, 38 ASCII bytes. Fixed action codes, no profile/preferences/query JSON/URL/secret. Version/grammar/byte-limit negative tests pass.

12. **Callback authorization.** Resolve the persisted button in the exact sent part/message through `command:<task UUID>`; verify target/profile/bot, original actor/chat, current binding, expiry and referenced item. Cross-target/copy/forgery/staleness deny work. Rebinding cannot redirect old replies or authorize old buttons.

13. **Acknowledgement.** Supported callback queries receive bounded best-effort answerCallbackQuery even when rejected or the business action later fails. Ack failure cannot lose durable processing and never leaks private data. No webhook lifecycle method exists in the transport.

14. **Details.** Bounded title, organization, type/lifecycle, location uncertainty, event dates, up to eight deadline rounds, current score/reasons, relevant source-state/prerequisite/eligibility notes and validated official link. No internal provenance IDs are displayed.

15. **Save/Unsave.** Explicit desired states through original transactional feedback/current-state RPC. Effect result is journaled in the inbox before rendering. A repeated Save cannot become an Unsave.

16. **Ignore/Undo Ignore.** Explicit ignore/unignore desired states. Normal lists suppress ignored items; saved history retains them. Undo preserves Save independently. Replay cannot invert a desired state.

17. **Open telemetry.** Direct URL buttons have no telemetry. Only the explicit tracked callback records open_intent and returns a safe source link. UI labels it as intent, never a confirmed browser visit.

18. **Profile.** Basic one-field setup/view for supplied timezone, topics, enabled types, matching enabled state, digest state/time. Invalid/incomplete settings cannot enable matching/delivery. No invented researcher facts or automatic onboarding. Profile revision invalidates old assessments; explicit enabled types are deterministic exclusions. Calibration/full editing belongs to Phase 08.

19. **Refresh.** Atomic bounded per-profile request journal, five-minute throttle, up to twenty approved enabled sources, existing active-run coalescing, pause/cooldown handling and normal collection tasks. No fetch/wait for collectors occurs in webhook or application command processing.

20. **Status.** Readiness, up to twenty source checks/latest successes, stale-source count, queued/leased work, reply backlog and unresolved deliveries. The explicit mapper drops arbitrary error/credential fields. No connection strings, keys, raw headers or exception text reach replies.

21. **Rendering.** One HTML mode; escape source/user text, preserve multilingual Unicode/Vietnamese/emoji and safe URL buttons, disable link previews. Compact list title/organization excerpts are marked with ellipses. List rounds are summarized; Details retains more evidence. Deterministic hostility/Unicode tests pass.

22. **Splitting.** Split plain text before escaping at 3,000 UTF-16 units, preserving Unicode scalars and complete HTML entities. URL buttons remain intact. Persist at most ten immutable parts below the database plan-byte bound. Initial ready times preserve part order; concurrent early successors defer, failed/uncertain predecessors cancel definitely unsent successors.

23. **Projection/RPC changes.** Six narrow invoker RPCs: `rr_receive_telegram`, `rr_execute_interaction`, `rr_browse_interaction`, `rr_commit_interaction_reply`, `rr_begin_interaction_send`, `rr_finish_interaction_send`. Eighteen private tables and restrictive grants/RLS remain; twenty-one backend public RPCs total. No broad direct table access or second outbox.

24. **Migrations/types.** Three forward migrations applied only to the verified isolated development target. Reviewed plans: `7623f9912b8f498c934c8675f462862593cfe1b00f8af73cd8354e544d2bf272`, `1a0c0cde5ec3a1bad0ba0fc15ac92d766919698e26d51478f2f301acb160b310` and `2a0600939bc860ddd2e0e96f148b1bbadbbd543538602a9fbbf74a3becd6f326`. All reapply as exact-history no-ops. Ten migrations total. Actual Supabase CLI type generation passed; existing migrations were never edited. Final no-pending plan: `bb1ca3a42518ef0735632cc29657b4db5dbbe78574be7f24d253cbf54b4477af`.

25. **Mock Bot API.** Injected deterministic fetch supports only sendMessage and answerCallbackQuery. Fixture transport has success, 429, permanent failure/forbidden, timeout and server-failure modes. It cannot call setWebhook or a live Telegram endpoint. Normal tests have no network/environment grants.

26. **Successful send.** Passing unit/SQL tests persist definite sent message IDs losslessly and complete matching part/task. Runtime additionally checks successful response bot/chat identity.

27. **Rate limit.** Definite 429 rejection persists retryable failure plus Retry-After and a future available_at under the existing three-claim/expiry budget. No immediate transport retry loop.

28. **Permanent failure.** Definite 400/401/403/404 become terminal permanent failures. Forbidden/authentication failure disables the target. Never echo Telegram error descriptions.

29. **Ambiguous send.** Timeout/disconnect/unclassified 5xx/malformed success response become uncertain, with no automatic replay. Unknown outcomes do not release claims or create a replacement logical reply.

30. **Crash windows.** Attempt creation precedes external IO. A failed outcome write leaves sending unresolved; expired-lease recovery quarantines it as uncertain. SQL and deterministic crash-marker tests pass. The same policy applies whether the process disappeared before dispatch or after a possible visible send; no exactly-once claim.

31. **Command replay.** Stable command reply key is the inbox task UUID. Effect journaling protects profile/feedback/refresh changes across the effect-to-reply crash window; atomic reply/completion closes the remaining logical-reply window. Uncertain sends cannot make a duplicate update eligible again.

32. **Hosted integration.** Isolated development `research-bot` / `ihxoffjtrtyxgctcfgmy`, PostgreSQL 17.11, actual identity/TLS/auth/data/history/schema/receipt/lock guards. `db:verify` passed 140 SQL assertions, ten query plans, concurrent clients, no-op reapply, scoped cleanup and actual type generation. Focused `test:telegram` passed 52 actual HTTP assertions with mocked Bot API. Final `test:integration` passed **177 assertions**: core 24, SIGMOD 13, conference coverage 15, Bath 12, CERN 10, funding 14, journals 19, four-family isolation 18, Telegram 52. All nine application receipts match final inputs and development identity; final inventory contains no application data.

33. **Security tests.** Passing deterministic method/body/JSON/content-type/secret, numeric ID, unauthorized user, private/group/mismatched chat, wrong callback sender/bot, malformed callback and no-private-construction probes. SQL tests pass grants, stale fences, original-message/copy protection and same-target rebind rejection/cancellation. Focused actual HTTP tests pass cross-profile/target, forged/copied/stale callback and anon/authenticated denial. Multilingual profile patches are also byte-bounded so permanent oversized input cannot become a retry storm.

34. **Unit/contract results.** Standalone `deno task test:unit`: 102 passed; `deno task test:contract`: 36 passed. Five target/credential guard tests pass through check. `deno task check` passed formatting/lint/types/boundaries, tests, documentation and credential scan on final runtime inputs. Pinned host launcher: `npx.cmd --yes --package deno@2.9.6 --package supabase@2.122.0 deno task <task>`. RTK unavailable; ordinary commands used without claimed filtering or global installation.

35. **Manual mobile review.** [Synthetic rendering artifact](phase07-rendering.txt), generated by `deno task telegram:preview`, reviewed at 38 columns: concise/excerpted long title, organization/type, exact/date-only/rolling/conflicted rounds, relevance, source link, desired-state buttons, pagination, multilingual text, saved empty state and incomplete-profile guidance. This is mock text, not a live Telegram screenshot. No real test bot was used.

36. **Cleanup.** Completed SQL verifications remove/roll back all scoped fixtures and restore pauses. Failed diagnostic HTTP runs also cleaned their owned rows. Final full integration restored both pause flags and independently inventoried zero application data. The nine-receipt audit passed against final inputs, exact development ref/class and cleanup. Migration/type/reference state remains. No reset/truncate, production data or unscoped deletion. Private operator configuration, receipts, diagnostic logs and audit script remain ignored.

37. **Files changed.** Telegram adapter/use cases/composition, worker task dispatch, enabled-type gate, bounded body helper, actual generated types, three migrations, three SQL suites, unit/contract/hosted Telegram tests, synthetic fixtures/mock transport, preview generator/artifact and guarded task/tooling updates. Exact final Git file inventory is recorded after validation below.

38. **Documentation.** Updated roadmap, changelog, Phase 07 spec, architecture/database, deployment/operations/testing/workflow and README status; added [Telegram runbook](../TELEGRAM.md), ADR 0012, mobile preview and this report. Historical ADRs/reports remain unchanged.

39. **Architecture deviations.** No new platform/table/public schema, ingestion redesign, scheduler or ranking calibration. ADR 0012 concretizes the allowed narrow query/RPC boundary, existing inbox effect journal and notification snapshot token storage. Snapshot cap/expiry are explicit tradeoffs. Forward corrections preserve old migrations and current conservative delivery policy.

40. **Unresolved risks.** No Phase 07 exit blocker remains. Production gateway/latency/Edge resource measurements, supplied personal profile/source suitability, current source rights, DNS limitations, plan/backups/restore and real Telegram operation remain Phase 10 gates. Scheduled recovery and uncertain-send resolution tooling belong to Phase 09. Snapshot browsing is intentionally capped at 100 IDs and three slots/page. No production reliability claim follows from mocks/isolated SQL tests.

41. **Phase 08 readiness.** Do not activate Phase 08 here. First close every Phase 07 gate, review this diff/report and create a clean committed baseline only with separate commit authorization. Then obtain explicit Phase 08 activation; reread current contracts/spec/ADRs/generated types; reverify the isolated target; obtain actual researcher-supplied preferences/calibration fixtures; preserve deterministic exclusions, private schema, callback ownership, inbox/outbox/replay/uncertainty behavior. No LLM, schedules or production activation is implied.

42. **Recommended commit.** `feat(telegram): add secure durable commands callbacks and reply delivery`. Recommendation only. No commit, push, deployment, real webhook registration, live send or Phase 08 work is authorized/performed.

## Exact checks and evidence

| Command / review | Result |
| --- | --- |
| `deno task check` | Passed: format, lint, types, inward imports, five guards, 102 unit, 36 contract, docs and credential patterns. |
| `deno task test:unit` | Passed standalone: 102. |
| `deno task test:contract` | Passed standalone: 36. |
| `deno task db:plan` | Passed: development identity, no application data, ten exact migrations, pending none. |
| `deno task db:verify` | Passed: 140 SQL assertions, ten plans, real concurrent clients, no-op reapply, cleanup and actual hosted type generation. |
| `deno task test:telegram` | Passed focused: 52; same suite passed again on final inputs through full integration. |
| `deno task test:integration` | Passed final frozen run: 177 assertions and final empty-data inventory. |
| `deno task telegram:preview` | Passed; manual 38-column text review recorded above. |
| Documentation validator | Passed across 48 Markdown documents, phase/status contracts, ADRs, links, fences and whitespace. |
| `deno task secrets:scan` | Passed; no matching credentials printed. Local secrets/receipts are ignored. |
| `git diff --check` / staging review | Passed; 48 intended files, nothing staged, HEAD/root/branch unchanged. |
| Receipt/input audit | Passed: all nine final application receipts match their actual hash recipe and development identity. |

Final source/application input SHA-256: `bef0b3a2048398c49d2cd4c164a972f5543de902a39671f554e318305ef1d23c`. Core's separate TS/JSON/SQL recipe: `eeaecc78e439517d142f8fbaea9d4205e78c04d68963a5a9da094f4e8fbd134f`. Telegram receipt: `2026-10-30T04:08:31.346Z`, 52 named assertions, mock transport and cleanup true. SQL receipt: `2026-10-30T03:51:32.721Z`; schema fingerprint `0a125bc224392f762cf0f8f3d781c625ece241a9f47d1d7bce00422b905d20b7`; verification-suite hash `8cceceb049c2ec0ee4ce33f155b66a4181fda1195ce4a226d689dbfd727830d8`.

Diagnostic failures were resolved and rerun, not counted as passes: one SQL fixture omitted required fingerprint_version; the first HTTP workflow exposed the existing client incorrectly attaching a body to successful HTTP 204 RPC responses. A focused contract test reproduced that failure before the client fix and passes afterward. Final review also byte-bounded multilingual profile patches; an in-flight integration run then failed its input-stability guard, cleaned up, and was repeated with frozen inputs. The final full run and receipt audit pass. No test limit, authorization, SQL history, or isolation gate was weakened.

## Changed-file inventory

48 files: 22 modified tracked files and 26 new files. All are unstaged. Ignored operator target/credentials/CA/receipts/logs are excluded.

```text
ARCHITECTURE.md
CHANGELOG.md
DATABASE.md
DEPLOYMENT.md
OPERATIONS.md
PLANS.md
README.md
deno.json
docs/DATABASE_WORKFLOW.md
docs/TELEGRAM.md
docs/TESTING.md
docs/adr/0012-durable-telegram-interactions.md
docs/verification/phase07-rendering.txt
docs/verification/phase07-telegram.md
harness/build/07-telegram-bot.md
scripts/check.ts
scripts/db/main.ts
scripts/telegram/preview.ts
supabase/config.toml
supabase/functions/_shared/adapters/telegram/delivery.ts
supabase/functions/_shared/adapters/telegram/protocol.ts
supabase/functions/_shared/adapters/telegram/render.ts
supabase/functions/_shared/adapters/telegram/webhook.ts
supabase/functions/_shared/application/interaction.ts
supabase/functions/_shared/application/ports.ts
supabase/functions/_shared/application/worker.ts
supabase/functions/_shared/domain/assessment.ts
supabase/functions/_shared/infrastructure/http/bounded.ts
supabase/functions/_shared/infrastructure/supabase/client.ts
supabase/functions/_shared/infrastructure/supabase/database.types.ts
supabase/functions/_shared/infrastructure/supabase/interactions.ts
supabase/functions/_shared/infrastructure/supabase/repository.ts
supabase/functions/_shared/infrastructure/supabase/telegram-runtime.ts
supabase/functions/job-worker/index.ts
supabase/functions/telegram-webhook/index.ts
supabase/migrations/20261030000100_telegram_interactions.sql
supabase/migrations/20261030000200_reply_order_and_binding.sql
supabase/migrations/20261030000300_projection_lifecycle.sql
supabase/tests/database/07_telegram_interactions.sql
supabase/tests/database/08_reply_order_binding.sql
supabase/tests/database/09_projection_lifecycle.sql
tests/contract/telegram_test.ts
tests/fixtures/telegram/cases.json
tests/fixtures/telegram/message.json
tests/integration/telegram.ts
tests/telegram_support.ts
tests/telegram_transport.ts
tests/unit/telegram_test.ts
```

