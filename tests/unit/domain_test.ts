import { assert, equals, rejects } from "../support.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import {
  type CandidateSet,
  type Opportunity,
  type OpportunityDraft,
  type Origin,
  type Value,
} from "../../supabase/functions/_shared/domain/model.ts";
import {
  boundedObject,
  countryCodes,
  key,
  safeUrl,
  stable,
  tags,
  text,
} from "../../supabase/functions/_shared/domain/primitives.ts";
import {
  dateOnly,
  instant,
  normalizeDeadline,
  normalizeTime,
} from "../../supabase/functions/_shared/domain/temporal.ts";
import { originWins, reconcile } from "../../supabase/functions/_shared/domain/reconcile.ts";
import {
  assess,
  orderAssessments,
  parseRules,
  phraseMatch,
} from "../../supabase/functions/_shared/domain/assessment.ts";

const now = "2031-01-01T00:00:00.000Z";
const base: OpportunityDraft = {
  type: "phd",
  title: " AI Research ",
  organization: "Example University",
  cycleKey: "2031",
  trackKey: "main",
  topics: ["AI"],
};
const origin: Origin = {
  sourceId: "a",
  sourceSlug: "alpha",
  sourceRecordKey: "v1:1",
  sourceRecordId: "observation-a",
  parserVersion: "v1",
  observedAt: now,
  authority: 0,
};
const empty: CandidateSet = {
  recordKey: "v1:1",
  observationId: null,
  observationOpportunityId: null,
  strongIds: [],
  candidates: [],
  truncated: false,
};
async function opportunity(draft: OpportunityDraft = base): Promise<Opportunity> {
  const normalized = await normalize(draft), result = await reconcile(normalized, empty, origin);
  return {
    ...normalized,
    id: "00000000-0000-4000-8000-000000000001",
    revision: 1,
    firstSeenAt: now,
    evidenceVersion: "fixture-evidence-v1",
    provenance: result.provenance,
  };
}
const profile = (rules = {}) => ({
  id: "p",
  enabled: true,
  revision: 1,
  timezone: "UTC",
  rules: parseRules(rules),
});
const state = { saved: false, ignored: false };

