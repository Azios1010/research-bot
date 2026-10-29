# Product specification

## Problem

Research opportunities are distributed across conference calendars, institutional job boards, publishers, and funding portals. Formats and deadlines differ, the same opportunity is republished, and manual checks are easy to miss. A researcher needs a manageable set of relevant opportunities with accurate provenance and honest deadline information, rather than an unfiltered stream.

## Primary user

One researcher, using a configured private Telegram chat. Research interests, qualifications, geographic preferences, timezone, and notification schedule are configuration, not assumptions about the person operating this repository. One `research_profiles` row is initially enabled. Profile-scoped data allows later multi-user support without implementing registration, tenancy administration, or multiple active users now.

## Goals

- Discover opportunities repeatedly from explicitly approved sources.
- Preserve source evidence, distinguish new records from updates, and merge confident duplicates.
- Provide a daily digest, browsable lists, saved items, and useful deadline reminders in Telegram.
- Explain relevance through deterministic score components and exclusions.
- Persist feedback and support re-ranking without recollecting everything.
- Operate automatically in the existing Supabase project, with visible failures and tested recovery.
- Cover every opportunity type below before final product completion; being representable in a database is not sufficient coverage.

## Non-goals

No full-internet crawl, paper-reading assistant, application submission, CV management, collaborative workspace, public website, or generalized recommendation model. No multi-user product, separate server, paid-source bypass, or browser automation service. No LLM on every record. Phase 01 produces specifications only.

## Opportunity types

Stable initial codes are `phd`, `postdoc`, `research_assistant`, `research_internship`, `conference`, `workshop`, `conference_cfp`, `journal_cfp`, `journal_special_issue`, `grant`, and `research_funding`. A lookup table allows new types without changing a PostgreSQL enum.

A conference edition may carry submission deadlines and appear under conferences and CFP browsing without creating a second opportunity. A standalone track call can be `conference_cfp` with an optional parent conference. A special issue with a call is one `journal_special_issue`, shown in journal/CFP views. General research funding excludes records already classified as a specific grant. Do not duplicate an item merely to satisfy type counts.

Phase 05 makes two mappings concrete. A paid doctoral research placement contributing to an enrolled student's PhD is `phd` when programme/edition evidence is explicit; generic admission information or a scholarship alone is not a job. A legal Grant instrument is `grant`; research support through a Cooperative Agreement is `research_funding`. A call offering both remains one grant with both instruments preserved. These are source-evidenced categories, never claims that the researcher qualifies. A forecast is labeled separately from an accepting call; estimated dates and institutional applicant restrictions must remain visible in future browsing/notification decisions.

Coverage ownership: Phase 04 handles conferences, workshops, and standalone conference CFPs; Phase 05 handles all four position types plus grants and research funding; Phase 06 handles journals. Each source phase has sequential checkpoints so missing coverage cannot be silently pushed outside the ten-phase plan.

## Core user journeys

| Journey | Expected behavior |
| --- | --- |
| Start and configure | An allowed user starts the bot in a private chat, sees help, and configures a valid profile. Unknown users cannot read data or trigger work. |
| Daily discovery | At the configured local time, receive at most one logical digest with up to ten newly eligible opportunities, reasons, deadlines, and original links. A long digest may occupy multiple persisted message parts. |
| Browse | Use commands to inspect current opportunities with stable pagination and details; show collection freshness and incomplete coverage. |
| Deadline planning | View upcoming application, abstract, submission, and other labeled deadlines. Unknown or date-only deadlines are clearly marked. |
| Decide | Save or ignore an item using buttons; actions survive restarts. Saved items remain accessible after closure. |
| Open | A direct URL button opens the source. An optional tracked Open action records intent before returning a URL; direct clicks cannot be observed. |
| Refresh | Request a bounded asynchronous refresh, receive an acknowledgement and inspect its run status. Repeated requests coalesce and are rate limited. |
| Recover | `/status` reports source health, worker backlog, latest successful runs, and delivery problems without secrets or raw payloads. |

## Functional requirements

