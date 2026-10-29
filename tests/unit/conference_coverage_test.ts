import { assert, equals, rejects } from "../support.ts";
import { fixture, page } from "../ccfddl_support.ts";
import { CcfddlAdapter } from "../../supabase/functions/_shared/adapters/sources/ccfddl/adapter.ts";
import { hotosManifest } from "../../supabase/functions/_shared/adapters/sources/ccfddl/manifest.ts";
import { OpenreviewCallAdapter } from "../../supabase/functions/_shared/adapters/sources/openreview/adapter.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { openreviewManifest } from "../../supabase/functions/_shared/adapters/sources/openreview/manifest.ts";

export const callFixture = () =>
  Deno.readTextFile(new URL("../fixtures/openreview/invitation.json", import.meta.url));
Deno.test("HotOS is an explicit real workshop with biennial editions, event dates and source-default deadline", async () => {
  const adapter = new CcfddlAdapter(hotosManifest),
    items = [
      ...adapter.parsePage({
        ...page(await fixture("hotos.yml")),
        sourceUrl: hotosManifest.endpoint,
      }),
    ];
  equals(items.length, 4);
  const normalized = [];
  for (const item of items) {
    assert(item.kind === "record");
    normalized.push(await normalize(item.draft));
  }
  equals(normalized.map((n) => n.fields.cycleKey), ["2021", "2023", "2025", "2027"]);
  equals(normalized[0].fields.workMode, "remote");
  equals(normalized[2].fields.countryCodes, ["CA"]);
  const last = normalized[3];
  equals(last.fields.type, "workshop");
  equals(last.fields.eventStart, "2027-05-24");
  equals(last.fields.eventEnd, "2027-05-26");
  equals(last.fields.countryCodes, ["DE"]);
  equals(last.deadlines.length, 2);
  assert(
    last.deadlines.every((d) =>
      d.roundKey === "main" && d.basis === "source_default" && d.dueAt === null
    ),
  );
  equals(last.identities.length, 1);
});
Deno.test("real standalone workshop-proposal call uses API due time, not expiry or event date", async () => {
  const adapter = new OpenreviewCallAdapter(),
    items = [
      ...adapter.parsePage({
        ...page(await callFixture()),
        format: "json",
        sourceUrl: openreviewManifest.endpoint,
      }),
    ];
  equals(items.length, 1);
  const item = items[0];
  assert(item.kind === "record");
  const normalized = await normalize(item.draft);
  equals(normalized.fields.type, "conference_cfp");
  equals(normalized.fields.trackKey, "workshop-proposals");
  equals(normalized.fields.organization, null);
  equals(normalized.fields.publishedAt, null);
  equals(normalized.fields.eventStart, null);
  equals(normalized.fields.workMode, "unknown");
  equals(normalized.deadlines[0].dueAt, "2026-10-10T13:00:00.000Z");
  equals(normalized.deadlines[0].basis, "explicit");
  assert(
    !JSON.stringify(item).includes("instructions") && JSON.stringify(item.metadata).length < 2048,
  );
  const data = JSON.parse(await callFixture());
  data.invitations[0].duedate += 86400000;
  const updated = [...adapter.parsePage({ ...page(JSON.stringify(data)), format: "json" })][0];
  assert(updated.kind === "record");
  equals(updated.sourceRecordKey, item.sourceRecordKey);
  equals((await normalize(updated.draft)).fingerprint, normalized.fingerprint);
});
Deno.test("OpenReview handles explicit empty, malformed/API-error document, private/wrong invitation and optional fields", async () => {
  const adapter = new OpenreviewCallAdapter();
  equals([...adapter.parsePage(page('{"invitations":[]}'))], []);
  for (
    const text of [
      "{",
      "{}",
      '{"name":"InvitationExpiredError"}',
      '{"invitations":{},"count":0}',
      '{"invitations":[],"count":1}',
    ]
  ) await rejects(() => [...adapter.parsePage(page(text))]);
  for (
    const change of [
      { id: "Other/-/Submission" },
      { readers: ["restricted"] },
      { duedate: "tomorrow" },
      { nonreaders: ["someone"] },
      { ddate: 1 },
    ]
  ) {
    const data = JSON.parse(await callFixture());
    Object.assign(data.invitations[0], change);
    equals([...adapter.parsePage(page(JSON.stringify(data)))][0].kind, "error");
  }
  const data = JSON.parse(await callFixture());
  delete data.invitations[0].duedate;
  data.invitations[0].unrelated_optional = { not_retained: true };
  const item = [...adapter.parsePage(page(JSON.stringify(data)))][0];
  assert(item.kind === "record");
  equals((await normalize(item.draft)).deadlines[0].precision, "unknown");
  assert(!JSON.stringify(item).includes("not_retained"));
});