Deno.test("display NFC, comparison NFKC and whitespace have explicit policies", () => {
  equals(text("  Cafe\u0301\n lab  "), "Café lab");
  equals(key(" ＡＩ\t Research "), "ai research");
  equals(tags(["AI", " ai ", "Café"]), ["ai", "café"]);
  equals(countryCodes(["vn", "DE", "de"]), ["DE", "VN"]);
});
Deno.test("unsafe schemes, credentials and private network URLs cannot enter identities", async () => {
  for (
    const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/plain,a",
      "https://u:p@example.org/x",
      "http://127.1/a",
      "http://2130706433/a",
      "http://[::1]/",
      "https://localhost/x",
      "https://example.local/x",
      "https://a\\b.com/",
    ]
  ) await rejects(() => safeUrl(url));
  equals(
    safeUrl("https://EXAMPLE.org:443/Case?paper=7&utm_source=x&tokenless=y#top"),
    "https://example.org/Case?paper=7&tokenless=y",
  );
  assert(safeUrl("https://example.org/?edition=1") !== safeUrl("https://example.org/?edition=2"));
});
Deno.test("bounded JSON rejects depth, size and nonfinite numbers", async () => {
  await rejects(() => boundedObject({ data: "x".repeat(1000) }, 100));
  await rejects(() => stable({ n: Infinity }));
  await rejects(() => countryCodes(["UK"]));
  let nested: Value = {};
  for (let i = 0; i < 12; i++) nested = { nested };
  await rejects(() => boundedObject(nested, 10000));
  equals(stable({ z: 1, a: [2, 1] }), '{"a":[2,1],"z":1}');
});
Deno.test("unknown facts remain null/unknown, aliases and validated attributes are explicit", async () => {
  const n = await normalize({
    type: "journal_cfp",
    title: " Call ",
    organization: " Example Univ ",
    publishedAt: "2030-12-31",
    attributes: { journal: { name: "Example Journal", issn: "1234-567X" } },
  }, { organizationAliases: { "example univ": "Example University" } });
  equals(n.fields.organizationKey, "example university");
  equals(n.fields.workMode, "unknown");
  equals(n.fields.publishedAt, null);
  equals(n.fields.attributes.publication_date, "2030-12-31");
  equals(n.fields.cycleKey, null);
  assert(n.fields.qualityFlags.includes("missing_publication_time"));
  await rejects(
    () => normalize({ ...base, attributes: { journal: { name: "wrong family" } } }),
    "attributes_type_mismatch",
  );
  await rejects(() => normalize({ ...base, type: "unconfigured_type" }), "unsupported_type");
  await rejects(() => normalize({ ...base, title: "<script>unsafe</script>" }), "markup_in_title");
});
Deno.test("strict dates and offset instants preserve microseconds without inventing time", async () => {
  equals(instant("2031-01-01T07:00:00.123456+07:00"), "2031-01-01T00:00:00.123456Z");
  equals(dateOnly("2032-02-29"), "2032-02-29");
  await rejects(() => dateOnly("2031-02-29"));
  await rejects(() => instant("2031-01-01T24:00Z"));
  await rejects(() => instant("2031-01-01T12:00"));
  const t = normalizeTime({ value: "2031-02-03" });
  equals(t.dueAt, null);
  equals(t.dueDate, "2031-02-03");
  equals(t.precision, "date");
});
Deno.test("rolling/TBD, IANA timezone, DST ambiguity and AoE keep evidence", () => {
  for (const value of [null, "TBD", "rolling"]) {
    const n = normalizeTime({ value });
    equals(n.dueAt, null);
    equals(n.dueDate, null);
  }
  const known = normalizeTime({
    value: "2031-01-01 12:00",
    timezone: "Europe/Paris",
    basis: "explicit",
  });
  equals(known.dueAt, "2031-01-01T11:00:00.000Z");
  equals(known.timezone, "Europe/Paris");
  for (const value of ["2031-03-30 02:30", "2031-10-26 02:30"]) {
    const n = normalizeTime({ value, timezone: "Europe/Paris" });
    equals(n.precision, "unknown");
    assert(n.flags.includes("ambiguous_time"));
  }
  const unknown = normalizeTime({ value: "2031-01-01 12:00", timezone: "CST" });
  equals(unknown.dueAt, null);
  equals(unknown.timezone, "CST");
  equals(normalizeTime({ value: "2031-01-01 12:00", timezone: "AoE" }).dueAt, null);
  const aoe = normalizeTime({
    value: "2031-01-01 23:59",
    timezone: "AoE",
    basis: "source_default",
    aoeSupported: true,
  });
  equals(aoe.dueAt, "2031-01-02T11:59:00.000Z");
  equals(aoe.basis, "source_default");
});
Deno.test("stable rounds distinguish abstract/submission and ambiguous rounds are not numbered by date", async () => {
  const deadlines = [
    { kind: "abstract" as const, roundKey: "r1", label: "Abstract", value: "2031-02-01" },
    { kind: "submission" as const, roundKey: "r1", label: "Paper", value: "2031-02-08" },
    { kind: "submission" as const, roundKey: "r2", label: "Paper round 2", value: "TBD" },
  ];
  equals((await normalize({ ...base, deadlines })).deadlines.length, 3);
  const n = await normalize({ ...base, deadlines: [{ ...deadlines[0], roundKey: null }] });
  equals(n.deadlines.length, 0);
  assert(n.fields.qualityFlags.includes("ambiguous_round"));
  const conflict = await normalize({
    ...base,
    deadlines: [deadlines[0], { ...deadlines[0], value: "2031-02-02" }],
  });
  equals(conflict.deadlines[0].status, "conflicted");
  equals(conflict.deadlines[0].precision, "unknown");
});
Deno.test("versioned canonical identity is deterministic and excludes mutable deadline", async () => {
  const a = await normalize(base),
    b = await normalize({
      ...base,
      title: "ＡＩ  Research",
      deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value: "2031-03-01" }],
    });
  equals(a.fingerprint, b.fingerprint);
  equals(a.identities, b.identities);
  equals(a.fingerprint.length, 64);
  assert(a.fingerprint !== (await normalize({ ...base, cycleKey: "2032" })).fingerprint);
  assert(a.fingerprint !== (await normalize({ ...base, trackKey: "other" })).fingerprint);
  equals((await normalize({ ...base, organization: null })).identities.length, 0);
});
Deno.test("reviewed listing proof is required and edition evidence scopes event listing identities", async () => {
  const identities = [{
    kind: "listing_url" as const,
    value: "https://example.org/job/1",
    reviewed: true,
    listingSpecific: true,
  }];
  equals(
    (await normalize({ type: "phd", title: "Unknown employer", identities })).identities.length,
    1,
  );
  equals(
    (await normalize({
      type: "phd",
      title: "Unknown employer",
      identities: [{ ...identities[0], reviewed: false }],
    })).identities.length,
    0,
  );
  equals(
    (await normalize({ type: "conference", title: "Unknown edition", identities })).identities
      .length,
    0,
  );
});
Deno.test("source identity wins, ambiguous fingerprints stay separate and strong conflicts are explicit", async () => {
  const old = await opportunity(), incoming = await normalize({ ...base, organization: null });
  const weak = await reconcile(incoming, {
    ...empty,
    candidates: [{ ...old, fields: { ...old.fields, organization: null, organizationKey: null } }],
  }, origin);
  equals(weak.targetId, undefined);
  assert(weak.canonical.fields.qualityFlags.includes("conflicting_identity_candidate"));
  const known = await reconcile(incoming, {
    ...empty,
    observationOpportunityId: old.id,
    candidates: [old],
  }, origin);
  equals(known.targetId, old.id);
  equals(known.expectedEvidenceVersion, old.evidenceVersion);
  equals(known.canonical.fields.organization, old.fields.organization);
  assert(
    (await reconcile(incoming, { ...empty, strongIds: ["one", "two"] }, origin))
      .anticipatedConflict,
  );
  assert(
    (await reconcile(await normalize({ ...base, cycleKey: "2032" }), {
      ...empty,
      observationOpportunityId: old.id,
      candidates: [old],
    }, origin)).anticipatedConflict,
  );
});
Deno.test("field authority/freshness/slug and null preservation are deterministic", async () => {
  const old = await opportunity(),
    candidates = { ...empty, observationOpportunityId: old.id, candidates: [old] };
  old.provenance.title = { ...origin, authority: 50 };
  const incoming = await normalize({ ...base, title: "Updated title", organization: null });
  const low = await reconcile(incoming, candidates, {
    ...origin,
    sourceId: "b",
    sourceSlug: "beta",
    observedAt: "2031-02-01T00:00:00Z",
  });
  equals(low.canonical.fields.title, old.fields.title);
  equals(low.canonical.fields.organization, old.fields.organization);
  const high = await reconcile(incoming, candidates, { ...origin, sourceId: "b" }, { title: 100 });
  equals(high.canonical.fields.title, "Updated title");
  equals(high.provenance.title.sourceId, "b");
  assert(
    originWins({ ...origin, observedAt: "2031-01-01T08:00:00+07:00" }, {
      ...origin,
      observedAt: "2031-01-01T00:00:00Z",
    }),
  );
  assert(originWins(origin, { ...origin, sourceSlug: "zeta" }));
});
Deno.test("intrinsic conflicting evidence is not missing data and cannot leave an existing exact deadline usable", async () => {
  const old = await opportunity({
    ...base,
    deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value: "2031-02-01" }],
  });
  const incoming = await normalize({
    ...base,
    deadlines: [
      { kind: "application", roundKey: "main", label: "Apply", value: "2031-02-01" },
      { kind: "application", roundKey: "main", label: "Apply", value: "2031-02-08" },
    ],
  });
  equals(incoming.deadlines[0].precision, "unknown");
  equals(incoming.deadlines[0].status, "conflicted");
  const candidates = { ...empty, observationOpportunityId: old.id, candidates: [old] };
  const result = await reconcile(incoming, candidates, {
    ...origin,
    observedAt: "2031-01-02T00:00:00Z",
  });
  equals(result.canonical.deadlines[0].status, "conflicted");
  equals(result.canonical.deadlines[0].dueDate, "2031-02-01");
  assert(result.canonical.fields.qualityFlags.includes("conflicting_deadline"));
  old.provenance["deadline:application:main"] = { ...origin, authority: 80 };
  const stronger = await reconcile(incoming, candidates, {
    ...origin,
    sourceId: "weaker",
    observedAt: "2031-01-02T00:00:00Z",
  });
  equals(stronger.canonical.deadlines[0].status, "current");
  equals(stronger.canonical.deadlines[0].dueDate, "2031-02-01");
  assert(!stronger.canonical.fields.qualityFlags.includes("conflicting_deadline"));
});
Deno.test("deadline corrections keep identity and conflicting sources pause precise use", async () => {
  const old = await opportunity({
    ...base,
    deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value: "2031-02-01" }],
  });
  const n = await normalize({
    ...base,
    deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value: "2031-02-08" }],
  });
  const candidates = { ...empty, observationOpportunityId: old.id, candidates: [old] };
  const same = await reconcile(n, candidates, { ...origin, observedAt: "2031-01-02T00:00:00Z" });
  equals(same.canonical.deadlines[0].status, "current");
  equals(same.canonical.fingerprint, old.fingerprint);
  const other = await reconcile(n, candidates, {
    ...origin,
    sourceId: "b",
    observedAt: "2031-01-02T00:00:00Z",
  });
  equals(other.canonical.deadlines[0].status, "conflicted");
  const unknown = await normalize({
    ...base,
    deadlines: [{ kind: "application", roundKey: "main", label: "TBD", value: "TBD" }],
  });
  equals(
    (await reconcile(unknown, candidates, origin)).canonical.deadlines[0].dueDate,
    "2031-02-01",
  );
});
Deno.test("Unicode phrase boundaries handle technical terms without substring false positives", () => {
  assert(phraseMatch("C++ and machine learning research", "C++"));
  assert(phraseMatch("Nghiên cứu trí tuệ nhân tạo", "trí tuệ"));
  assert(!phraseMatch("JavaScript", "Java"));
  assert(!phraseMatch("malaria", "AI"));
});
Deno.test("eligibility precedes scores; ignore beats save and unknown is allowed by default", async () => {
  const o = await opportunity();
  const filtered = assess(
    o,
    profile({ positive_topics: ["AI"] }),
    { saved: true, ignored: true },
    now,
  );
  equals(filtered.eligible, false);
  equals(filtered.score, null);
  assert(filtered.reasonCodes.includes("ignored"));
  assert(!("topic_match" in filtered.components));
  assert(
    assess(o, profile({ hard_countries: true, preferred_countries: ["VN"] }), state, now).eligible,
  );
  assert(!assess(o, profile({ unknown_policy: "exclude" }), state, now).eligible);
  assert(!assess(o, profile({ blocked_topics: ["AI"] }), state, now).eligible);
  assert(!assess(o, profile(), state, now, []).eligible);
});
Deno.test("full deterministic score is bounded and explainable; re-fetch cannot reset freshness", async () => {
  const o = await opportunity({
    ...base,
    countryCodes: ["VN"],
    qualificationTags: ["masters"],
    deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value: "2031-01-15" }],
  });
  const p = profile({
    positive_topics: ["AI"],
    type_weights: { phd: 1 },
    preferred_countries: ["VN"],
    preferred_institutions: ["Example University"],
    compatible_qualifications: ["masters"],
  });
  const a = assess(o, p, state, now);
  equals(a.score, 100);
  equals(a.rulesVersion, "deterministic-v2");
  equals(a.components.date_only_advisory, true);
  equals(assess(o, p, state, "2031-02-15T00:00:00Z").eligible, false);
  const rolling = {
    ...o,
    deadlines: [
      normalizeDeadline({
        kind: "application",
        roundKey: "main",
        label: "Rolling",
        value: "rolling",
      }).deadline,
    ],
  };
  equals(assess(rolling, p, state, "2031-02-15T00:00:00Z").components.freshness, 0);
});
Deno.test("date-only expires conservatively; elapsed submission does not close a future event", async () => {
  const o = await opportunity({
    ...base,
    deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value: "2031-01-01" }],
  });
  assert(assess(o, profile(), state, "2031-01-02T11:59:00Z").eligible);
  assert(!assess(o, profile(), state, "2031-01-02T12:00:00Z").eligible);
  const event = await opportunity({
    ...base,
    type: "conference",
    eventStart: "2031-02-01",
    eventEnd: "2031-02-03",
    deadlines: [{ kind: "submission", roundKey: "main", label: "Paper", value: "2030-12-01" }],
  });
  assert(assess(event, profile(), state, now).eligible);
  assert(!assess(event, profile(), state, "2031-02-04T12:00:00Z").eligible);
});
Deno.test("stable ordering uses score, actionable deadline, first seen and UUID", async () => {
  const a = assess(await opportunity(), profile(), state, now);
  const b = { ...a, opportunityId: "b", nextDeadline: "2031-01-02T00:00:00Z" };
  const c = { ...b, opportunityId: "a" };
  equals(orderAssessments([a, b, c]).map((x) => x.opportunityId), ["a", "b", a.opportunityId]);
});

