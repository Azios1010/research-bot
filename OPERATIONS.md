# Operations model

## Status and ownership

The Phase 03 worker exists locally and is tested with an isolated hosted database; no function/schedule is deployed. It handles only collection pages and baseline assessment batches. Fixed log events cover task start, page counts, assessment count, sanitized failure, lost lease and invocation completion. Correlate source/run/task IDs and page sequence; payloads, URLs, keys and profile contents are excluded.

For failed verification, inspect the named assertion or sanitized code. Cleanup removes only fixture UUIDs and restores collection pause in `finally`; interruption can leave fixtures, causing the next target inventory to refuse writes. Review those IDs for scoped cleanup; never reset/truncate or bypass the guard. `source_disabled` cancels collection, `lease_stale` stops writes, and `reconciliation_stale` permits one bounded re-read before durable retry. PT409 business conflicts replace the original 40001 choice to avoid a platform retry loop; SDK retries are disabled. Partial pages with durable good siblings are degraded successful source checks, distinct from transport/document failure.

Repeated PT409 can indicate competing provenance updates as well as changed facts; do not bypass evidence tokens or blindly resubmit old proposals. Conditional validators must not be manually copied across configuration/parser revisions or interrupted snapshots. Current read RPCs enforce these bounds; preserve that behavior when adding a source.

This is the future runbook for a single operator/researcher. Commands and status queries below describe use cases, not tooling already installed. Phase 09 makes the checks executable; Phase 10 exercises them on the verified deployment. During Phase 01, do not connect, rotate anything, register a webhook, or configure Cron.

Phase 02 database planning/verification tools and their isolated hosted [evidence](docs/verification/phase02-database.md) exist as described in [database workflow](docs/DATABASE_WORKFLOW.md). Migrations, SQL/concurrency/query-plan checks and scoped cleanup ran only on the development target; collection/delivery remain paused. Production collection, scheduling, Telegram operations and uncertain-send resolution remain later-phase work. Local `.env`, target config, optional CA and verification receipt stay ignored by Git.

The operator uses `/status` plus Supabase database, Edge Logs, Cron and function dashboards. Telegram cannot report an outage of its own channel; check Supabase monitoring independently. Initial routine: inspect freshness/backlog daily and review source quality/permissions and costs monthly. Final cadence is confirmed in Phase 10.

## Health signals

| Signal | Healthy interpretation | Investigate when |
| --- | --- | --- |
| Source freshness | Successful or unchanged run inside two configured cadences. | More than two cadences missed, three failed runs, repeated parse errors or new cooldown. |
| Collection accounting | Stable page cursor, accepted/rejected counts consistent, useful yield. | Partial/failed terminal run, stuck running heartbeat, >80% unexplained yield drop, conflicting identities/deadlines. |
| Work backlog | Queued tasks drain; no expired active lease remains unrecovered. | Oldest ready task >5 minutes during normal operation, repeated lease expiry, attempts exhausted. |
| Cron | Ticks execute and produce expected committed tasks/outcomes. | Missing two expected ticks, HTTP auth failures, successful Cron invocation without business progress. |
| Notifications | Expected local-date digest accounted for; reminders complete or explicitly skipped. | Due digest >15 minutes late, partial/failed/uncertain send, unclassified part stuck sending. |
| Telegram ingress | Verified update receipt and command outcome; backlog small. | Webhook errors/pending count rise or no commands can be processed. |
| Data quality | Provenance and explicit uncertainty, few quarantines. | New null/type/date patterns, reused URLs, bad links, implausible deadlines or growing duplicate flags. |
| Resources | Measured runtime, response sizes and database growth within plan. | CPU/wall-time kills, memory pressure, quotas, expensive queries or unexpected invocations. |

All thresholds are initial project targets, not measured availability claims. Errors must identify source/run/task/stage IDs and sanitized reason codes. Logs are diagnostic; durable rows are the source of truth for committed work and delivery.

## Monitor collection runs and inspect errors

