# ADR 0004: Shared Opportunity domain with separate observations and user state

Date: 2026-10-28

Status: accepted

## Context

Jobs, conferences, calls and funding share relevance, provenance and deadline behavior, while one listing can be observed in several sources and have multiple rounds. Scores, saves and deliveries vary by profile/channel rather than by canonical item.

## Decision

Use one Opportunity model and a type lookup with validated per-type attributes. Keep source records, strong identities, deadlines, assessments, feedback/current user state and delivery history in related tables. Use typed columns for common query/constraint fields and bounded JSONB for variable evidence. Canonical URLs and candidate fingerprints are not unconditionally globally unique. Deterministic identity resolution is primary; deadline changes do not change identity. Implement schema in 02 and domain/reconciliation in 03.

## Alternatives considered

A separate table/pipeline per source or opportunity type fragments deduplication and Telegram behavior. A single wide row with saved/notified/score fields conflates recipients and observations. Putting everything into JSONB sacrifices constraints and useful queries.

## Consequences

Some reads join/project several tables. Core fields remain understandable; source-specific assumptions stay in adapters. Profile keys preserve future multi-user feasibility without provisioning multiple users now. Full history/ontology systems are deferred beyond Phase 10 because snapshots plus run/notification evidence meet initial needs.

## Validation

Fixtures must cover all eleven types, multiple sources/rounds, annual reuse, null/unknown dates, changed deadlines and save/ignore behavior. Concurrent identity claims and notification references must survive replay. See [database design](../../DATABASE.md).
