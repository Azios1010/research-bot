# Phase 04 conference-source verification

Verified 2026-10-29. Checkpoints A, B and C closed sequentially. This is isolated development evidence, not deployed Edge/Telegram/production operation. No commit or push was made.

1. **Git baseline.** Root `D:/projects/research-bot`, branch/default branch `main`, clean initial worktree, commit `fda53e384b8fa49b59c43a9ea543b71cf2b30fbf` (`feat(pipeline): implement bounded source-neutral opportunity processing`). `origin/main` was verified at the same commit. Phase 03 was already committed/pushed. No history or parent metadata changed.

2. **Primary source.** CCFDDL, narrowly configured SIGMOD conference editions. The same provider's explicit HotOS workshop file closes workshop coverage. This is a labeled nonpersonal database/systems/ML technical validation subset, not an inferred researcher profile.

3. **Interface decision.** Direct individual YAML files were selected over the currently documented CCFDDL MCP service: one bounded GET, original evidence, immutable fixture revision, existing HTTP port, no extra protocol/cache service. MCP pagination is bounded but has service/stale-cache dependence and no documented immutable revision selector. [Decision and comparison](../sources/ccfddl.md).

4. **Upstream revision.** Inspected CCFDDL main commit `2e5a397ce3639e7464b7e7f5222c6d011517ad29`, dated 2026-10-29T04:19:08Z; schema 3.0.X, recursive tree 948 entries, not truncated. Fixtures pin that commit. Live main-file payload hashes matched the copied SIGMOD/HotOS fixtures; do not infer that the whole repository stayed unchanged. OpenReview inspected invitation mdate `1791448603689`; no immutable API snapshot selector is assumed.

5. **Permission.** CCFDDL repo/data MIT, full fixture notice retained. Fixed targeted raw reads, no GitHub UI crawling; publisher robots/terms and raw-host limitations recorded. OpenReview documents public API access, CC0 metadata and CC BY 4.0 configuration records; only sanitized public metadata is retained with attribution. API robots disallow email queries; this ID query does not use email/authentication. [CCFDDL evidence](../sources/ccfddl.md), [OpenReview evidence](../sources/openreview-calls.md). No blanket whole-site permission is claimed.

6. **Modules.** CCFDDL adapter/manifest/pure YAML guard/source mapper; scoped OpenReview invitation adapter/manifest; reviewed registry. The existing worker now composes the reviewed adapters and exact HTTP endpoints. Fake adapter remains test-only. No new SourceAdapter methods, domain branches, database tables/RPCs/migrations or live deployment.

7. **Manifest limits.** SIGMOD/HotOS: exact HTTPS raw paths, one request/page/run, 16,384 decoded bytes, 32 editions, 12 rounds/edition, 15-second timeout. OpenReview: exact invitation ID/query, one request/page/run, one record, 65,536 decoded bytes, 15-second timeout. Proposed cadence daily only; none scheduled. Existing HTTP has two global/one per-host concurrent requests, eight waiters, no redirects. No arbitrary config URL is accepted. Shared worker remains bounded at five tasks/45 seconds.

8. **Fixtures.** MIT SIGMOD 4,016 bytes, HotOS 1,143 bytes, largest-current-file VLDB 5,599 bytes (benchmark only). Full license and LF SHA256/revision manifest are in `tests/fixtures/ccfddl/`. `second-source.json` is handwritten official factual evidence using fake transport, not a live source. OpenReview fixture retains six public metadata/readership fields, removes workflow code/contacts/templates and has endpoint/date/mdate/checksum/rights provenance. Malformed/drift/optional/date-change cases are explicitly synthetic in-memory mutations.

9. **Resources.** `sources:benchmark` passed on Deno 2.9.6. Fifty YAML iterations: SIGMOD parse mean/max 2.78/25.38 ms, mapping max 27.57 ms, maximum observation 7,344 bytes; complete proposal about 21,247 bytes. VLDB parse 2.38/5.39 ms, mapping 25.79 ms; unlabeled monthly rounds remain ambiguous, zero invented canonical deadlines. HotOS parse 0.54/1.30 ms, mapping 0.13 ms. JSON padding at observed 4,850 bytes and hard-cap 65,536 bytes is explicitly synthetic; parse/map/normalize maxima 2.99/0.56 ms in different JIT samples. Process RSS proxy 39.0–77.5 MB. Live full OpenReview responses were 4,850/4,867 bytes, parse/map 0.90/0.14 ms, RSS proxy 88.5 MB; HotOS live parse/map 12.86 ms, RSS proxy 89.9 MB. Sizes are decoded UTF-8, not measured compressed wire sizes. These support local feasibility; hosted Edge CPU/memory/bundle confirmation remains Phase 10.