1. Find source slug and recent `collection_runs`; compare status, timestamps, version, cursor, records_seen/accepted/rejected and capped error samples.
2. Trace the run/task correlation ID in Edge Logs. Check fetch timeout/status, rate limiting, parser/document shape and lease expiration without logging full source bodies.
3. Inspect quarantined/conflicting `source_records` and their bounded sanitized evidence. A malformed record should not eliminate valid siblings.
4. Distinguish valid empty result, 304 unchanged, incomplete pagination, document-wide parser failure, and endpoint unavailability. Never clear errors simply by calling a failed parse “zero matches.”
5. If data unexpectedly disappeared, pause withdrawal inference and affected reminders; do not bulk-close opportunities on absence from a partial feed.

## Retry a failed source

First classify the error. Retry transient network/rate-limit/server errors within the capped attempt budget and provider Retry-After. Do not automatically retry persistent 401/403, changed markup/schema, invalid configuration or rights/robots restrictions. Fix the adapter/config with fixtures before enabling it again.

Use the normal refresh/retry use case with an explicit source and request key. It must coalesce with an active run and resume a committed cursor safely. Do not edit unique identity rows, reset attempt counts indefinitely, or delete a run to make the dashboard green. After retry, confirm counts, source health and any new canonical revisions; ensure other sources continued while it failed.

## Disable or re-enable a source

Set `sources.enabled=false` through the validated operator operation, record reason and time, cancel queued work, and have leased workers recheck enablement before fetching/committing a new page. Preserve source records and canonical opportunities. Manually disabled is different from automatic cooldown and must not be undone by a health retry.

Re-enable only after source review/parser tests and a bounded verification run. Check URL/host allowlist, rights/robots, cadence, useful yield and provenance. Never enable a new endpoint merely by inserting arbitrary executable configuration.

## Check Cron and scheduling

Inspect `cron.job`, `cron.job_run_details`, the HTTP invocation response where retained, then the application task/run/notification rows. A successful SQL call to `pg_net` only proves enqueueing an HTTP request. It does not prove authorization, collection completion, or message delivery.

Verify Vault entry presence and internal secret compatibility without printing decrypted values. Check UTC ticks and profile-local due calculations, schedule key uniqueness, pause flags, work expiry and backlog. Recover missed jobs through the same dispatcher rather than creating ad-hoc sends. Digests recover only within 24 hours of their due instant; reminders use a six-hour window and never send after deadline. Repeated ticks must not create new logical keys for the same scheduled work.

Reminder due time is the profile's digest local time on its profile-local deadline date minus the configured offset. Date-only evidence uses its published date with an advisory label. A newly saved item does not backfill an offset whose window already closed. A changed chat binding cannot create another digest/reminder key; freeze or safely cancel definitely unsent prepared work before rebinding.

## Inspect Telegram failures and uncertain sends

Check `notifications`, ordered part state, `notification_items` claims and `notification_attempts`. A definite permanent rejection (for example a blocked bot or invalid destination) pauses that destination and exposes a status problem. A definite rate-limit rejection schedules a bounded retry using Retry-After. Redact Bot API URLs because the bot token appears in the path.

A timeout, request dispatch ambiguity, unclassifiable server error, or crash after `sending` is **uncertain**, not safe retry. Do not delete its notification or release its claims. At initial settings, wait at least the 90-second lease, maximum hosted worker lifetime, and outbound timeout beyond the last attempt start before resolution; Phase 10 replaces this formula with the measured plan-specific bound plus safety margin. Also ensure no old invocation remains active. This matters because an expired worker cannot be fenced at Telegram itself.

Then inspect the authorized chat and recorded response/message IDs, where available. Telegram does not provide arbitrary chat-history reconciliation to bots. Choose and record one disposition:

- Evidence confirms receipt: mark resolved delivered and preserve the evidence/message ID if known.
- Receipt cannot be established and duplication is unacceptable: abandon the part, retain claims and a visible missed/uncertain outcome.
- The operator explicitly accepts duplicate risk: authorize a controlled resend as a new attempt after the safe window, preserve the original uncertain attempt and claims, and label the operation in the audit trail.