| ID | Requirement | Owning phase |
| --- | --- | --- |
| FR-01 | Collect using a shared adapter contract, cursors, conditional requests when supported, and independently testable parsers. | 03-06 |
| FR-02 | Normalize all supported types, provenance, locations, qualification evidence, and multiple deadline rounds into one domain. Reject or quarantine malformed records individually. | 02-06 |
| FR-03 | Resolve deterministic identities atomically across sources, preserve conflicting evidence, and avoid merging different editions or tracks. | 02-03 |
| FR-04 | Implement `/start`, `/help`, `/today`, `/deadlines`, `/conferences`, `/jobs`, `/journals`, `/saved`, `/profile`, `/refresh`, `/status`. | 07-08 |
| FR-05 | Support Save, Unsave, Ignore, Undo Ignore, details, pagination, and tracked Open intent through authorized callbacks. | 07 |
| FR-06 | Filter and score against a versioned profile, record reasons and rule version, and re-rank after relevant changes. | 03, 08 |
| FR-07 | Automatically create daily digests and deadline reminders with durable deduplication and bounded retries. | 09 |
| FR-08 | Permit source disabling, safe refresh/retry, and inspectable operational history. | 03, 07, 09 |
| FR-09 | Deploy migrations, functions, secrets, Cron, and a verified live Telegram webhook; retain an end-to-end release record. | 10 |
| FR-10 | Demonstrate a collection path and parser fixtures for every supported type; explain seasonal absence using real source evidence. | 04-06, 10 |

`/today` is an on-demand view of current eligible items, ordered by relevance and limited to a documented recent window (initially seven days since first seen). It does not mark items delivered or consume the daily digest. `/deadlines` defaults to the next 30 days. `/jobs` includes the four position types. `/conferences` includes conferences, workshops, and standalone conference CFPs. `/journals` includes both journal types. Grants and funding appear in `/today`, details, `/saved`, and `/deadlines`; a separate funding command is optional future scope.

Upcoming events remain browsable after their submission deadlines, with submission availability labeled separately. Positions/funding/standalone calls can close when all known actionable rounds have elapsed; events close on explicit closure/cancellation or their known event end, not merely a paper deadline. Unknown/rolling evidence never becomes an invented expiration.

## Notification behavior

- Proposed initial digest schedule: 08:00 in the profile's confirmed IANA timezone, maximum ten items and one digest per local calendar date. No timezone or interests are seeded from the workstation. Setup is incomplete until the researcher supplies them.
- An eligible opportunity enters its first digest once per profile. A new source observation or score change alone cannot resend it. Explicitly configured material-update notices are deferred beyond Phase 10; the first release shows changes through browsing and deadline revisions.
- First automatic digest uses a seven-day first-seen window. Older imported items remain browsable. Unsent eligible items in that window can fill subsequent days; ignored, withdrawn, expired, or newly excluded items cannot.
- No empty daily message by default. Persist a `skipped_empty` notification for schedule accounting. `/status` still distinguishes no matches from broken collection.
- Reminders default to 7 and 1 days before each selected current actionable deadline (application, abstract, submission, registration by default), only for saved and non-ignored items. Save never overrides explicit ignore or withdrawal. On each tick, recheck that the deadline is current and not passed.
- Reminders use the profile's digest local time. For an instant deadline, convert it to the profile timezone and subtract the offset in calendar days; for a date-only deadline, use its published calendar date minus the offset as a labeled advisory in the profile timezone. Saving after an offset's six-hour window does not backfill that reminder; the next valid offset can still fire. Rebinding a chat never creates a second logical digest/reminder.
- Date-only deadlines get a local-date advisory with an uncertainty label. Unknown dates get no scheduled reminder. An inferred time is never presented as an official closing time.
- One reminder per deadline revision and offset. Deadline changes supersede unsent reminders; already sent messages remain historical facts. Revised deadlines may generate new reminders, labeled as revised.
- Recovery catches a missed digest within 24 hours of its due instant, anchored to its original local date. Older digests are skipped. Reminders have a 6-hour delivery window and are never sent after the relevant deadline; late windows are skipped, not burst-delivered.
- Retries that may have already reached Telegram enter an uncertain state. The system cannot promise exactly-once external delivery. See ARCHITECTURE.md and OPERATIONS.md for the explicit recovery policy.
- Recheck eligibility before each message part enters sending. A later Ignore/profile change may arrive while a message is already in flight; it suppresses subsequent sends. Cancel a definitely unsent part that now contains an ineligible item, retaining visible partial-delivery accounting and releasing only that part's claims.

