# Profile and deterministic ranking

Phase 08 mechanics extend the existing scorer. Personal calibration is still open; synthetic preferences in fixtures describe no real person. Nothing requires an AI key or activates collection/scheduling. See [ADR 0013](adr/0013-versioned-profile-reranking.md), [synthetic review](verification/phase08-synthetic-review.md) and [phase evidence](verification/phase08-ranking.md).

## Profile schema and bounds

`rules_schema_version=1` is the existing typed database field. `rules` supports only the fields below. Missing optional legacy fields are empty/unknown; missing enabled types retain legacy domain compatibility with all eleven supported types, while UI setup requires an explicitly selected nonempty type list. Profile setup never invents research interests or timezone. Invalid legacy JSON is rejected before scoring; an operator must explicitly repair it through a validated replacement. No automatic migration invents facts.

| Rules field | Validation |
| --- | --- |
| `positive_topics` | At most 20 strings or `{phrase,weight,aliases}`. Phrase 1–160 UTF-16 units; weight finite, >0 and <=100; at most ten aliases, each 1–160. Exact NFC/trim repeats in a basic plain list deduplicate; remaining normalized positive phrase collisions reject, including weighted topics. |
| `blocked_topics`, `ignored_topics` | At most 20 phrases, each 1–160. Both are explicit hard exclusions. Individual Ignore never populates these lists. |
| `enabled_types` | At most eleven supported type codes; no faculty/other invented types. Empty is permitted only for incomplete disabled setup. |
| `type_weights` | Supported codes only, numeric 0–1 inclusive; unspecified weight contributes zero. |
| `preferred_countries`, `excluded_countries` | At most 20 ISO 3166-1 alpha-2 codes, normalized uppercase. Unknown country is distinct from excluded. |
| `hard_countries` | Boolean; known location outside a nonempty preferred set excludes. Explicit excluded countries exclude any matching known location. |
| `preferred_work_modes` | At most 20 entries from remote/hybrid/onsite. Unknown is not a preference. |
| `preferred_institutions`, `blocked_institutions` | At most 20 names, 1–160 each; explicit normalized organization match only, no prestige database. |
| `compatible_qualifications`, `incompatible_qualifications` | At most 20 explicit requirement tags, 1–160 each. The researcher explicitly declares compatible/conflicting known requirements; no degree equivalence or career inference. |
| `eligibility_facts` | Only `student_full_time` boolean/null and `nationalities` (at most 20 valid country codes). Missing remains unknown. Other personal facts are not interpreted without a structured source/domain contract. |
| `unknown_policy` | `allow` (neutral plus warnings) or explicit `exclude` for unknown country, qualification evidence or work mode. |
| `reminder_offsets` | At most twelve integer calendar-day offsets, 0–365; duplicates normalize in the domain. No implicit reminder offsets are installed. |
| `digest_threshold` | Numeric 0–100; absent uses provisional 40. Explicit selection still requires human calibration before Phase 08 acceptance. |

Rule JSON is at most 16 KiB. Basic Telegram patches are at most 3,600 UTF-8 bytes, within the existing 4-KiB normalized inbox envelope. Set-valued text lists normalize case/Unicode and deduplicate; positive topics reject duplicate normalized phrases rather than combine weights silently. Timezone must be a valid IANA identifier (or UTC); local digest time is HH:MM. Matching/digest/reminders require explicit timezone/topics/types; digest/reminders require matching enabled, and reminders additionally require explicit offsets. Invalid multiple-field edits commit nothing. Meaningful changes increment revision once; no-op canonical edits retain it. Flags configure preferences only; Phase 09 owns execution.

## Telegram edits

`/profile` shows a bounded human-readable view and help; oversized views are labeled excerpts. Commands replace the corresponding complete list/map, rather than append implicitly. `clear` empties a list/map. Omitted fields stay unchanged; student and nationality edits merge just their validated fact field.

```text
/profile topics medical imaging^3|MRI; machine learning^1|AI|artificial intelligence
/profile blocked weapons
/profile ignored advertising
/profile types phd,postdoc,conference
/profile weights phd=1,postdoc=0.8,conference=0.5
/profile countries DE,VN
/profile excluded-countries US
/profile hard-countries false
/profile work-modes remote,hybrid
/profile institutions Example Institute
/profile blocked-institutions Other Institute
/profile qualifications masters
/profile conflicts clinical license
/profile student false
/profile nationalities VN
/profile unknown allow
/profile timezone Area/City
/profile time 08:00
/profile offsets 30d,7d,1d
/profile reminders false
/profile digest false
/profile enabled true
/profile rerank
```

These are synthetic syntax examples, not suggested personal settings. `Area/City` is an invalid placeholder to replace explicitly. Topic weight/alias syntax is optional: plain semicolon-separated topics keep weight 1. `/profile threshold N` stores an explicit bounded threshold. Authorization, private-chat binding, durable update deduplication and effect journal precede mutations. Malformed commands return “no settings changed”; arbitrary JSON is never an editor.

## Rule version and explanations

