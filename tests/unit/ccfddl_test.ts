import { assert, equals, rejects } from "../support.ts";
import { adapter, document, fixture, page, records } from "../ccfddl_support.ts";
import {
  clockEvidence,
  eventDates,
} from "../../supabase/functions/_shared/adapters/sources/ccfddl/mapping.ts";
import { safeYaml } from "../../supabase/functions/_shared/adapters/sources/ccfddl/yaml.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { normalizeTime } from "../../supabase/functions/_shared/domain/temporal.ts";

Deno.test("real SIGMOD fixture maps seven editions and sixteen distinct 2027 deadlines", async () => {
  const items = records(await fixture());
  equals(items.length, 7);
  const last = await normalize(items[6].draft);
  equals(last.fields.type, "conference");
  equals(last.fields.cycleKey, "2027");
  equals(last.fields.trackKey, "main");
  equals(last.fields.countryCodes, ["US"]);
  equals(last.fields.eventStart, "2027-06-13");
  equals(last.fields.eventEnd, "2027-06-19");
  equals(last.fields.organization, null);
  equals(last.fields.publishedAt, null);
  equals(last.fields.workMode, "unknown");
  equals(last.fields.status, "unknown");
  equals(last.deadlines.length, 16);
  assert(
    last.deadlines.every((d) =>
      d.precision === "date" && d.dueAt === null && d.basis === "source_default" &&
      d.timezone === "AoE"
    ),
  );
  assert(last.deadlines.some((d) => d.kind === "abstract" && d.roundKey === "round-4"));
  equals((await normalize(items[4].draft)).fields.eventStart, null);
  equals(items[0].draft.workMode, "hybrid");
});
Deno.test("malformed edition and unknown deadline fields preserve valid siblings", async () => {
  const data = await document();
  const editions = data[0].confs as Record<string, unknown>[];
  editions[1].link = 42;
  const items = [...adapter.parsePage(page(JSON.stringify(data)))];
  equals(items.map((r) => r.kind), [
    "record",
    "error",
    "record",
    "record",
    "record",
    "record",
    "record",
  ]);
  equals(items[1].sourceRecordKey, "ccfddl-v1:DB:SIGMOD:sigmod22:main");
  editions[0].timeline = [{ deadline: "TBD", camera_ready_deadline: "TBD" }];
  equals([...adapter.parsePage(page(JSON.stringify(data)))][0].kind, "error");
});
Deno.test("optional scalars and Unicode remain source evidence, not guessed facts", async () => {
  const data = await document(), editions = data[0].confs as Record<string, unknown>[];
  data[0].description = "Données, 研究 and e\u0301";
  editions[0].unrelated_optional_note = "harmless";
  editions[0].timeline = [{ deadline: "TBD" }];
  delete editions[0].timezone;
  const normalized = await normalize(records(JSON.stringify(data))[0].draft);
  assert(normalized.fields.description!.includes("é"));
  equals(normalized.deadlines[0].precision, "unknown");
  equals(normalized.deadlines[0].timezone, "AoE");
  equals(normalized.fields.publishedAt, null);
});
Deno.test("document failure, schema drift and valid empty are distinct", async () => {
  equals([...adapter.parsePage(page("[]"))], []);
  for (const payload of ["", "null", "{broken", "{conferences: []}", "[{title: OTHER}]"]) {
    await rejects(() => [...adapter.parsePage(page(payload))]);
  }
});

Deno.test("duplicate edition IDs stay visible for shared distinct-key accounting; unlabeled rounds stay ambiguous", async () => {
  const data = await document(), editions = data[0].confs as Record<string, unknown>[];
  data[0].confs = [editions[0], editions[0]];
  const duplicate = [...adapter.parsePage(page(JSON.stringify(data)))];
  equals(duplicate.length, 2);
  equals(duplicate[0].sourceRecordKey, duplicate[1].sourceRecordKey);
  data[0].confs = [{
    ...editions[0],
    timeline: [{ deadline: "2027-01-01" }, { deadline: "2027-02-01" }],
  }];
  const item = [...adapter.parsePage(page(JSON.stringify(data)))][0];
  assert(item.kind === "record");
  const normalized = await normalize(item.draft);
  equals(normalized.deadlines, []);
  assert(normalized.fields.qualityFlags.includes("ambiguous_round"));
  equals(item.draft.deadlines!.map((d) => d.value), ["2027-01-01", "2027-02-01"]);
  data[0].confs = [];
  equals([...adapter.parsePage(page(JSON.stringify(data)))], []);
});
Deno.test("YAML rejects aliases, anchors, tags, merges, duplicate/prototype keys and depth bombs", async () => {
  for (
    const payload of [
      "a: &x [1]\nb: *x",
      "!!js/function 'x'",
      "a: 1\na: 2",
      "__proto__: x",
      "x: {<<: x}",
      "[".repeat(30) + "]".repeat(30),
      "%YAML 1.1\n---\na: on",
    ]
  ) {
    await rejects(() => safeYaml(payload, 16384));
  }
  await rejects(() => safeYaml("x".repeat(16385), 16384), "response_too_large");
});
Deno.test("timezone policy preserves explicit offsets, PT DST, AoE, default clocks and unknowns", () => {
  equals(
    normalizeTime(clockEvidence("2026-07-07 17:00:00", "PT")).dueAt,
    "2026-07-08T00:00:00.000Z",
  );
  equals(
    normalizeTime(clockEvidence("2026-01-07 17:00:00", "PT")).dueAt,
    "2026-01-08T01:00:00.000Z",
  );
  equals(normalizeTime(clockEvidence("2026-07-07 17:00:00", "PT")).timezone, "PT");
  equals(
    normalizeTime(clockEvidence("2026-07-07 17:00:00", "UTC+8")).dueAt,
    "2026-07-07T09:00:00.000Z",
  );
  equals(
    normalizeTime(clockEvidence("2026-07-07 17:00:00", "AoE")).dueAt,
    "2026-07-08T05:00:00.000Z",
  );
  equals(normalizeTime(clockEvidence("2026-07-07T17:00:00+03:00", "UTC")).basis, "explicit");
  equals(normalizeTime(clockEvidence("2026-07-07 23:59:59", "AoE")).precision, "date");
  equals(normalizeTime(clockEvidence("2026-11-01 01:30:00", "PT")).precision, "unknown");
  equals(normalizeTime(clockEvidence("2026-07-07 17:00:00", "ambiguous")).precision, "unknown");
  for (const value of ["2026-07-07", "TBD", "unknown", "rolling"]) {
    assert(clockEvidence(value, "AoE").value === value);
  }
  equals(eventDates("June 22 and June 24-26, 2025"), [null, null]);
});
