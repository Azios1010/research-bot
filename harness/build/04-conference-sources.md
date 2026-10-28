# Phase 04 — Conference, workshop and conference-CFP sources

## Goal

Prove the real source-adapter contract with structured conference data and close event/workshop/standalone-call coverage using a small approved source set.

## Context

CCFDDL is the preferred initial candidate, not an unconditional dependency. Its multi-round schema and source timezone defaults require careful mapping. AI Deadlines is a comparison/fallback candidate with unverified current freshness. Do not build a broad conference crawler.

## Dependencies

03 complete, 04 active, current DATA_SOURCES review, source permission/robots/host policy decision, actual research category scope supplied or a clearly labeled nonpersonal test subset.

## Non-goals

No jobs/journal collectors, Telegram code, production collection schedule/deployment, full dataset mirror, browser automation, LLM or conference-quality recommendation engine.

## Implementation scope

**Checkpoint A:** Review current CCFDDL schema/license/host limits; choose bounded files or a measured conditional snapshot strategy; implement HTTP fetch, pure YAML parser, adapter manifest, safe links, provenance and fixture tests. Pin fixture upstream revision and retain required license notices for copied material. Benchmark realistic maximum payload and CPU locally against the known hosted budget; final hosted measurement remains a Phase 10 gate.

**Checkpoint B:** Map multiple abstract/paper rounds, main/child tracks, editions, TBD/date-only/assumed timezone evidence, withdrawn/closed data and source updates. Persist through the shared pipeline; no source branches in domain. Verify exact vs candidate identities using a second sanitized-source fixture without necessarily enabling a second live collector.

**Checkpoint C:** Produce a coverage matrix for `conference`, `workshop`, `conference_cfp`. If the first source lacks workshops/standalone calls, evaluate and implement only the smallest additional permitted structured/feed/HTML adapter needed. A conference with deadlines can satisfy CFP browsing without being duplicated as a second type; standalone CFP fixtures must still prove their distinct mapping. Each checkpoint closes before expanding scope.

## Expected files/modules

`_shared/adapters/sources/ccfddl/` or documented approved alternative, source manifests, `tests/fixtures/<slug>/` YAML/expected outputs/provenance, parser/contract/integration cases, resource measurement notes, `sources:smoke` task, source register and coverage evidence. Additional adapter only for a measured gap.

## Acceptance criteria

- An evaluated live source yields real, persisted conference data in the isolated test target, with bounded opted-in smoke checks and no notifications.
- All three type mappings have realistic fixtures and approved configured ingestion paths; do not manufacture separate opportunities to meet counts. Seasonal gaps are documented using source evidence.
- Multiple rounds, year changes, timezone defaults/uncertainty and changed deadlines survive normalization/replay without false precision or duplicate canonicals.
- Parser/fetch failure, 304, empty-valid and schema-drift cases behave differently and preserve other work.
- Permission and fixture provenance are recorded; measured local resource bounds fit the intended design or the source/scope is changed. Hosted budget confirmation is explicitly deferred to 10, not claimed passed.

## Validation commands

```text
deno task check
deno task test:unit
deno task test:contract
deno task db:verify
deno task test:integration
deno task sources:smoke --source ccfddl
```

Use the actual approved slug if CCFDDL was replaced and update this spec/register. Smoke is opt-in bounded public read and isolated persistence only, separate from deterministic suites. Document any additional coverage adapter's corresponding smoke command.

## Manual verification

Compare a small sample with upstream official event/call links. Check original versus assumed deadlines, annual homepage reuse, round IDs, countries and event dates. Inspect collection run counts and canonical/source relationships. Review license attribution, current freshness, selected discipline scope and max-size/CPU results.

## Known risks

Community errors, stale editions, YAML aliases/CPU, unstable round labels, large snapshot enumeration, GitHub rate limits, aggregators copying one another and weak workshop coverage. If permission or Edge feasibility fails, choose a smaller permitted alternative rather than a separate runtime.

## Exit criteria

All checkpoints and deterministic/hosted integration checks pass with source/coverage/resource evidence; docs updated; 04 complete, active phase none. Stop before adding research-job/funding sources.
