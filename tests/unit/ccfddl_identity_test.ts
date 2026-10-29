import { assert, equals } from "../support.ts";
import { FakeSourceAdapter } from "../../supabase/functions/_shared/adapters/sources/fake/adapter.ts";
import { fixture, page, records } from "../ccfddl_support.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { reconcile } from "../../supabase/functions/_shared/domain/reconcile.ts";
import type {
  CandidateSet,
  Opportunity,
  Origin,
} from "../../supabase/functions/_shared/domain/model.ts";

const origin: Origin = {
  sourceId: "source",
  sourceSlug: "reviewed-fixture",
  sourceRecordKey: "reviewed",
  parserVersion: "fake-json-v1",
  observedAt: "2026-10-29T10:00:00Z",
  authority: 0,
};
async function setup() {
  const original = records(await fixture()).at(-1)!;
  const normalized = await normalize(original.draft);
  const opportunity: Opportunity = {
    ...normalized,
    id: "canonical",
    revision: 1,
    evidenceVersion: "evidence",
    firstSeenAt: "2026-10-28T00:00:00Z",
    provenance: {},
  };
  const candidates: CandidateSet = {
    recordKey: "reviewed",
    observationId: null,
    observationOpportunityId: null,
    strongIds: [opportunity.id],
    candidates: [opportunity],
    truncated: false,
  };
  return { original, normalized, opportunity, candidates };
}
Deno.test("changed deadlines preserve key fingerprint and semantic round; annual editions differ", async () => {
  const original = records(await fixture()),
    changed = records((await fixture()).replace("2026-10-17 23:59:59", "2026-10-20 23:59:59"));
  const before = await normalize(original[6].draft), after = await normalize(changed[6].draft);
  equals(original[6].sourceRecordKey, changed[6].sourceRecordKey);
  equals(before.fingerprint, after.fingerprint);
  equals(before.identities, after.identities);
  equals(
    before.deadlines.map((d) => [d.kind, d.roundKey]),
    after.deadlines.map((d) => [d.kind, d.roundKey]),
  );
  assert(before.deadlines.some((d) => d.dueDate === "2026-10-17"));
  assert(after.deadlines.some((d) => d.dueDate === "2026-10-20"));
  assert((await normalize(original[5].draft)).fingerprint !== before.fingerprint);
});
Deno.test("second sanitized source merges only reviewed compatible strong listing identity", async () => {
  const test = await setup();
  const item = [...new FakeSourceAdapter().parsePage({
    ...page(await fixture("second-source.json")),
    format: "json",
  })][0];
  assert(item.kind === "record");
  const next = await normalize(item.draft);
  equals(next.identities, test.normalized.identities);
  const merged = await reconcile(next, test.candidates, origin, { eventEnd: 60 });
  equals(merged.targetId, "canonical");
  equals(merged.canonical.fields.eventEnd, "2027-06-18");
  assert(merged.provenance.eventEnd.sourceSlug === "reviewed-fixture");
});
Deno.test("candidate-only same fingerprint remains separate and flagged without sufficient organization evidence", async () => {
  const test = await setup();
  const weak = await normalize({ ...test.original.draft, identities: [] });
  equals(weak.fingerprint, test.normalized.fingerprint);
  const result = await reconcile(weak, { ...test.candidates, strongIds: [] }, origin);
  equals(result.targetId, undefined);
  assert(result.canonical.fields.qualityFlags.includes("conflicting_identity_candidate"));
});
Deno.test("reused homepage across edition or track cannot override incompatible identity", async () => {
  const test = await setup();
  for (const change of [{ cycleKey: "2028" }, { trackKey: "industry" }]) {
    const next = await normalize({ ...test.original.draft, ...change });
    assert(next.fingerprint !== test.normalized.fingerprint);
    assert(JSON.stringify(next.identities) !== JSON.stringify(test.normalized.identities));
    const result = await reconcile(next, test.candidates, origin);
    equals(result.targetId, undefined);
    assert(result.anticipatedConflict);
  }
  const noStrong = await normalize({
    ...test.original.draft,
    canonicalUrl: "https://sigmod.org/",
    identities: [],
  });
  equals(noStrong.identities.length, 0);
});

Deno.test("joint SIGMOD PODS homepage is candidate-only; only reviewed dedicated SIGMOD call is strong", async () => {
  const items = records(await fixture());
  equals((await normalize(items[5].draft)).identities, []);
  const proof = items[6].draft.identities!;
  equals(proof.length, 1);
  equals(proof[0].value, "https://2027.sigmod.org/calls_papers_sigmod_research.shtml");
  assert(proof[0].value !== items[6].draft.canonicalUrl);
});