`deterministic-v2` keeps the architecture's weights: topic 40, type 15, country/work mode 10, institution 10, deadline 10, freshness 10, explicit qualification compatibility 5. Weighted topic fraction uses each topic once even if several aliases match. Comparison uses NFKC/lowercase and Unicode letter/number/combining-mark boundaries; reviewed aliases and punctuation/hyphen separators are deterministic, with no embeddings or substring search.

Hard filters run before components: disabled type/profile, per-item Ignore, closed/withdrawn/merged, expired event/non-event deadlines, blocked/ignored topic, blocked institution, known geography/qualification/eligibility conflict, and explicitly selected unknown exclusion. Structured full-time-student requirement conflicts only with explicit false; nationality exclusion conflicts only when all supplied nationalities are explicitly excluded. Source degree alternatives, nationality groups, institutional eligibility, language, equivalence and other unsupported facts remain confirmation warnings, not inferred compatibility. No automatic preference learning occurs.

Deadline component uses floor of remaining days for instants: 0–2=3, 3–30=10, 31–90=6, later/unknown/rolling/conflicted=0. Date-only uses profile-local calendar days and is labeled advisory; conservative UTC-12 end-day is used only for eligibility/order. A future event stays eligible after paper submission expires. First-seen freshness <=7 days=10, <=30=5, later=0; refetch does not reset it.

Score is rounded to two decimals and bounded 0–100; excluded items have null score and no positive components. Store all seven numeric components, matched phrases, exclusions, warnings, date-only flag, advisory deadline days, profile/content revisions, rule and evaluated/valid-until timestamps. Details translates a bounded set of reasons, prioritizing topics and preferences; raw JSON and personal qualification facts are not displayed as an explanation. Category browsing remains available as persisted unpersonalized browsing; `/today` requires fresh eligible scores above the configured (currently provisional) threshold.

Ties use score descending, next actionable deadline ascending/null last, first-seen descending, then UUID ascending. Validity ends at the earliest of 24 hours, exact expiry/event end, next instant deadline score transition, next local midnight for date-only scoring, or next freshness transition. Inclusive <= boundaries change one millisecond later. A score can never outlive a near-term expiry because of a minimum TTL.

## Reranking and feedback

Profile edits atomically enqueue existing `assess_batch` work. Each scan freezes its upper UUID and proceeds in stable UUID pages of <=50 IDs; a new insert behind the cursor is handled by the existing collection handoff or a later explicit pass. Scope includes profile/revision/current rule; active requests coalesce, completion enqueues the next page atomically. Each worker still claims <=5 tasks/45 seconds with fenced 90-second leases and three attempts. No source request is used. Explicit `/profile rerank` and backend-only `rr_request_rerank` cover rule/time invalidation without adding a scheduler. Phase 09 will own due-time dispatch/recovery.

Writes check current profile/content revision, rule, validity, evaluation recency, Ignore state, membership and live lease. Superseded chains cancel; ordinary stale batches return PT409 for bounded durable retry. An older evaluation cannot overwrite a newer one. Reads, snapshot pages and delivery eligibility reject stale rules/revisions/time. Save remains independent from Ignore, which suppresses normal delivery; Unignore enqueues reassessment. Historical notification claims and feedback survive all reranks.

Rendered parts freeze only bounded rule/score/revision/time exposure metadata. An authorized callback retrieves that original shown context, not the latest score guessed afterward. Save/Unsave and Ignore/Undo Ignore are desired-state actions; tracked Open is weak intent, and a direct URL click records nothing. No feedback changes weights.

## Calibration workflow and open gate

`deno task ranking:synthetic` writes the public, sanitized 24-item/eleven-type technical review. Its labels are authored test expectations. Test thresholds 40/60/70/80/90 are demonstrations, not a personal selection. The report shows false positives at 40/60 and false negatives at 90. Default 40 remains explicitly provisional. Small samples, phrase vocabulary, unsupported eligibility and source coverage limit conclusions.

For actual calibration, the researcher supplies explicit preferences/timezone and reviews up to 24 representative persisted/sanitized opportunities. Keep their input in ignored `private/ranking-review.json`, then run `deno task ranking:review`. It validates profile rules and writes only ignored `private/ranking-review.md`; no network/database/threshold mutation occurs. Input is bounded to 512 KiB; clocks require explicit ISO offsets and unsupported top-level fields reject. Input fields: `schema_version:1`, `kind:"researcher"`, explicit `timezone`, `rules`, ISO `clock`, up to eight numeric `thresholds`, and 1–24 `items` with synthetic/sanitized UUID `id`, `draft` (existing OpportunityDraft), ISO `first_seen_at`, and optional `expected` label relevant/irrelevant/uncertain. Review the initial artifact, add labels, rerun, then explicitly record agreed configuration/threshold/rationale and only sanitized aggregate evidence publicly. Never commit the private inputs or copy them into public documentation.

The researcher has supplied no personal preferences/calibration outcome in this session. Actual validation of those facts, bounded human labels, threshold rationale/false-positive/false-negative review and final profile UI confirmation remain mandatory. Phase 08 stays active; Phase 09 stays pending. The future `ShortlistReranker` interface accepts an already eligible bounded shortlist and must fall back to deterministic order on failure; no provider is implemented.
