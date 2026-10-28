# Phase 09 — Automation and reliability

## Goal

Implement Supabase-native due-work dispatch, daily digests, reminders, durable retries and operational recovery without activating production schedules.

## Context

Core/source/UI/profile paths exist. Automation must compose those use cases, not embed collectors in Cron SQL or rely on long-running workers. Scheduled invocation success differs from durable business completion.

## Dependencies

08 complete, 09 active; tested leases/inbox/outbox/notification adapter; isolated hosted database and fake Bot API; actual project baseline/limits available for schedule design.

## Non-goals

No production Cron activation, production migration/function deployment, real daily sends, new source, external queue/worker, uncontrolled retry loop, LLM or broad workflow engine.

## Implementation scope

- Implement authenticated `job-dispatch` and extend `job-worker` for fixed task kinds. Reject wrong/missing internal secret before privileged work. Use Cron/`pg_net` definitions with Vault lookup; keep production definitions inactive and secrets out of SQL.
- Dispatch logical jobs independently: per-source daily cadence, changed/daily assessment refresh, local-time digest, reminder windows, outbox sending and daily maintenance. Initial infrastructure ticks: dispatcher and worker once per minute; keep concurrency/cost within measured plan. Stagger source due times rather than fetch every source per tick.
- Implement profile-local schedule keys and DST/gap/fold rules, 24-hour digest catch-up, six-hour reminder expiry, no after-deadline reminders, empty/late schedule outcomes and timezone changes without duplicate dates.
- Prepare immutable bounded digests/item claims, saved-only reminders by current deadline revision/offset, exclusion recheck and safe cancellation/rebuild of definitely unsent payloads. Respect first-seen backlog window and unsent candidate carryover.
- Complete lease reclamation/fencing, page continuation, retry budget/backoff/jitter/Retry-After, source cooldown/disable and failure isolation. Uncertain sends never re-enter normal retry; partial sends retain claims and schedule accounting.
- Add status/health queries, structured redacted logs, retention, operational pause/retry/resolve procedures and bounded manual operator tools. Require operator disposition for uncertain sends; do not introduce a dashboard product.

## Expected files/modules

`job-dispatch/index.ts`, extended worker and application scheduling/notification/maintenance use cases, inactive Cron/Vault setup scripts, guarded operations tools, scheduling/outbox RPC refinements/migrations, deterministic fake-clock tests, hosted concurrency/recovery drills, `ops:verify` task, updated OPERATIONS/DEPLOYMENT/PLANS.

## Acceptance criteria

- Repeated/concurrent ticks create one logical job/digest/reminder; source refresh and scheduled collection coalesce safely. Healthy sources continue through another source's failure.
- Local date/time, DST, outage catch-up, deadline revision, Save/Ignore, late/empty and initial seven-day window behaviors match PRODUCT_SPEC.
- Crash after source commit, expired lease, duplicate webhook/notification claim, sent-marker crash and uncertain/partial parts produce explicit recoverable outcomes, never blind duplicate sends.
- Retention preserves source/Telegram/notification idempotency keys and feedback. Status distinguishes stale, failed, partial, uncertain and empty.
- Internal function authentication, Vault/Secret separation and redaction are tested. Optional isolated scheduling drill leaves no enabled production jobs or real sends.
- Operations tasks require explicit target and source/notification identity; arbitrary SQL/URL execution is impossible.

## Validation commands

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:verify
deno task test:integration
deno task ops:verify
```

Create `ops:verify` as deterministic/time-controlled and isolated hosted drills with fake transport, never production activation. Current live platform constraints are rechecked for the final rollout in 10.

## Manual verification

Advance a simulated week through daily collection/digest/reminders; inspect due keys, claims, attempts, retry/cooldown and status. Kill a simulated worker at each transaction/send boundary and inspect recovery. Test source disable, payload cleanup and manual uncertainty resolution. Review inactive schedule SQL for Vault lookup and absence of embedded values, and rehearse the runbook on isolated targets.

## Known risks

Tick invocation 2xx mistaken for completion, DST duplicate dates, multiplied retries, task starvation, JSON part state races, record deletion removing dedup keys, and a stale sender still alive after lease expiry. Delivery ambiguity and plan-specific maximum invocation lifetime must remain explicit.

## Exit criteria

All schedule/replay/concurrency/retention/auth/recovery checks and runbook rehearsals pass; no production schedule is active; release prerequisites are concrete. Mark 09 complete, active phase none. Stop before any production deploy or live webhook change.
