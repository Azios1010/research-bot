# CCFDDL source decision — Checkpoint A

Reviewed 2026-10-29. This is a nonpersonal database-systems technical test subset, not a researcher preference. Approval is for explicit development verification; no production scheduling is enabled.

## Current evidence and permission

- Upstream: [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines), inspected main commit `2e5a397ce3639e7464b7e7f5222c6d011517ad29` (2026-10-29T04:19:08Z), tree `9647ec8f54570082252cb931757dd21242d07d8b`; 948 entries, recursive response not truncated. Active updates are observed, not an uptime guarantee.
- [License at inspected revision](https://github.com/ccfddl/ccf-deadlines/blob/2e5a397ce3639e7464b7e7f5222c6d011517ad29/LICENSE): MIT, Copyright (c) 2021 CCFDDL. [Publisher terms](https://ccfddl.com/mcp-terms.html) explicitly apply MIT to repository code and data and disclaim completeness/accuracy. Retain the full notice with copied fixtures. No upstream application code is copied.
- Exact initial data path: `conference/DB/sigmod.yml`; transport `https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/conference/DB/sigmod.yml`. Fixtures use the inspected immutable revision. Collection records a content-derived revision and validators; main can change between runs.
- [Schema](https://github.com/ccfddl/ccf-deadlines/blob/2e5a397ce3639e7464b7e7f5222c6d011517ad29/scripts/conference-yaml-schema.yml): conference specification 3.0.X, series array, editions with explicit IDs, timeline array and edition-level timezone. Timeline has abstract/submission/rebuttal/decision fields but no immutable round ID.
- Publisher robots at the revision allow all paths. `raw.githubusercontent.com/robots.txt` returned 404, so no raw-host robots permission is inferred. GitHub UI robots restrict crawler paths; this adapter does not crawl the UI. MIT data distribution plus documented public dataset consumption support the small targeted raw-file reads. Respect GitHub acceptable-use terms and stop on access restrictions. This is an engineering permission assessment, not a claim of unrestricted crawling rights.
- [GitHub API rate documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) describes 60 unauthenticated API requests/hour/IP; that is not a raw-host SLA. Raw host limits are unspecified. Use one request/run, conservative daily cadence when scheduling is approved later, conditional GET, bounded retries/cooldown through the existing worker. No authenticated request is needed.
- Fixed GitHub-owned raw endpoint, HTTPS, no redirects, no user-supplied URLs or DNS destinations. The existing HTTP client does not pin resolved IPs; relying on this reviewed host's DNS is explicit. Official event links are validated as data and never fetched by the collector.

## Interface comparison

| Criterion | Direct individual YAML files (selected) | Documented MCP |
| --- | --- | --- |
| Interface | One GET per approved series file | Streamable HTTP POST at `https://ccfddl.com/mcp` |
| Replay / revision | Immutable commit fixtures; raw payload content revision | Service cache snapshot; no documented immutable Git revision selector |
| Boundedness | Approved file, byte/edition/round limits, no tree traversal | Search/upcoming default 20, maximum 50 with offset pagination; edition history has omission limits |
| Evidence | Original labels, clock strings, timezone tokens | Transformed deadline nodes plus derived opening times; must distinguish derived fields |
| Stability / dependency | Observed 3.0.X schema, GitHub raw delivery | Protocol, service availability and cache transformation in addition to GitHub dataset |
| Latency / resources | Current largest conference file 5,599 bytes; benchmark required below | Service loads aggregate allconf/allacc snapshots; client result bounded, server work outside our control |
| Cache / freshness | ETag/Last-Modified, fully committed-run validators only | Documented 15-minute isolate cache and explicit stale fallback |
| Edge / offline tests | Existing GET/HEAD port, pure pinned YAML parser | Requires additional POST/protocol client; offline tool-response fixtures possible |
| License | MIT raw data with attribution | Repository data MIT; service terms also apply |

MCP is a useful human query interface but adds no benefit for this tiny deterministic ingestion scope. Its deadline-node types are not evidence of workshop or standalone-call coverage. Website `/api/` account/favorites endpoints are not assumed to be a public ingestion API. No architecture ADR is needed: this is a source adapter choice within the accepted contract. [Upstream MCP documentation](https://github.com/ccfddl/ccf-deadlines/blob/2e5a397ce3639e7464b7e7f5222c6d011517ad29/worker/mcp/README.md) is the comparison evidence.

## Mapping policies

One edition is one conference; submission deadlines do not create duplicate CFP opportunities. Stable keys use series/category and upstream edition ID, never array positions or dates. Year/cycle and explicit track qualify reviewed annual official listing identities. Rank is source metadata, not a recommendation or ranking weight. Organization/publication time remain null when absent. Work mode stays unknown unless the source explicitly says Online. Country parsing uses explicit country names only.

Edition-level timezone is `source_default`, not a statement that the official call specified it. Upstream documentation says missing official clocks may become `23:59:59`, and missing zones may become AoE. Therefore those end-of-day clocks are conservatively represented as date-only, with the original clock and timezone retained in bounded source evidence. Other local clocks use the edition's source-default timezone; PT is resolved with America/Los_Angeles including DST, retaining the PT token. Ambiguous/unresolved clocks remain unknown. No event date becomes a submission deadline.

Round labels such as first/second/round 1 are stable semantic round keys. A single unlabeled round is `main`. Multiple unlabeled rounds remain ambiguous evidence; timestamps and indexes never identify them. Non-contiguous event date text is retained without inventing a continuous interval. Unknown optional scalar fields may be ignored; changed required structure or unknown deadline-bearing fields fail visibly.

## Checkpoint evidence

Checkpoint A closed locally on 2026-10-29 before starting B/C. Nine initial parser/fetch tests passed (no network/environment permissions), including safe YAML, sixteen deadlines, date-only defaults, PT DST, mixed siblings, explicit empty, drift and conditional fetch. Fixture checksum validation is additionally enforced in the contract suite. Copied files are unmodified upstream UTF-8 with the full MIT notice and exact revision/checksums in `tests/fixtures/ccfddl/manifest.json`.

Initial local benchmark, Deno 2.9.6 on Windows, 50 iterations: SIGMOD 4,016 bytes, 7 editions / 43 canonical deadline entries, maximum normalized observation 7,344 bytes; parse mean 2.90 ms / maximum 25.47 ms, mapping maximum 30.86 ms. VLDB is the largest file in the inspected recursive conference tree: 5,599 bytes, 7 editions; parse mean 2.75 ms / maximum 4.80 ms, mapping maximum 29.73 ms. Its unlabeled monthly rounds yield zero invented canonical deadlines and retain ambiguous evidence; it is not approved for live collection. RSS increased from 37.2 MB before the first sample to 71.3 MB after both runs (process-wide memory proxy including JIT/cache/GC, not an isolated peak). No compression was used for fixture bytes. Both are one-request/one-page work units. The source ceiling is 16 KiB, 32 editions, 12 rounds/edition, within shared 2 MiB/100-record limits. Hosted Edge CPU/memory confirmation remains Phase 10; local measurements do not substitute for it.

The pinned browser distribution of YAML 2.9.1 avoids Node/JSR debug environment access. Strict YAML 1.2 core parsing rejects aliases, anchors, explicit tags, duplicate/prototype/merge keys and excessive nesting/nodes before conversion; there is no expansion, arbitrary constructor or custom schema. Byte bounds precede parsing. CDN files are integrity-locked; normal tests use cached-only resolution.

## Checkpoint B — semantics and authority

Measured complete SIGMOD 2027 proposal size is approximately 21.2 KB before existing observation IDs are added. This exposed the Phase 03 20,000-byte application proposal ceiling. The smallest source-neutral correction is 32 KiB/proposal plus a separate 1 MiB aggregate page limit, preserving the SQL 2 MiB ceiling. Regression tests cover all sixteen deadline provenance entries and aggregate rejection before commit. No migration, SourceAdapter change, source-specific domain branch or new ADR is required.

The SIGMOD/PODS joint annual homepage is **not** listing-specific: the inspected `conference/DB/pods.yml` uses that same root. Only the separately reviewed 2027 SIGMOD research-call URL supplies strong listing evidence, qualified by cycle and main track; no unreviewed paths are synthesized for historical years. Other homepages remain candidate evidence. The second sanitized fixture is handwritten factual data from [the official 2027 homepage](https://2027.sigmod.org/) and [research call](https://2027.sigmod.org/calls_papers_sigmod_research.shtml), read 2026-10-29; it contains no copied HTML or prose and uses fake transport only. It proves strong merge and higher-authority `eventEnd` evidence. Synthetic changes prove edition/industry-track conflicts remain separate, and missing-organization fingerprint-only matches remain flagged candidates. CCFDDL's selected file has no separate child tracks; none are invented.

Manual comparison, 2026-10-29: SIGMOD 2027 submission days (January/April/July/October 17) and abstract days (10) agree with the official call. Location agrees. Event end disagrees: aggregator June 19 versus official June 18. The adapter preserves aggregator provenance; the official transcription tests reviewed higher-authority correction rather than silently editing the upstream data. [The 2026 homepage](https://2026.sigmod.org/) agrees on Bengaluru/India and May 31 opening, but lists June 5 as overall end; CCFDDL's non-contiguous main-event date text stays raw, without an invented interval. Aggregator freshness/accuracy is not certified by a successful fetch.

Checkpoint B closed 2026-10-29T09:15Z with 13 named hosted conference assertions after the dedicated-call identity correction, plus 48 unit / 10 contract tests. Seven editions and 43 deadlines persisted through the real HTTPS RPC pipeline; task/page replay, new-run duplicate handling, 304 zero-record accounting, changed deadline ID/revision, malformed sibling quarantine, reviewed strong cross-source merge/authority, invalid cursor rollback and retry passed. All scoped data was removed; final inventory reported no application data. The seven applied migrations were unchanged. Private receipt records exact input hash and results.

## Checkpoint C — coverage evaluation before adding paths

| Type | Primary SIGMOD path | Fixture / live status at C entry | Gap and next decision |
| --- | --- | --- | --- |
| conference | Seven annual editions with submission rounds | Real copied fixture and hosted persistence pass; live smoke pending | Nonpersonal database-systems subset only, historical/annual gaps explicit |
| workshop | None; SIGMOD's mention of workshops is not a separate workshop listing | No primary-path coverage | The same MIT dataset explicitly identifies HotOS as a workshop; review its small `conference/SE/hotos.yml` file and official links, reuse the same adapter |
| conference_cfp | Normal submission browsing can use SIGMOD conference deadlines, without duplicate calls | Distinct call fixture / configured live path not yet established | A genuine separate call is required by the phase contract; evaluate the smallest documented structured API before any second live provider. Do not retype or duplicate the SIGMOD event to manufacture coverage |

The HotOS file at the same inspected revision has four biennial editions, including 2027, and is 1,143 bytes. Approval remains limited to explicit development checks, with the existing MIT/host/rate policy. The full dataset is not enabled. Additional provider investigation is justified only for the distinct-call gap above.

HotOS is mapped as `workshop` because upstream explicitly names it as a workshop; it is not retyped from an ordinary conference. `Virtual` is explicit remote evidence for the 2021 edition; city names alone do not imply onsite. Explicit Canada/Germany country names map to CA/DE. A separately reviewed 2027 HotOS call provides listing-specific identity; historical editions retain source-key/candidate identity only. Its [official homepage](https://sigops.org/s/conferences/hotos/2027/) and [call](https://sigops.org/s/conferences/hotos/2027/cfp.html), read 2026-10-29, agree on May 24–26, Burghausen/Germany, February 1 paper/proposal deadline and April 9 decisions. The official call does not specify AoE in the inspected deadline text, so the dataset zone remains source-default, not official precision. Camera-ready dates are not invented from manual comparison.

The distinct-call gap is closed in code by [one scoped OpenReview invitation adapter](openreview-calls.md). It is a separate call to organize ICLR workshops, not a duplicate of SIGMOD/HotOS paper submissions. WikiCFP was not selected: current permission/interface reliability remains unresolved. Another CCFDDL mirror/AI Deadlines would add overlapping events without proving distinct-call coverage. No broad source enumeration, search collector or HTML crawler is implemented.

Final local resource run (Deno 2.9.6; 50 YAML iterations / 100 JSON iterations):

| Payload | Bytes / records / deadlines | Parse mean / max | Mapping max / observation max |
| --- | --- | --- | --- |
| SIGMOD | 4,016 / 7 / 43 | 2.78 / 25.38 ms | 27.57 ms / 7,344 bytes; complete proposal about 21,247 bytes |
| Largest current file, VLDB (benchmark only) | 5,599 / 7 / 0 invented rounds | 2.38 / 5.39 ms | 25.79 ms / 5,877 bytes |
| HotOS | 1,143 / 4 / 5 | 0.54 / 1.30 ms | 0.13 ms / 1,653 bytes |

OpenReview sanitized metadata plus explicitly synthetic padding at observed 4,850-byte response size took at most 2.99 ms for parsing/mapping/normalization; at the 65,536-byte hard cap at most 0.56 ms. These are different JIT/GC samples, not a claim that larger data is faster. Process RSS proxy ranged 39.0–77.5 MB across the complete benchmark; fixture/synthetic byte sizes equal decoded UTF-8 sizes, without compression. Actual live full-response timing is separately recorded by smoke. [Current Supabase limits](https://supabase.com/docs/guides/functions/limits), reviewed 2026-10-29, are 256 MB and 2 seconds CPU/request; local evidence supports the small work units but cannot certify hosted Edge performance. The Phase 10 hosted-budget gate remains open.

Checkpoint C closed with all three required live smokes and hosted integration on isolated development project `ihxoffjtrtyxgctcfgmy`, 2026-10-29 09:37–09:38Z. SIGMOD: seven opportunities/43 deadlines; HotOS: four/five; independent OpenReview call: one/one. Replay inserted zero; both YAML paths returned actual 304, while API replay reparsed a changed whole-response representation without changing canonical facts. All data/tasks/runs/sources were removed and pause restored; final inventory had no application data. Notifications were zero. [Final coverage matrix and 30-item report](../verification/phase04-conferences.md).

One further manual mismatch remains explicit: HotOS upstream description still says USENIX while the current official page brands it ACM SIGOPS. The adapter retains source description/provenance and infers no organization. No general official-page ingestion or silent correction was added. This phase approves development verification only; production enablement and actual hosted Edge measurements remain Phase 10 gates.
