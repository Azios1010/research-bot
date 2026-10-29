import { assert, equals, rejects } from "../support.ts";
import { fundingFixtures, fundingPage, grantFixture } from "../grants_support.ts";
import { GrantsAdapter } from "../../supabase/functions/_shared/adapters/sources/grantsgov/adapter.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { calendar } from "../../supabase/functions/_shared/adapters/sources/grantsgov/mapping.ts";
const adapter = new GrantsAdapter();
Deno.test("real federal instruments map to one grant and one distinct research funding call with calendar evidence", async () => {
  const rows = [...adapter.parsePage(fundingPage(await fundingFixtures()))];
  equals(rows.map((r) => r.kind), ["record", "record"]);
  assert(rows[0].kind === "record" && rows[1].kind === "record");
  const grant = await normalize(rows[0].draft), funding = await normalize(rows[1].draft);
  equals(grant.fields.type, "grant");
  equals(funding.fields.type, "research_funding");
  equals(grant.fields.status, "open");
  equals(funding.fields.countryCodes, []);
  equals(grant.fields.workMode, "unknown");
  equals(grant.fields.publishedAt, null);
  equals(grant.deadlines[0].dueDate, "2026-11-10");
  equals(grant.deadlines[0].dueAt, null);
  equals(funding.deadlines[0].dueDate, "2026-11-04");
  const facts = grant.fields.attributes.funding as {
    posted_date: string;
    eligibility: { applicant_types: unknown[]; nationality: unknown };
  };
  equals(facts.posted_date, "2026-09-01");
  assert(facts.eligibility.applicant_types.length > 0);
  equals(facts.eligibility.nationality, null);
  assert(JSON.stringify(rows).length < 16000);
});
Deno.test("forecast is not open, estimated date is labeled, closed and archived remain distinct source evidence", async () => {
  const fixtures = await fundingFixtures(),
    realForecast = JSON.parse(await grantFixture("forecast-outside-scope.json"));
  // Explicit synthetic NSF/ST forecast using the observed federal forecast schema; not a live claim.
  const doc = {
    ...fixtures[0].detail.data.synopsis,
    estApplicationResponseDateStr: realForecast.data.forecast.estApplicationResponseDateStr,
  };
  fixtures[0].detail.data = {
    ...fixtures[0].detail.data,
    docType: "forecast",
    synopsis: null,
    forecast: doc,
  };
  fixtures[0].search.data.oppHits[0].oppStatus = "forecasted";
  const row = [...adapter.parsePage(fundingPage(fixtures))][0];
  assert(row.kind === "record");
  const n = await normalize(row.draft);
  equals(n.fields.status, "unknown");
  equals(n.deadlines[0].dueDate, "2027-02-01");
  assert(n.deadlines[0].label.includes("forecast"));
  for (const status of ["closed", "archived"]) {
    const f = await fundingFixtures();
    f[0].search.data.oppHits[0].oppStatus = status;
    const r = [...adapter.parsePage(fundingPage(f))][0];
    assert(r.kind === "record");
    equals(r.draft.status, "closed");
    assert(JSON.stringify(r.draft.attributes).includes(status));
  }
});
Deno.test("mixed instruments are one grant, nonresearch scope and malformed middle records are explicit exclusions", async () => {
  const fixtures = await fundingFixtures();
  fixtures[0].detail.data.synopsis.fundingInstruments.push({
    id: "CA",
    description: "Cooperative Agreement",
  });
  const rows = [...adapter.parsePage(fundingPage(fixtures))];
  assert(rows[0].kind === "record");
  equals(rows[0].draft.type, "grant");
  fixtures[0].detail.data.synopsis.fundingActivityCategories = [{ id: "AR", description: "Arts" }];
  equals([...adapter.parsePage(fundingPage(fixtures))].map((r) => r.kind), ["error", "record"]);
  fixtures[0].detail.data.synopsis.fundingActivityCategories = [{
    id: "ST",
    description: "Research",
  }];
  fixtures[0].detail.data.synopsis.fundingInstruments = [{
    id: "PC",
    description: "Procurement Contract",
  }];
  equals(
    ([...adapter.parsePage(fundingPage(fixtures))][0] as { code: string }).code,
    "excluded_funding_instrument",
  );
  const outside = JSON.parse(await grantFixture("forecast-outside-scope.json")),
    p = fundingPage(fixtures);
  p.payload = JSON.stringify({
    schemaVersion: 1,
    records: [{ hit: outside.hit, detail: outside.data, error: null }],
    scope: [{}, {}],
  });
  equals(([...adapter.parsePage(p)][0] as { code: string }).code, "excluded_agency_scope");
});
Deno.test("deadline and amendment version never identify a funding call, reused programme portal/cycle stays distinct", async () => {
  const fixtures = await fundingFixtures(),
    before = [...adapter.parsePage(fundingPage(fixtures))][0];
  assert(before.kind === "record");
  fixtures[0].detail.data.synopsis.responseDateStr = "2026-11-12-00-00-00";
  fixtures[0].detail.data.revision++;
  const changed = [...adapter.parsePage(fundingPage(fixtures))][0];
  assert(changed.kind === "record");
  equals(changed.sourceRecordKey, before.sourceRecordKey);
  equals((await normalize(changed.draft)).fingerprint, (await normalize(before.draft)).fingerprint);
  fixtures[0].detail.data.opportunityNumber = "27-999";
  fixtures[0].search.data.oppHits[0].number = "27-999";
  const newCycle = [...adapter.parsePage(fundingPage(fixtures))][0];
  assert(newCycle.kind === "record");
  assert(newCycle.sourceRecordKey !== before.sourceRecordKey);
  assert(
    (await normalize(newCycle.draft)).identities[0].value !==
      (await normalize(before.draft)).identities[0].value,
  );
});
Deno.test("missing rolling dates and bounded eligibility remain unknown rather than excluding a person", async () => {
  const fixtures = await fundingFixtures();
  fixtures[0].detail.data.synopsis.responseDateStr = "Open until filled";
  fixtures[0].detail.data.synopsis.applicantEligibilityDesc = "é".repeat(5000);
  const r = [...adapter.parsePage(fundingPage(fixtures))][0];
  assert(r.kind === "record");
  const n = await normalize(r.draft);
  equals(n.deadlines[0].dueAt, null);
  equals(n.deadlines[0].dueDate, null);
  equals(n.deadlines[0].rawValue, "Open until filled");
  const eligibility = (n.fields.attributes.funding as {
    eligibility: {
      additional_information: string;
      additional_information_truncated: boolean;
      residency: unknown;
    };
  }).eligibility;
  assert(eligibility.additional_information_truncated);
  assert(new TextEncoder().encode(eligibility.additional_information).length <= 2048);
  equals(eligibility.residency, null);
  equals(calendar("02/29/2028"), "2028-02-29");
  await rejects(() => calendar("02/29/2027"));
  await rejects(() => calendar("2026-11-01-23-59-00"));
});
