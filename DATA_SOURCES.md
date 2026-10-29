# Data sources and reuse evaluation

## Evidence policy

Phase 04 current re-evaluation (2026-10-29): [CCFDDL decision and evidence](docs/sources/ccfddl.md) and [OpenReview call evidence](docs/sources/openreview-calls.md) supersede historical conference-candidate estimates below for the three exact approved development paths. Direct bounded YAML was selected over the current documented CCFDDL MCP service. HotOS reuses that adapter to close workshop coverage. One scoped public OpenReview API invitation closes the distinct organizer-call gap. No production collection or scheduling is approved.

| Approved development path | Category / format / access | Cadence / reliability / authentication / difficulty | Rights / duplicates / priority |
| --- | --- | --- | --- |
| [CCFDDL SIGMOD](https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/conference/DB/sigmod.yml), slug `ccfddl` | Conference and embedded paper deadlines; one bounded YAML GET | Proposed daily, not scheduled; community data has observed official-date disagreement; no auth; low transport, medium temporal/round mapping difficulty | MIT data, targeted raw reads; high joint-homepage/cross-aggregator duplicate risk, reviewed dedicated call identity only; P1 selected |
| [CCFDDL HotOS](https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/conference/SE/hotos.yml), slug `ccfddl-hotos` | Explicit workshop, same YAML adapter/provider | Proposed daily, biennial editions; sampled dates agree with official page; no auth; low additional implementation difficulty | Same MIT evidence/notice, no new host; medium event/CFP duplication risk, do not duplicate workshop's paper call; P1 required coverage |
| [OpenReview ICLR workshop-proposal invitation](https://api2.openreview.net/invitations?id=ICLR.cc%2F2027%2FWorkshop_Proposals%2F-%2FSubmission&expired=true&limit=1), slug `openreview-workshop-call` | Genuine standalone organizer call; one public JSON GET, exact ID, documented expired filter | Proposed daily, no SLA or broad discovery; no auth, private readership refused; low parsing complexity, medium semantics risk because API cutoff differs from official prose | CC0 public metadata, attribution retained; API robots allow this ID query; medium call/event overlap risk, distinct cycle/track and call type; P1 only to close measured gap |

The foundation review on **2026-10-28** used public primary pages/repository files. No collector was executed or authenticated account accessed during that foundation review. No source is approved for production ingestion yet. “Confirmed candidate” in the historical tables below means a useful public format or opportunity page was observed, not permission, completeness, freshness or an SLA. The current approved paths and measured evidence above are narrower than whole-provider approval.

Record the next review date, exact endpoint, response headers, terms/robots evidence, license and attribution requirements in each future source manifest. Do not invent an API because a page contains structured-looking content. Publisher article RSS is not automatically a feed of open calls.

## Preferred source types and evaluation criteria

Prefer maintained public structured datasets, documented stable APIs, RSS/Atom, public JSON/YAML, then stable HTML. Browser automation is last resort and has no approved runtime in this architecture; choose another source unless an ADR and explicit later scope change justify it.

Hard gates: permitted access/reuse, usable relevance, stable logical identity, bounded Edge-runtime feasibility, and fixture-backed parsing. If a gate fails, the source is not production-enabled regardless of score. For gated candidates, score each 0-2 on structure, freshness evidence, field completeness, provenance/authority, maintenance stability, and operational cost (maximum 12). Rank by measured score within required category coverage. Unknown evidence earns 0 pending investigation, not an optimistic score. Numerical scores are deferred to onboarding because normal fetch/parser measurements do not exist yet.

Every evaluation records name, category/types, URL, format, method, actual observed update pattern if known, intended poll cadence, reliability estimate, authentication, parser difficulty, legal/robots/license status, duplicate risk, priority, evidence date, and remaining questions. Intended poll cadence is our decision, never a claim about source update frequency.

## Confirmed candidate conference sources

| Source / evidence | Format and access | Update frequency / proposed poll | Reliability, auth, difficulty | Legal / robots / duplicate risk | Priority |
| --- | --- | --- | --- | --- | --- |
| [CCFDDL repository](https://github.com/ccfddl/ccf-deadlines), [AAAI YAML sample](https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/conference/AI/aaai.yml), [schema conventions](https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/README.md) | Public YAML files over HTTPS; select bounded discipline files rather than crawl rendered site. Conferences and some track deadlines. | Community edits; no fixed update SLA verified. Poll daily with conditional fetch where available. | Estimated medium-high parsing stability, unmeasured date accuracy. Public reads observed, no auth needed for files; GitHub API discovery may be rate limited. Low-medium parsing difficulty. | Repository exposes [MIT license](https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/LICENSE); preserve notice for reused material and review dataset scope/linked-page rights. Robots/host request policy still to review. High overlap with other calendars. | P1, first implementation in 04. |
| [AI Deadlines](https://github.com/paperswithcode/ai-deadlines), [conference YAML](https://raw.githubusercontent.com/paperswithcode/ai-deadlines/gh-pages/_data/conferences.yml) | Public YAML dataset, useful format comparison and fallback. Original `abhshkdz` URL redirected to `paperswithcode`. | No cadence verified. Reviewed file begins with 2024/2025 editions; current 2026 coverage and maintenance need investigation. Proposed daily only if approved. | Format observed; current freshness unverified. Public file needs no auth; low parsing difficulty but date inconsistencies need validation. | [MIT license](https://raw.githubusercontent.com/paperswithcode/ai-deadlines/gh-pages/LICENSE) observed; preserve notice. Rights/host policy review still needed. Very high overlap with CCFDDL. | P2 fallback/fixtures; not automatically a second collector. |

Important observed CCFDDL behavior: multiple deadline rounds, explicit timezone tokens, and documented defaults for missing time/zone. Store a default as source-assumed evidence rather than official precision. AI Deadlines is a candidate data format, not evidence that this researcher works in AI. The actual research profile determines which categories to fetch.

## Confirmed candidate research job and funding sources

| Source / category / URL | Format and access | Update frequency / proposed poll | Reliability, auth, difficulty | Legal / robots / duplicate risk | Priority |
| --- | --- | --- | --- | --- | --- |
| [EURAXESS jobs and funding search](https://euraxess.ec.europa.eu/jobs/search): positions, funding, hosting | Public HTML search observed with research fields, locations and deadlines. Prefer a documented readable API/feed if later verified; none assumed. | Listing posts observed; full change cadence unknown. Proposed daily. | Estimated medium authority as a portal; upstream employers vary. Public browse observed; authenticated API requirements unknown. Medium HTML/pagination difficulty. | Terms, robots, request limits and permitted personal ingestion not checked. High duplicate risk with institutional originals and syndication. | P1 evaluation in 05; fallback if readable access is not permitted/stable. |
| [University of Bath RSS directory](https://www.bath.ac.uk/jobs/rss/), [Education & Research feed](https://www.bath.ac.uk/jobs/rss/rss.aspx?cat=391): institutional research jobs | Official directory advertises RSS by type/department. Feed request reported an XML content-type unsupported by the research browser; actual body/fields must be captured and verified in 05. | No publication SLA verified; proposed daily. | Estimated medium-high as an official board, unmeasured feed completeness. Public directory observed; feed auth must be verified. Low-medium difficulty including detail enrichment. | Follow the directory's current Terms link during onboarding; permitted automated reuse/robots remain unverified. Medium overlap with aggregators. | P1 structured-first pilot in 05; directory is confirmed, feed parser is not. |
| [CERN job offers](https://careers.cern/jobs/): research positions and internships | Public official HTML listing observed in search, with internship/student paths. A documented structured feed/API would be preferred but has not been verified. | Unknown, programme cycles vary; proposed daily during open calls. | Official origin, current parser behavior unmeasured. Browse public in evidence; automation auth unknown. Medium difficulty and potential external ATS links. | Terms/robots/ATS permissions unknown; do not infer a public ATS API. Medium duplicate risk with portals. | P2 evaluation in 05 to address internships; profile eligibility may make it irrelevant. |
| [Grants.gov API guide](https://www.grants.gov/api/api-guide), [search2 specification](https://www.grants.gov/api/common/search2): grants and research funding | Documented JSON search endpoint at `https://api.grants.gov/v1/api/search2`; detail completeness needs evaluation. | Publication cadence unknown; proposed daily, bounded by research fields and eligibility. | Estimated medium-high format stability; no uptime measurement. Guide states search2 needs no login/API key. Low-medium implementation difficulty. | Review [API fair-use entrypoint](https://www.grants.gov/api) and terms before polling. High overlap with agency announcements; many grants target institutions and may be ineligible for an individual. | P2 in 05; structured funding fallback, only enable if profile relevance is demonstrated. |

An EURAXESS `/api/` URL could not be inspected using the research browser. Search evidence about XML publishing can describe submission of employer advertisements rather than read access. Do not implement an assumed public read API from that evidence. Investigate through official documentation first.

Bath is an example of a usable institutional feed pattern, not a mandatory university. CERN is a concrete internship candidate, not an eligibility recommendation. Grants.gov's institutional/geographic eligibility can make it a poor personal source despite good structure. Phase 05 chooses a relevant funder if these candidates do not fit; that decision must preserve grant/funding coverage.

## Confirmed candidate journal/CFP sources

| Source / URL | Format and access | Update frequency / proposed poll | Reliability, auth, difficulty | Legal / robots / duplicate risk | Priority |
| --- | --- | --- | --- | --- | --- |
| [Springer Nature opportunity posts](https://communities.springernature.com/channels/opportunities?page=3) | Public HTML/search evidence includes collection calls. The channel root rendered almost no content in the research browser; server-readable index/detail feasibility remains unknown. | Unknown; proposed daily if bounded pages work. | Estimated medium authority for publisher posts, unmeasured parse stability. Read evidence public; no ingestion API verified. Medium-high difficulty. | Terms/robots and rights unknown. High overlap among community posts, collection pages and journal pages. | P1 investigation in 06, not an approved collector. |
| [Elsevier special-issue guide](https://www.elsevier.com/publishing/publish-in-a-journal/journal-selection/special-issues) links to ScienceDirect calls | Official HTML directory/individual journal call pages. Exact calls endpoint and response format must be followed/verified in 06; no assumed API or feed. | Unknown; proposed daily for selected journals. | Estimated medium authority; server-side access/anti-bot behavior unmeasured. Public guide readable; target auth unknown. Medium-high difficulty. | Publisher terms/robots and permitted extraction are unresolved. High duplicate risk across directory and journal listings. | P1 investigation in 06; select one approved publisher path first. |

These entries establish candidate locations, not claims that every collection is open, free to publish in, reputable, or appropriate. Store journal name, publisher, ISSN when supplied, submission window, fees when explicitly published, and official call URL as evidence. Never infer an APC, ranking or quality endorsement from the source's existence. A collection of already published articles with no active call is not a new opportunity.

## Needs investigation

| Source / URL / category | Format / method / auth | Frequency / reliability / difficulty | Legal / robots / duplicates | Priority and next decision |
| --- | --- | --- | --- | --- |
| [Wiley HRM call page](https://onlinelibrary.wiley.com/page/journal/1099050x/call-for-papers), example publisher journal CFPs | HTML page observed with submission windows; public read worked. No CFP RSS/API verified. | Unknown frequency; official origin, unmeasured parsing reliability; medium difficulty. | Page reserves text/data-mining rights. Permission for automated personal extraction is unresolved; do not treat readability as permission. High overlap with special-issue pages. | P2 in 06 after rights review; HRM subject is a format example, not inferred user interest. |
| [WikiCFP](https://www.wikicfp.com/cfp/), conference/workshop/journal aggregations | Request timed out; HTML/API/feed/auth details not verified. | Unknown update pattern/reliability; estimated medium-high difficulty pending access. | Terms/robots unknown; high cross-source and low-quality-listing risk. | P3 in 04/06 only if primary/structured sources leave a concrete coverage gap. |
| [jobs.ac.uk](https://www.jobs.ac.uk/), broad academic jobs | Historical official [RSS guide](https://www.jobs.ac.uk/media/pdf/about/rss_guide.pdf) exists; this does not establish current feeds. Format/access/auth unverified today. | Current cadence/reliability unknown; difficulty unknown. | Current terms/robots unknown; high overlap with employer originals. | P3 in 05 if needed; do not build against the old guide. |
| A researcher-selected university, institute or funder (URL pending profile input) | Prefer documented API/RSS/JSON-LD/HTML; all access/auth unknown until selected. | Cadence/reliability/difficulty unknown. | Rights, robots and duplicate risk unassessed. | P1 targeted selection in 05 if global candidates miss eligibility, geography or internship/funding types. |

## Rejected or deprioritized approaches

- Broad web crawling, search-engine result scraping, login/CAPTCHA bypass and unofficial private API reverse engineering: outside product scope and operational budget. No candidate URL is needed for an approach-level rejection.
- Browser-only sources: deprioritized because Edge Functions have no approved browser runtime. Reassess only if a required category cannot be served with permitted HTTP sources.
- Full application forks of Telegram bots or scraper platforms: unrelated architecture must not become the core. No specific repository was evaluated or licensed for code reuse in Phase 01.
- Publication RSS, bibliographic APIs and article metadata alone: useful for publications, insufficient evidence of active opportunities. Evaluate a dedicated CFP feed separately.
- Enabling several near-identical conference datasets initially: maintenance cost and duplicate traffic exceed additional coverage. Use CCFDDL as the initial candidate and AI Deadlines as comparison/fallback.

## Third-party reuse register

| Asset | Promising reuse | Boundary and required work |
| --- | --- | --- |
| CCFDDL | Structured conference data and examples of round/timezone conventions. | Consume data through our adapter. Do not inherit its site/CLI/WeChat architecture or add Python. Pin fixture commit/reference; retain required MIT notices for copied material. Verify authoritative deadlines and default precision. |
| AI Deadlines | YAML normalization edge cases and alternate conference coverage. | Verify maintenance first; reuse data/ideas with required notice, not the website stack. |
| Institutional RSS and documented funding APIs | Stable IDs, pagination and public schemas. | Implement independent Research Radar adapters after rights/format review. No adapter code has been copied in this phase. |

Phase 04 copies three small MIT CCFDDL data files under `tests/fixtures/ccfddl/`, with full LICENSE and checksum/provenance manifest: SIGMOD, HotOS and benchmark-only VLDB. A handwritten second-source JSON records minimal official facts for identity/authority tests. `tests/fixtures/openreview/` retains sanitized CC0 invitation metadata with endpoint/mdate/checksum and attribution. The safe YAML wrapper uses the ISC-licensed `yaml` 2.9.1 browser distribution, pinned to an exact CDN URL and lockfile hashes, with matching npm type declarations. Node/npm and JSR runtime entrypoints were rejected because debug environment reads violate pure parsing/minimal test permissions. The browser build has no such reads; fixture suites run without environment/network permission. No upstream application code or architecture is reused.

## Risks and prioritization

Primary risks are stale community deadlines, source defaults mistaken for official precision, pagination gaps, re-used URLs, opaque rights, parser CPU cost, malformed feeds, predatory/unreliable listings, and systematic ineligibility. “Successful HTTP 200” is insufficient: validate expected shape, useful yield, date quality, and official targets.

Phase 04 starts with a bounded CCFDDL subset, then resolves workshop/standalone-call coverage without building a general crawler. Phase 05 first proves one structured institutional feed plus a relevant broad source, then closes the position/internship/grant/funding coverage matrix. Phase 06 proves one permitted publisher path for both journal types before adding a second. Stop adding sources once required coverage and utility are demonstrated. There is no requirement to integrate every candidate listed here.

## Source onboarding checklist

### Phase 04 verified coverage (2026-10-29)

| Type | Primary / gap-closing path | Real fixtures and live ingestion | Seasonal / discipline gaps | Confidence / further source need |
| --- | --- | --- | --- | --- |
| `conference` | CCFDDL SIGMOD | Seven editions, 43 deadlines, replay/cleanup pass | 2021–2027 database systems only; 2027 paper deadline elapsed while event upcoming | High mapping confidence; community accuracy limited; no extra provider needed for phase coverage |
| `workshop` | Same CCFDDL provider, explicit HotOS path | Four biennial editions, five deadlines, replay/cleanup pass | Operating systems only; biennial/community update gaps | Explicit workshop and sampled dates verified; same-provider file closes gap |
| `conference_cfp` | Event deadlines serve ordinary paper-call browsing; one OpenReview independent organizer call | One genuine call and exact API deadline, fixture/live/replay pass | ML organizer call already expired; new years need reviewed manifest, no broad discovery | High identity/cutoff fidelity, official/API agreement limited; second provider required and added, no further source required now |

All live data was persisted only temporarily in the isolated development target and cleaned up; no production corpus or current open-call guarantee. SIGMOD and HotOS live replays returned 304; OpenReview's two 200 responses had different whole-payload hashes but unchanged canonical facts. [Full evidence and limitations](docs/verification/phase04-conferences.md).

Phase 03 includes only the repository-authored `fake` adapter for deterministic verification, not an external source candidate. Its eleven-type synthetic JSON, parser version and LF-normalized fixture checksums live in `tests/fixtures/fake/manifest.json`. Collection reads bounded fixture pages from test-owned source configuration and performs no public HTTP. No external permission/freshness claim or real-source approval is implied. Real adapters still require every onboarding gate below.

1. Record exact source identity, category/types, official/aggregator role, URLs, evidence date, owner, and expected researcher relevance.
2. Inspect current documentation, terms, robots and license for every fetch host, including redirect/ATS/detail hosts. Record permission/attribution decision and review date. Unresolved access permission blocks enabling the source; choose an alternative or obtain permission explicitly.
3. Verify actual response formats, public/authenticated access, limits, update behavior, pagination/completeness semantics, timestamps/timezones, stable IDs and canonical target links.
4. Choose a bounded scope and cadence, per-host rate, timeout, compressed/decompressed size limits, conditional validators, retry classification and source cooldown.
5. Capture sanitized minimal fixtures with original URL, retrieval date, rights note, parser version, checksum and expected output. Include malformed records, duplicates, missing deadlines and reused URLs/rounds.
6. Implement fetch and pure parsing through the source contract. Keep mappings, conventions and source-specific assumptions in its adapter. No Telegram or LLM calls.
7. Prove normalization, deadline precision, deterministic identity, cross-source duplicate handling, partial failures and pagination replay offline. Benchmark realistic maximum payloads under Edge constraints.
8. Record source precedence and provenance selection rules, health thresholds, zero-yield behavior and disable/retry procedure.
9. Update this register with measured evaluation, enabled coverage and remaining limitations. Enable first in the isolated verification environment; final live enablement is gated by Phase 10.
