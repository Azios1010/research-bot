# Phase 01 — Project foundation

## Goal

Turn an empty project directory into a coherent specification and engineering contract that another senior engineer can implement incrementally without redesigning the product.

## Context

Research Radar must become a real automatically operated Telegram research intelligence bot on Supabase. This phase is architecture and documentation only. Current capability claims must not imply running application features.

## Dependencies

User requirements; inspection of project contents and host instructions; public primary references for platform/source facts. No credentials, hosted changes or application dependencies are needed.

## Non-goals

No migrations, application modules, real collectors, Telegram handlers, Cron configuration, LLM integration, package installation, deployment, Git initialization, commit, push or GitHub resources.

## Implementation scope

- Specify product/user journeys, all eleven types, current versus planned capabilities and final deployed Definition of Done.
- Fix Supabase/Edge/Telegram boundaries, pipeline/ports, domain, deterministic identity/ranking, temporal uncertainty, durable work, feedback, security and failure behavior.
- Design relational entities, constraints, indexes, RLS/RPC access and JSONB rationale without executable migrations.
- Investigate source candidates and reusable datasets using primary evidence; separate confirmed candidates, unknowns and rejected/deprioritized options.
- Write deployment/operations/testing models, engineering rules, ADRs and ten bounded specifications.
- Provide a small offline documentation validator and review the handoff for contradictions.

## Expected files/modules

`README.md`, `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `AGENTS.md`, `PLANS.md`, `DATA_SOURCES.md`, `DATABASE.md`, `DEPLOYMENT.md`, `OPERATIONS.md`, `CHANGELOG.md`, `.gitignore`, `docs/TESTING.md`, `docs/adr/0000-template.md` and accepted ADRs, all ten `harness/build/*.md` files, `scripts/validate-docs.ps1`. No application source tree.

## Acceptance criteria

- Every requested document and build section exists and has project-specific decisions rather than placeholders.
- Product, domain/schema, source strategy, phase coverage, authorization, retries and notification ambiguity agree across documents.
- Every supported category is owned by a source phase and final acceptance. Unverified source facts are labeled with evidence/next gate.
- The phase execution contract prevents automatic progression, architecture drift, secret commits and false completion.
- Validation can run without Deno, Supabase, live websites or credentials. Root Git-scope issue and unavailable RTK are reported honestly.

## Validation commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-docs.ps1
git status --short -- .
git diff --check -- .
```

Apply the RTK prefix where available. `git diff --check` does not inspect untracked content; the doc validator checks new text for trailing whitespace. Inspect only project-scoped status because the current parent Git root is outside this directory.

## Manual verification

Read as an incoming engineer: identify the next active-work rule, common Opportunity model, atomicity boundaries, privacy/security rules, source uncertainties, testing target and final go-live evidence. Check Mermaid relationships and all type/phase/task names against PRODUCT_SPEC, DATABASE, ARCHITECTURE and PLANS. Ensure no implementation or external resource change was made.

## Known risks

An apparently empty Git project may inherit a parent repository; do not stage unrelated data. Candidate source readability is not permission or freshness. Documentation checks detect structure/links, not all semantic contradictions. Excess design detail must not turn into unrelated frameworks or required local infrastructure.

## Exit criteria

All required documentation and its validator pass; senior handoff review findings are resolved; PLANS records actual evidence, marks 01 complete, sets active phase to none and leaves 02-10 pending. Report the tree, decisions/model/entities/phases, open questions/risks, assumptions and exact Phase 02 readiness checklist. Stop without implementing Phase 02.