## Ranking behavior

Always run deterministic exclusions, then score, then limit the shortlist, then optionally apply an LLM. Unknown eligibility produces a visible warning unless the user explicitly configures exclusion for unknowns. Known disqualifying evidence can exclude. Blocking rules and ignore state override positive signals. Saved items are a navigation/reminder state, not automatic proof of relevance.

The initial deterministic score is explained and versioned in ARCHITECTURE.md. Phase 08 calibrates it using a researcher-reviewed fixture set. Optional LLM integration is deferred beyond Phase 10 unless a later authorized phase adds it. No provider credentials are necessary for the planned ten phases.

## Non-functional requirements

| Area | Initial acceptance target, to measure rather than claim |
| --- | --- |
| Correctness | Zero duplicate canonical opportunities for identical strong identities under concurrent replay tests. No silent loss of valid siblings when a record is malformed. |
| Interaction | Webhook durably accepts a valid update within 2 seconds at p95; common query replies reach Telegram within 5 seconds at p95 during measured normal operation, excluding Telegram/network outages. |
| Collection | Approved sources checked at their configured cadence; initial daily cadence and warning after two missed cadences. No claim of complete internet coverage. |
| Delivery | During a seven-day production observation, each due nonempty digest is delivered or has a visible failed/uncertain/skipped outcome; no unexplained missed day. Target delivery within 15 minutes of due time under normal operation. |
| Efficiency | Bounded pages, response sizes, retries, and work per invocation; measured fit on the actual Supabase plan before activation. |
| Maintainability | Domain is framework independent; every source has offline fixtures; dependency versions and ranking rules are reproducible. |
| Persistence | Opportunities, feedback, leases, inbox/outbox, and schedule keys survive function redeployment. No process memory is required for correctness. |

## Reliability requirements

One failed or disabled source cannot stop healthy sources or browsing. Enforce network timeouts, cursor commit after durable work, capped retries with backoff, per-record rejection, bounded source cooldown, and lease recovery. Cron replay, webhook replay, collection replay, and worker overlap must be covered by tests. Distinguish transport invocation success from committed business success. Retain run counts, sanitized error samples, correlation IDs, and failure classifications.

## Security requirements

Private-chat Telegram allowlist; verified webhook secret; separate authenticated internal job endpoint; no anonymous database access; RLS and restricted RPC grants; server-only Supabase privileged keys; secrets in Supabase secret storage and Vault where Cron needs them. Escape Telegram text, validate external URLs, bound parsers and callback inputs, prevent source-controlled network destinations, and redact credentials and user payloads from logs. Source rights and robots checks are onboarding gates, not inferred from public visibility.

## Success criteria

The researcher can find relevant items with explanations, inspect sources and uncertainty, persist decisions, and receive useful reminders. Every required category has an approved collection path. Source and delivery failures are visible and recoverable. Operational effort is small enough for one researcher: routine checking through `/status` and Supabase dashboards, with no process to keep running locally.

## Definition of Done for the final product

- All ten phases meet their recorded acceptance and validation gates.
- The real existing Supabase project contains reviewed migrations, deployed functions, configured secrets and authenticated Cron jobs.
- A real bot receives commands by webhook from the configured researcher and rejects unauthorized callers.
- Live approved sources produce persisted, normalized results; fixture-backed coverage includes all eleven type codes and multi-deadline examples.
- A real daily digest, a controlled real deadline reminder, Save/Ignore/Open intent, browsing, refresh, and status are verified end to end.
- Seven consecutive days of unattended operation are recorded, including schedule accounting, source freshness, notification outcomes, and measured resource use. Any unresolved failed/uncertain outcome prevents sign-off until disposition is documented.
- Replay, timeout, partial failure, deployment rollback, secret rotation, and database recovery procedures have been exercised safely in the appropriate environment.
- No credentials are present in Git or logs. Anonymous/authenticated Data API access and unauthenticated function access fail the documented security probes.
- The runbook, cost/plan assumptions, limitations, backup/recovery evidence, and release evidence are current. A demo or passing unit suite alone does not satisfy completion.
