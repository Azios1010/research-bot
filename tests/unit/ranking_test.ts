import {
  assess,
  orderAssessments,
  parseRules,
  phraseMatch,
  rulesVersion,
} from "../../supabase/functions/_shared/domain/assessment.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import type {
  ObjectValue,
  Opportunity,
  OpportunityDraft,
} from "../../supabase/functions/_shared/domain/model.ts";
import { parseCommand } from "../../supabase/functions/_shared/adapters/telegram/protocol.ts";
import { validateBasicPatch } from "../../supabase/functions/_shared/application/interaction.ts";
import { explainAssessment } from "../../supabase/functions/_shared/application/ranking.ts";
import { assert, equals, rejects } from "../support.ts";

const now = "2031-01-01T00:00:00.000Z", state = { saved: false, ignored: false };
const base: OpportunityDraft = {
  type: "phd",
  title: "MRI and machine learning",
  organization: "Example Institute",
  countryCodes: ["DE"],
  workMode: "remote",
  qualificationTags: ["masters"],
  deadlines: [{
    kind: "application",
    roundKey: "main",
    label: "Apply",
    value: "2031-01-25T00:00:00Z",
  }],
};
async function opportunity(changes: Partial<OpportunityDraft> = {}): Promise<Opportunity> {
  return {
    ...await normalize({ ...base, ...changes }),
    id: "00000000-0000-4000-8000-000000000001",
    revision: 3,
    evidenceVersion: "synthetic",
    firstSeenAt: "2030-12-31T00:00:00Z",
    provenance: {},
  };
}
const profile = (rules: ObjectValue = {}) => ({
  id: "synthetic",
  revision: 7,
  timezone: "UTC",
  enabled: true,
  rules: parseRules(rules),
});

