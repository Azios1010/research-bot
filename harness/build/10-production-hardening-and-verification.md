# Phase 10 — Production hardening and end-to-end verification

## Goal

Deploy Research Radar to the real existing Supabase project and prove a reliable unattended Telegram bot, with evidence meeting the final product Definition of Done.

## Context

Passing local/isolated tests is necessary but not final completion. Production migrations, function authentication, real source behavior, Telegram delivery, Cron and recovery must be verified together. This phase may span multiple sessions and seven days of observation.

## Dependencies

01-09 complete; explicit production-phase activation; verified target/project permissions and repository boundary; reviewed release diff/migration plan; valid real profile/timezone/allowlist/private target; actual bot/secrets; currently approved source rights and all-type coverage; supported plan/runtime budget; backup/restore access. Missing prerequisites keep the phase incomplete, never replaced with demo evidence.

## Non-goals

No new architecture, new source expansion unrelated to a proven coverage defect, multi-user feature, LLM, UI platform, GitHub resource or unsolicited commit/push. Do not reduce acceptance to ship quickly or claim seven-day observation before it occurs.

## Implementation scope

1. Review dependencies, exposed ingress/grants, parser/input bounds, log/secret hygiene, migration compatibility and query/runtime performance. Fix concrete defects with meaningful tests; avoid speculative rewrites.
2. Inventory production read-only, establish a verified recovery point/isolated restore, confirm plan pause/quotas/backup/log retention, and resolve resource/cost issues before activation. Measure actual hosted parser CPU/memory/runtime for each enabled source; change scope/source if it exceeds platform limits.
3. Follow DEPLOYMENT.md: apply reviewed additive migrations, install secrets/Vault/config, deploy functions paused, verify backend/internal/webhook auth and anonymous denial, then execute bounded source/ranking verification.
4. Configure/register the real Telegram webhook, verify bot/user/chat binding and all commands/callbacks. Use restricted update types, observe `getWebhookInfo`, and preserve inbox deduplication.
5. Activate named authenticated Cron ticks, then delivery. Verify an actual digest and controlled actual saved-item deadline reminder end to end. Do not send an invented opportunity to masquerade as a real source result; a clearly labeled controlled test reminder may use test data but source ingestion also needs independent real evidence.
6. Exercise duplicate tick/update probes safely, source failure/disable/retry, redaction, compatible function rollback, secret rotation and recovery procedures. Database restore tests stay isolated; reconcile potential external side effects after recovery.
7. Record seven consecutive days of unattended operation, each scheduled digest accounted for and every failed/uncertain required delivery resolved or documented as a limitation that prevents sign-off. Keep code/evidence current after material fixes; restart the observation interval if a fix invalidates the reliability evidence.

## Expected files/modules

Concrete guarded release/verification tools, final config/migration/function versions, any necessary regression fixes, `docs/releases/<date>-production-verification.md`, updated DEPLOYMENT/OPERATIONS/DATA_SOURCES/PLANS/CHANGELOG, redacted evidence references. No committed secrets, personal profile dump, raw chat archive or sensitive backup.

## Acceptance criteria

- All PRODUCT_SPEC final Definition of Done items have evidence; every eleven-type coverage path is approved/configured and fixture-backed, with real source samples or seasonal absence evidence as appropriate.
- Real commands, Save/Ignore/Open intent, browse/details/links, refresh, status, digest and reminder work for the configured user; unauthorized probes are denied.
- Live function config, private DB/RLS/RPC grants, internal auth, source bounds and log redaction are verified, not inferred from local config.
- Cron invocation and committed outcomes agree; no duplicate canonical/notification effects in safe replay probes. Redeploy retains data/work and does not replay uncertain sends.
- Hosted resource/volume measurements and plan/cost/recovery assumptions are recorded; restore and rollback drills succeed without harming production.
- Seven-day observation satisfies delivery/freshness targets with no unexplained missed day or unresolved required outcome. No functioning local process is needed to keep the system running.

## Validation commands

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:verify
deno task test:integration
deno task ops:verify
deno task release:verify
```

SQL/integration/ops mutation tests remain on the isolated target. Create `release:verify` with explicit production identity and redacted readiness/outcome checks. Record exact guarded deploy, source smoke, auth-probe, webhook/Cron and controlled-send commands from the actual implementation; never paste token-bearing API URLs into evidence. A release check must not silently deploy/send.

## Manual verification

The researcher performs every core journey in the actual chat. Inspect real provenance and deadlines against official sources, save a controlled item, observe a real reminder, compare daily digest membership/claims, inspect Supabase runs/logs/Cron and source health, and verify a function redeploy preserves state. Review independent monitoring while Telegram is unavailable. Read the completed seven-day evidence and recovery/secret-rotation records as an operator who did not write the code.

## Known risks

Existing project collisions, key/gateway differences, plan limits/pausing, source permission changes, stale source data, Telegram ambiguous sends, backup rewinds of idempotency state, seasonal type coverage and passing a test environment while production config differs. Record observed limits; do not conceal uncertainty with a green checklist.

## Exit criteria

All acceptance criteria and final Definition of Done pass with actual production evidence. Mark 10 complete, active phase none, report deployment/observation/recovery results and material limitations, then stop. If a seven-day window or required manual check is incomplete, leave 10 active and record the next verification time; the final product is not done yet.