This is the only path to resend an uncertain part. A routine source refresh, application redeploy, Cron replay or lease reclaimer must not do so. For partial digests, retain already sent/uncertain parts and schedule key; only definitely unsent parts are eligible for normal retry/revalidation. Do not rebuild an entire partially delivered digest.

## Telegram webhook incidents

Use `getWebhookInfo` to inspect configured URL, pending count and last error. Verify the deployed function's secret/JWT configuration, configured sender allowlist, private-chat binding, inbox persistence and database availability. A 2xx receipt must correspond to durable accepted/rejected state, not a swallowed database error.

Duplicate update IDs should refer to one accepted task. Out-of-order distinct updates remain processable. Do not clear inbox tombstones or use a high-water update ID to recover. Roll back incompatible handler code promptly; Telegram's retry/retention window is finite. Never routinely drop pending updates. See [DEPLOYMENT.md](DEPLOYMENT.md) for lifecycle and rotation.

## Rotate secrets

Rotate bot token, webhook secret, internal job secret, source credentials and backend database credentials independently. Use secure provider/Supabase interfaces; never echo or copy values into scripts, migrations, logs or issue descriptions. Validate presence and an authenticated request instead of reading values back.

For webhook/job secrets, deploy short dual acceptance, change the sending side (Telegram or Vault), verify new credential use, then remove the old value. For backend credentials, verify key format and all consumers, update Edge configuration, check database calls, then revoke the old key. For an actual leak, disable affected ingress/work and revoke promptly; preserve redacted incident evidence and investigate access. Do not invent a custom automatic key-rotation service for this one-user system.

## Recover from a broken deployment

1. Set delivery/collection pause flags as appropriate; disable named Cron jobs if dispatch is broken. Preserve database data and webhook inbox/outbox.
2. Identify last compatible function version and migration boundary. Roll back code while retaining additive schema. Do not edit applied migrations or reset production.
3. Inspect leases and all `sending` attempts. Apply the ambiguity policy before resuming delivery; a redeploy is not proof the prior send failed.
4. Re-run readiness/auth checks, a bounded source fixture/live check as appropriate, and a controlled command. Resume sources first, then notification preparation/sending, then normal schedule.
5. Record incident cause, affected runs/messages, recovery and any missing/duplicate effects. Add a meaningful regression test for the actual failure.

Database loss/corruption uses verified backups restored first into an isolated target where possible. Validate schema/RLS/grants, identities, feedback, inbox tombstones and notification claims. A restore may rewind deduplication state while Telegram retains messages: keep sends paused and reconcile the recovery interval before resuming. Initial recovery objectives are <=24-hour data loss and <=4-hour operator recovery, validated in Phase 10. The actual plan/restore procedure, storage location and owner must be recorded there.

## Validate data quality

Sample each approved category and compare to the original official source. Inspect title/organization mapping, duplicate editions/tracks, timezone basis, multiple deadlines, explicit/unknown eligibility, event dates, original/canonical links, topic tags and lifecycle status. Track rejection rate and unknown critical fields by source rather than treating total row count as success.

For suspected duplicates, inspect source keys/strong identity evidence and candidate fingerprints. Never auto-merge on title similarity alone. A real conflict can require a reviewed corrective migration/RPC; preserve redirect IDs and user/notification history. Do not merge away a sent reminder or saved item without reconciling references.

## Maintenance and release evidence

Phase 09 implements bounded retention jobs: 90-day run/attempt detail, 30-day quarantine snapshot, seven-day Telegram action payload cleanup, preserving durable deduplication keys/outcomes and user decisions. Pruning must not make an old update/digest eligible again. Review index usage, table growth, source permissions, dependency updates and resource cost monthly.

Initially redact expired details while retaining small referenced run/attempt headers, source identities and unresolved-send evidence. Do not physically delete FK targets to satisfy retention dates; archive/deletion strategy is deferred until measured volume requires it.

Each release/incident record contains date, revision/version, redacted target identity, validation evidence, affected source/task/notification IDs, manual checks and unresolved limitations. Production sign-off requires seven days of observed unattended operation and disposition of every failed/uncertain required delivery; dashboard green alone is insufficient.