Deno.test("synthetic golden set reproduces exact decisions components revisions rule and validity", async () => {
  const fixture = JSON.parse(await Deno.readTextFile("tests/fixtures/ranking/golden.json"));
  const p = profile(fixture.profile);
  for (const c of fixture.cases) {
    const o = await opportunity(c.changes), a = assess(o, p, state, fixture.clock);
    equals(a.eligible, c.eligible, c.name);
    equals(a.score, c.score, c.name);
    equals(a.rulesVersion, "deterministic-v2");
    equals(a.profileRevision, 7);
    equals(a.opportunityRevision, 3);
    equals(a.evaluatedAt, now);
    equals(a.validUntil, c.validUntil ?? "2031-01-02T00:00:00.000Z");
    if (c.eligible) {
      equals(a.components.topic_match, c.topic, c.name);
      equals(a.components.type_preference, c.typePoints ?? 15);
      equals(a.components.freshness, 10);
      const sum = [
        "topic_match",
        "type_preference",
        "geography_preference",
        "institution_preference",
        "deadline_usefulness",
        "freshness",
        "qualification_match",
      ].reduce((s, k) => s + Number(a.components[k]), 0);
      equals(a.score, sum);
      assert(sum >= 0 && sum <= 100);
      equals(assess(o, p, state, fixture.clock), a, "reproducible full result");
    } else {
      assert(a.reasonCodes.includes(c.reason), c.name);
      assert(!("topic_match" in a.components));
    }
  }
});
Deno.test("full exact golden components reconstruct 100 without hidden values", async () => {
  const a = assess(
    await opportunity(),
    profile({
      positive_topics: ["MRI"],
      type_weights: { phd: 1 },
      preferred_countries: ["DE"],
      preferred_institutions: ["Example Institute"],
      compatible_qualifications: ["masters"],
    }),
    state,
    now,
  );
  equals(a.components, {
    topic_match: 40,
    type_preference: 15,
    geography_preference: 10,
    institution_preference: 10,
    deadline_usefulness: 10,
    freshness: 10,
    qualification_match: 5,
    matched_terms: ["mri"],
    deadline_days: 24,
    quality_flags: ["missing_publication_time"],
    date_only_advisory: false,
  });
});
Deno.test("Unicode matching handles normalized accents mixed case aliases hyphenation and boundaries", () => {
  for (
    const [corpus, term] of [
      ["ARTIFICIAL Intelligence", "artificial intelligence"],
      ["Machine-learning", "machine learning"],
      ["medical — imaging", "medical imaging"],
      ["Nghiên cứu trí tuệ", "TRÍ TUỆ"],
      ["Cafe\u0301", "café"],
      ["MRI/NLP", "MRI"],
      ["ＡＩ", "AI"],
    ]
  ) assert(phraseMatch(corpus, term), `${corpus}: ${term}`);
  for (const corpus of ["malaria", "chair", "said", "AI_tools", "aix", "maïa"]) {
    assert(!phraseMatch(corpus, "AI"), corpus);
  }
});
Deno.test("explicit aliases count a topic once and weighted topics keep denominator reproducible", async () => {
  const p = profile({
    positive_topics: [{ phrase: "medical imaging", weight: 3, aliases: ["MRI"] }, {
      phrase: "machine learning",
      weight: 1,
      aliases: ["AI", "NLP"],
    }],
  });
  equals(
    assess(await opportunity({ title: "MRI medical imaging" }), p, state, now).components
      .topic_match,
    30,
  );
  equals(assess(await opportunity({ title: "NLP" }), p, state, now).components.topic_match, 10);
});
Deno.test("canonical long descriptions remain scoreable and match an explicit phrase near the end", async () => {
  const o = await opportunity({
    title: "Synthetic opportunity",
    description: "Research evidence. ".repeat(750) + " MRI",
    topics: [],
  });
  const a = assess(
    o,
    profile({ positive_topics: [{ phrase: "medical imaging", weight: 1, aliases: ["MRI"] }] }),
    state,
    now,
  );
  equals(a.components.topic_match, 40);
  assert(a.eligible);
  assert(!phraseMatch("research ".repeat(1600) + "malaria", "AI"));
});
Deno.test("exact deadline and freshness boundaries invalidate at the next changing millisecond", async () => {
  for (const [days, points] of [[2, 3], [3, 10], [30, 10], [31, 6], [90, 6], [91, 0]]) {
    const due = new Date(Date.parse(now) + days * 86400000).toISOString();
    const o = await opportunity({
      deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value: due }],
    });
    const a = assess(o, profile(), state, now);
    equals(a.components.deadline_usefulness, points);
    if ([3, 31, 91].includes(days)) equals(a.validUntil, "2031-01-01T00:00:00.001Z");
    equals(assess(o, profile(), state, due).eligible, false);
  }
  for (const [days, points] of [[7, 10], [30, 5], [31, 0]]) {
    const o = await opportunity();
    o.firstSeenAt = new Date(Date.parse(now) - days * 86400000).toISOString();
    const a = assess(o, profile(), state, now);
    equals(a.components.freshness, points);
    if (days <= 30) {
      equals(a.validUntil, "2031-01-01T00:00:00.001Z");
      equals(assess(o, profile(), state, a.validUntil).components.freshness, days === 7 ? 5 : 0);
    }
  }
});
Deno.test("date-only unknown rolling conflicted and subsecond expiry preserve precision", async () => {
  const date = await opportunity({
    deadlines: [{ kind: "application", roundKey: "main", label: "Apply", value: "2031-01-03" }],
  });
  const a = assess(date, { ...profile(), timezone: "Asia/Ho_Chi_Minh" }, state, now);
  equals(a.components.deadline_usefulness, 3);
  equals(a.components.date_only_advisory, true);
  equals(a.validUntil, "2031-01-01T17:00:00.000Z");
  for (const value of ["unknown", "rolling"]) {
    const o = await opportunity({
      deadlines: [{ kind: "application", roundKey: "main", label: value, value }],
    });
    equals(assess(o, profile(), state, now).components.deadline_usefulness, 0);
  }
  const o = await opportunity({
    deadlines: [{
      kind: "application",
      roundKey: "main",
      label: "Apply",
      value: "2031-01-01T00:00:00.100Z",
    }],
  });
  equals(assess(o, profile(), state, now).validUntil, "2031-01-01T00:00:00.100Z");
  o.deadlines[0].status = "conflicted";
  equals(assess(o, profile(), state, now).components.deadline_usefulness, 0);
});
Deno.test("already expired events retain a future assessment recheck without extending imminent expiry", async () => {
  const o = await opportunity({ type: "conference", eventEnd: "2030-12-01", deadlines: [] });
  const a = assess(o, profile(), state, now);
  equals(a.eligible, false);
  equals(a.score, null);
  assert(a.reasonCodes.includes("event_expired"));
  equals(a.validUntil, "2031-01-02T00:00:00.000Z");
});
Deno.test("unknown facts remain neutral unless excluded explicitly; ignore always beats save", async () => {
  const o = await opportunity({ countryCodes: [], qualificationTags: [], workMode: "unknown" });
  const p = profile({
    hard_countries: true,
    preferred_countries: ["VN"],
    excluded_countries: ["DE"],
  });
  const a = assess(o, p, state, now);
  assert(a.eligible);
  equals(a.components.geography_preference, 0);
  equals(a.components.qualification_match, 0);
  assert((a.components.quality_flags as string[]).includes("unknown_geography"));
  assert(!assess(o, profile({ unknown_policy: "exclude" }), state, now).eligible);
  const ignored = assess(o, p, { saved: true, ignored: true }, now);
  equals(ignored.score, null);
  equals(ignored.reasonCodes, ["ignored"]);
  assert(!assess(await opportunity(), p, state, now).eligible);
});
Deno.test("known eligibility conflict uses only structured source facts with multiple citizenship caution", async () => {
  const o = await opportunity({
    attributes: {
      position: { eligibility: { student_full_time: true, excluded_nationalities: ["VN"] } },
    },
  });
  assert(
    !assess(
      o,
      profile({ eligibility_facts: { student_full_time: false, nationalities: ["VN"] } }),
      state,
      now,
    ).eligible,
  );
  assert(
    assess(o, profile({ eligibility_facts: { nationalities: ["VN", "DE"] } }), state, now).eligible,
  );
  assert(assess(o, profile(), state, now).eligible);
});
Deno.test("stable ties are independent of input order and future refetch time", async () => {
  const a = assess(await opportunity(), profile(), state, now);
  const b = { ...a, opportunityId: "b" }, c = { ...a, opportunityId: "c", nextDeadline: null };
  const expected = [a.opportunityId, "b", "c"];
  equals(orderAssessments([c, b, a]).map((x) => x.opportunityId), expected);
  equals(orderAssessments([b, a, c]).map((x) => x.opportunityId), expected);
});
Deno.test("profile validation rejects malformed unsupported oversized and legacy unsafe state", async () => {
  const bad: ObjectValue[] = [
    { enabled_types: ["faculty"] },
    { type_weights: { phd: -1 } },
    { type_weights: { phd: 1.1 } },
    { preferred_countries: ["XX"] },
    { preferred_work_modes: ["anywhere"] },
    { positive_topics: Array(21).fill("MRI") },
    { positive_topics: ["a".repeat(161)] },
    { positive_topics: [{ phrase: "MRI", weight: 1, aliases: Array(11).fill("MRI") }] },
    { positive_topics: ["MRI", "mri"] },
    { reminder_offsets: [1.5] },
    { reminder_offsets: [-1] },
    { reminder_offsets: [366] },
    { unknown_policy: "maybe" },
    { arbitrary_secret: "forbidden" },
    { eligibility_facts: { degree: "inferred" } },
    { digest_threshold: 101 },
  ];
  for (const value of bad) await rejects(() => Promise.resolve(parseRules(value)));
  await rejects(
    () => Promise.resolve(validateBasicPatch({ timezone: "GMT+7" })),
    "profile_timezone_invalid",
  );
  await rejects(
    () => Promise.resolve(validateBasicPatch({ topics: ["medical  imaging", "medical imaging"] })),
    "profile_topics_invalid",
  );
  await rejects(
    () => Promise.resolve(validateBasicPatch({ digestTime: "24:00" })),
    "profile_schedule_invalid",
  );
  await rejects(
    () => Promise.resolve(validateBasicPatch({ preferences: { arbitrary: true } })),
    "profile_preferences_invalid",
  );
  equals(
    parseRules({ preferred_countries: ["de", "DE"], reminder_offsets: [7, 7, 1] })
      .preferredCountries,
    ["DE"],
  );
  equals(parseRules({}).eligibilityFacts, { studentFullTime: null, nationalities: [] });
});
Deno.test("explicit profile commands translate safely without arbitrary JSON and reject malformed edits", () => {
  for (
    const args of [
      "topics medical imaging^3|MRI; machine learning^1|AI",
      "weights phd=1,conference=0.5",
      "blocked weapons",
      "ignored advertising",
      "countries DE,VN",
      "excluded-countries US",
      "institutions Example Institute",
      "blocked-institutions Other Institute",
      "work-modes remote,hybrid",
      "qualifications masters",
      "conflicts clinical license",
      "student false",
      "nationalities VN",
      "unknown allow",
      "timezone UTC",
      "time 07:30",
      "offsets 30d,7d,1d",
      "reminders false",
      "digest false",
      "rerank",
    ]
  ) {
    const a = parseCommand(`/profile ${args}`, "TestBot");
    assert(a?.patch && !a.invalid, args);
  }
  for (
    const args of [
      "weights phd=-1",
      "weights phd=1,phd=0",
      "countries ZZ",
      "offsets 1.5d",
      "reminders maybe",
      "student yes",
      "nonsense {}",
      "topics MRI^0",
      "time 25:30",
      "unknown secret",
    ]
  ) {
    equals(parseCommand(`/profile ${args}`, "TestBot"), {
      kind: "command",
      command: "profile",
      invalid: true,
    }, args);
  }
});
Deno.test("explanations are bounded redacted translations rather than raw JSON", () => {
  const result = explainAssessment([
    "blocked_topic",
    "eligibility_conflict",
    "private_key_unrecognized",
  ], {
    matched_terms: ["MRI"],
    quality_flags: ["unknown_work_mode"],
    private_secret: "never display",
  });
  equals(result, ["Blocked topic", "Known eligibility conflict", "Note: Work mode unknown"]);
  assert(!JSON.stringify(result).includes("private"));
  equals(rulesVersion, "deterministic-v2");
});