10. **Types.** One SIGMOD edition → `conference`; explicit HotOS workshop → `workshop`; one independent ICLR workshop-organizer proposal invitation → `conference_cfp`, cycle 2027, track `workshop-proposals`. Normal conference/workshop paper CFP browsing uses existing submission deadlines, not duplicate call rows. The organizer call is independently actionable and does not duplicate either collected event.

11. **Time.** Original clock/timezone evidence stays bounded in source attributes/snapshots. CCFDDL edition zones are source-default; documented fallback 23:59:59 clocks become conservative date-only values. PT uses DST-aware resolution and retains its token; explicit offsets/AoE/date-only/TBD/unknown/rolling/ambiguous time are tested. Distinct semantic kind/round keys preserve abstract/submission/rebuttal/decision. Unlabeled multiple rounds are ambiguous, never numbered from dates/indexes. Non-contiguous event dates stay raw. OpenReview's exact UTC `duedate` is distinct from later `expdate`, activation timestamps and event dates; publication stays null.

12. **Identity.** Stable upstream edition/invitation keys exclude deadlines. Cycle and genuine track differences survive. The SIGMOD/PODS shared annual root is candidate-only; only the reviewed dedicated 2027 SIGMOD research call supplies strong listing identity. Historical unknown-organization records do not gain unjustified natural-key uniqueness. HotOS 2027 uses its reviewed dedicated call. Generic/reused homepages cannot collapse years/tracks.

13. **Deadline replay.** Hosted mutation of SIGMOD 2027 round-4 paper date October 17 → October 20 retained canonical ID and deadline ID, incremented deadline revision once and canonical content revision, updated traceable evidence, and left seven source records/seven canonicals. The mutation is a test, not an upstream claim.

14. **Cross-source identity.** Sanitized official fixture merged through reviewed strong identity and applied reviewed higher-authority event-end evidence. Fingerprint-only unknown-organization candidates remained separate/flagged. Edition/track incompatibilities remained separate; no fuzzy/semantic matching. Simultaneous real HTTPS identity/task/CAS claims in the Phase 03 regression suite also passed on this schema.

15. **Coverage.** All required mappings have fixture, configured path and live ingestion evidence:

    | Type | Primary / configured path | Realistic fixtures / live rows | Seasonal and discipline gaps | Confidence / further source need |
    | --- | --- | --- | --- | --- |
    | conference | CCFDDL SIGMOD | Seven editions, 43 deadlines; fixture and live pass | 2021–2027 database systems only; 2027 paper submission closed while event upcoming | Mapping high, community accuracy limited by observed date disagreement; no further provider required for this phase |
    | workshop | CCFDDL HotOS, same adapter/provider | Four biennial editions, five deadlines; fixture and live pass | Operating systems only; biennial coverage and community update gaps | Explicit workshop semantics and sampled dates verified; no separate workshop provider needed |
    | conference_cfp | Embedded paper calls browse via event deadlines; separate OpenReview organizer call | One genuine organizer-call fixture/live row and one deadline | ML organizer call already expired; API is scoped, no broad discovery or future-year guarantee | Identity/cutoff mapping high, official deadline agreement limited; second provider was required and added |

16. **Second live provider.** OpenReview API 2 was added only for the measured independent-call gap. The official ICLR page linked the exact group, whose public metadata gave the exact invitation ID. The documented `expired=true` filter allows historical public metadata, not private access. Another CCFDDL mirror/AI Deadlines would duplicate event coverage; WikiCFP rights/interface reliability remained unresolved. No generic crawler/search ingestion/browser runtime was added.

17. **Unit tests.** `deno task test:unit`: 52 passed, zero failed. Domain remains independent of source/Supabase/Telegram/environment/HTTP. Unit fixtures require no live website, network or environment permission.

18. **Contract tests.** `deno task test:contract`: 14 passed, zero failed. Five target/credential guards also pass. Fixture licenses/checksums, registry/type limits, stable keys, conditional behavior, malformed inputs, safe YAML, metadata bounds and retry classification are checked. Dependencies are version/hash pinned; the environment-free YAML browser build avoids Node/JSR debug environment reads.

