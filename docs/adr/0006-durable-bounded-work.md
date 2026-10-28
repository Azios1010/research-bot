# ADR 0006: Durable bounded work and explicit delivery ambiguity

Date: 2026-10-28

Status: accepted

## Context

Cron/webhook retries, function timeouts and redeployments are normal failure modes. Database uniqueness alone does not coordinate a multi-step page or an external Telegram send. An expired worker can still be alive and an external HTTP request can succeed without its response being recorded.

## Decision

Use a small PostgreSQL task table, transactional inbox/outbox, stable request/claim keys and fenced leases. One source page is one bounded task; cursor/accounting/continuation commit atomically. Cron dispatches due work and drives recovery. Persist a sending attempt before external IO. Definite failures have capped retries; uncertain sends are quarantined for conservative operator resolution rather than automatically replayed. Schema primitives start in 02, execution in 03/07, schedules and recovery in 09, live validation in 10.

## Alternatives considered

Process-memory locks and background promises do not survive workers. Redis/Celery/external brokers add excluded infrastructure. Blind at-least-once Telegram retries create unexplained duplicate notifications. A broad workflow engine is unnecessary for a handful of task kinds.

## Consequences

The system requires a few operational state tables and explicit state transitions. Fencing protects database commits but cannot fence a send at Telegram; an uncertain attempt can need human disposition. Notification guarantees are stated honestly. Source failures remain isolated; operators can inspect and recover work without resetting canonical data.

## Validation

Concurrency, stale lease, crash windows, duplicate ticks/updates, partial digest, rate limits, network ambiguity and restored-database replay are required scenarios. Phase 10 records the plan-specific safe resolution window and end-to-end evidence. See [transaction contracts](../../DATABASE.md) and [runbook](../../OPERATIONS.md).
