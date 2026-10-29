import { assert, equals } from "../support.ts";
import { BathAdapter } from "../../supabase/functions/_shared/adapters/sources/bath/adapter.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { reconcile } from "../../supabase/functions/_shared/domain/reconcile.ts";
import { assess, parseRules } from "../../supabase/functions/_shared/domain/assessment.ts";
import type {
  CandidateSet,
  Opportunity,
  Origin,
} from "../../supabase/functions/_shared/domain/model.ts";
const origin: Origin = {
  sourceId: "employer",
  sourceSlug: "bath-research",
  sourceRecordKey: "bath-v1:SS13981",
  parserVersion: "bath-rss-v1",
  observedAt: "2026-10-29T00:00:00Z",
  authority: 100,
};
async function setup() {
  const xml = await Deno.readTextFile(new URL("../fixtures/bath/research.xml", import.meta.url));
  const r = [...new BathAdapter().parsePage({
    payload: xml,
    format: "rss",
    sourceUrl: "https://www.bath.ac.uk/jobs/rss/rss.aspx?cat=391",
    sourceRevision: null,
    fetchedAt: origin.observedAt,
    validators: {},
    nextCursor: null,
    notModified: false,
  })][2];
  assert(r.kind === "record");
  const n = await normalize(r.draft),
    o: Opportunity = {
      ...n,
      id: "canonical",
      revision: 1,
      evidenceVersion: "token",
      firstSeenAt: origin.observedAt,
      provenance: { title: origin, organization: origin },
    };
  const candidates: CandidateSet = {
    recordKey: "aggregate:SS13981",
    observationId: null,
    observationOpportunityId: null,
    strongIds: [o.id],
    candidates: [o],
    truncated: false,
  };
  return { r, n, o, candidates };
}
Deno.test("employer and sanitized portal overlap merges reviewed listing identity while employer field authority wins", async () => {
  const { r, o, candidates } = await setup();
  // Handwritten portal projection of the same official vacancy, not a live aggregator collector.
  const incoming = await normalize({ ...r.draft, title: "Research Associate — portal wording" }),
    merged = await reconcile(incoming, candidates, {
      ...origin,
      sourceId: "portal",
      sourceSlug: "sanitized-portal",
      authority: 10,
      observedAt: "2026-10-29T01:00:00Z",
    });
  equals(merged.targetId, o.id);
  equals(merged.canonical.fields.title, o.fields.title);
  equals(merged.provenance.title.sourceId, "employer");
});
Deno.test("equal job fingerprints with two hiring candidates never force a merge, and new-cycle evidence conflicts safely", async () => {
  const { r, n, o, candidates } = await setup(),
    weak = await normalize({ ...r.draft, identities: [] });
  equals(weak.fingerprint, n.fingerprint);
  const ambiguous = await reconcile(weak, {
    ...candidates,
    strongIds: [],
    candidates: [o, { ...o, id: "another-hire" }],
  }, origin);
  equals(ambiguous.targetId, undefined);
  assert(ambiguous.canonical.fields.qualityFlags.includes("conflicting_identity_candidate"));
  const repost = await reconcile(
    await normalize({ ...r.draft, cycleKey: "SS13981R" }),
    candidates,
    origin,
  );
  equals(repost.targetId, undefined);
  assert(repost.anticipatedConflict);
});
Deno.test("existing deterministic assessment uses explicit qualification conflicts; unknown eligibility stays eligible", async () => {
  const { o } = await setup(),
    profile = {
      id: "synthetic",
      revision: 1,
      timezone: null,
      enabled: true,
      rules: parseRules({ compatible_qualifications: ["doctoral_completed_or_nearing"] }),
    },
    state = { saved: false, ignored: false };
  assert(assess(o, profile, state, "2026-10-29T00:00:00Z").eligible);
  const blocked = assess(
    o,
    {
      ...profile,
      rules: parseRules({ incompatible_qualifications: ["doctoral_completed_or_nearing"] }),
    },
    state,
    "2026-10-29T00:00:00Z",
  );
  assert(!blocked.eligible && blocked.reasonCodes.includes("qualification_conflict"));
  assert(
    assess(
      { ...o, fields: { ...o.fields, qualificationTags: [], countryCodes: [] } },
      profile,
      state,
      "2026-10-29T00:00:00Z",
    ).eligible,
  );
});