19. **Hosted integration.** Isolated development project `ihxoffjtrtyxgctcfgmy`, PostgreSQL 17.11, Deno 2.9.6, Supabase CLI 2.122.0. `db:verify` passed 100 SQL assertions, ten query plans, real concurrent clients, RLS/grants/fences, no-op reapply and cleanup. Seven immutable migrations, zero pending. `test:integration` passed 24 existing pipeline + 13 SIGMOD + 15 coverage assertions, using actual Supabase-js narrow HTTPS RPCs. SQL is setup/assertion/cleanup only. Final inventory contained no application/unrelated data.

20. **Live smoke.** All exited zero: `sources:smoke --source ccfddl` (seven assertions, 09:37:16Z); `--source ccfddl-hotos` (eight, 09:37:59Z); `--source openreview-workshop-call` (eight, 09:38:39Z). Each reads publicly upstream, creates scoped rows only on the reverified development target, collects/replays twice, never notifies, and cleans up. No production/default target fallback.

21. **Manual comparison.** Official SIGMOD 2027 call agrees on abstract/paper days and location but lists June 18 event end versus CCFDDL June 19. SIGMOD 2026 overall official interval differs from the dataset's non-contiguous main-event text; that text is not converted to an invented continuous range. HotOS 2027 official dates/location/submission/decision days agree; its branding differs from upstream's older USENIX description, and no organization is inferred. OpenReview cutoff is October 10 13:00 UTC; ICLR official prose says October 9 23:59 AoE (October 10 11:59 UTC), 61 minutes earlier; API expiry is 13:30 UTC and is not used as the deadline. Attribution/evidence remain explicit. Official pages were manually sampled, not crawled. Links and limitations are in the source decisions.

22. **Failures/drift/cache.** Timeout/abort/redirect/oversize/encoding guards, unexpected content type, retryable 408/429/5xx, permanent failures, malformed whole document, changed schema, per-record errors, unknown optional fields, unsafe YAML aliases/tags/depth and valid explicit empty cases pass. A transport/API error never becomes an empty success. SIGMOD and HotOS live replays returned 304 with zero freshly parsed records. OpenReview replay returned two 200 bodies with differing whole-response hashes but unchanged canonical IDs/content revisions; no live 304 is claimed for it. Invalid cursor transaction rolled back and retried safely; existing late transaction failure and stale-fence/concurrency regression cases passed.

23. **Persisted counts.** Across separate live invocations: seven conference + four workshop + one standalone call canonical/source observations, 49 total deadline rows (43+5+1). Second runs inserted zero. These were real persisted development samples, then removed as required; no retained production corpus is claimed.

24. **Cleanup/security.** Every suite removed only its UUID-scoped tasks/runs/observations/identities/deadlines/canonicals/sources and restored pause state. Reference/migration state survives. Notifications/profiles created by new conference paths: zero. Final inventory: no application data. No secret printed/committed; `.env` and private target/CA/receipts are ignored. Schema fingerprint unchanged: `f64c621637966fe7e60ae486662f6eb6cbff5e21f99687de29545410a968e7d1`.

25. **Files.** The complete changed-file list is below. Generated database types were regenerated from the actual hosted schema and have no content diff. No migration or database contract file changed.

26. **Documentation.** Source register, two source decisions, architecture's concrete source/budget behavior, testing/workflow/operations, phase spec, README, roadmap, changelog and this evidence are updated. Historical ADRs are not rewritten. Existing source/default/deployment distinctions remain explicit.

27. **Deviation.** A genuine implementation budget defect was corrected: a valid sixteen-deadline proposal exceeded Phase 03's 20,000-byte limit. Limit is now 32 KiB/proposal and a separate 1 MiB aggregate page limit, under the existing SQL 2 MiB ceiling. Regression tests prove full provenance and pre-commit aggregate rejection. No database, RPC, core domain, SourceAdapter or platform redesign; no material ADR decision needed.

28. **Remaining risks.** Community accuracy, official/API disagreements, narrow disciplines, annual/biennial/expired call scope, no DNS IP pinning, unmeasured hosted Edge/bundle limits, production plan/backup/restore readiness, future rate/cooldown/health scheduling and actual profile preferences remain documented gates for 05–10 as applicable. No Phase 04 blocker remains; no production freshness, unattended reliability or delivery is claimed. Changing a source/year/host requires new review.