Deno.test("invalid optional publication stays honest and conflicted round prevents inferred expiry", async () => {
  const n = await normalize({ ...base, publishedAt: "2031-02-29" });
  equals(n.fields.publishedAt, null);
  assert(n.fields.qualityFlags.includes("invalid_optional_date"));
  equals(
    normalizeTime({ value: "2031-01-01T12:00", timezone: "Europe/Paris", basis: "unknown" })
      .precision,
    "unknown",
  );
  const o = await opportunity({
    ...base,
    deadlines: [
      { kind: "application", roundKey: "main", label: "Elapsed", value: "2030-01-01" },
      { kind: "application", roundKey: "uncertain", label: "Unresolved", value: "2031-02-01" },
    ],
  });
  o.deadlines[1].status = "conflicted";
  const result = assess(o, profile(), state, now);
  assert(result.eligible);
  equals(result.nextDeadline, null);
});

Deno.test("deadline score and qualification/geography exclusions honor exact rule boundaries", async () => {
  for (const [days, expected] of [[1, 3], [2, 3], [3, 10], [30, 10], [31, 6], [90, 6], [91, 0]]) {
    const value = new Date(Date.parse(now) + days * 86400000).toISOString();
    const o = await opportunity({
      ...base,
      countryCodes: ["DE"],
      qualificationTags: ["phd"],
      deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value }],
    });
    equals(assess(o, profile(), state, now).components.deadline_usefulness, expected);
    assert(
      !assess(o, profile({ hard_countries: true, preferred_countries: ["VN"] }), state, now)
        .eligible,
    );
    assert(!assess(o, profile({ incompatible_qualifications: ["phd"] }), state, now).eligible);
  }
});