29. **Phase 05 readiness.** Review/commit this phase only when explicitly authorized; start from a clean verified main baseline. Obtain explicit Phase 05 activation, read AGENTS/PLANS/05 spec and current contracts/code. Reverify isolated target/auth/TLS/history/data before writes. Select researcher-supplied relevant categories/geography/qualifications or an explicitly labeled nonpersonal test scope, never guessed preferences. Recheck rights/format/bounds/eligibility for the institutional pilot and smallest broad position/funding source; close all required position/internship/grant/funding checkpoints with fixtures and hosted evidence. Preserve conference/core contracts. No Telegram/Cron/LLM/production activation. Phase 05 remains pending now.

30. **Recommended commit.** `feat(sources): add bounded conference workshop and CFP ingestion`. Recommendation only; nothing committed/pushed/deployed, and no Phase 05 implementation started.

## Reproducible commands and input evidence

On this host, commands ran through the process-local transparent `rtk` passthrough because the RTK executable was absent; no RTK filtering or installation is claimed. The pinned launcher is:

```text
npx.cmd --yes --package deno@2.9.6 --package supabase@2.122.0 deno task <task and arguments>
```

Successful tasks: `check`, `test:unit`, `test:contract`, read-only `db:plan`, `db:verify`, `test:integration`, focused `test:conferences`, all three `sources:smoke` commands above, and `sources:benchmark`. Final `check` and independent documentation validation passed across 38 Markdown files; independent `secrets:scan` passed across 119 Git-scoped project files; `git diff --check` passed. The five Phase 04 success receipts were independently checked against the current input hash, expected assertion counts, development ref/class and successful cleanup. Final Git root/branch/baseline are unchanged, staging empty: 16 modified tracked + 28 new files (44 total), all uncommitted. No required hosted command was replaced by a mock.

Final Phase 04 integration and all live receipts bind repository input SHA256 `579714a9231f52ed949730310030ea7d4c33b140218c7d5602d4049c58e9008c` (code, tests, YAML/JSON fixtures, license, migrations and dependency manifests; LF normalized). SQL verifier suite hash `be48f55412e877e822cff7b741fc8d3f5d8f451537d74d2568bb9cdc15b6a01e`; no-pending plan hash `eb8d3e7aa666b2b2d259461230a85aadcb7b325fdf031485987fa9ae8aee822a`. Success receipts remain ignored under `private/`, not committed as credential-bearing diagnostics.

## Changed files

```text
ARCHITECTURE.md
CHANGELOG.md
DATA_SOURCES.md
OPERATIONS.md
PLANS.md
README.md
deno.json
deno.lock
docs/DATABASE_WORKFLOW.md
docs/TESTING.md
docs/sources/ccfddl.md
docs/sources/openreview-calls.md
docs/verification/phase04-conferences.md
harness/build/04-conference-sources.md
scripts/check.ts
scripts/db/main.ts
scripts/sources/benchmark.ts
scripts/sources/evidence.ts
supabase/functions/_shared/adapters/sources/ccfddl/adapter.ts
supabase/functions/_shared/adapters/sources/ccfddl/manifest.ts
supabase/functions/_shared/adapters/sources/ccfddl/mapping.ts
supabase/functions/_shared/adapters/sources/ccfddl/yaml.ts
supabase/functions/_shared/adapters/sources/openreview/adapter.ts
supabase/functions/_shared/adapters/sources/openreview/manifest.ts
supabase/functions/_shared/adapters/sources/registry.ts
supabase/functions/_shared/application/collect.ts
supabase/functions/job-worker/index.ts
tests/ccfddl_support.ts
tests/contract/ccfddl_test.ts
tests/contract/conference_coverage_test.ts
tests/fixtures/ccfddl/LICENSE
tests/fixtures/ccfddl/hotos.yml
tests/fixtures/ccfddl/manifest.json
tests/fixtures/ccfddl/second-source.json
tests/fixtures/ccfddl/sigmod.yml
tests/fixtures/ccfddl/vldb-upper-bound.yml
tests/fixtures/openreview/invitation.json
tests/fixtures/openreview/manifest.json
tests/integration/conference_coverage.ts
tests/integration/conferences.ts
tests/unit/ccfddl_identity_test.ts
tests/unit/ccfddl_test.ts
tests/unit/conference_coverage_test.ts
tests/unit/pipeline_test.ts
```
