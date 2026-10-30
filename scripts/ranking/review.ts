import {
  assess,
  orderAssessments,
  rulesVersion,
} from "../../supabase/functions/_shared/domain/assessment.ts";
import { parseRules } from "../../supabase/functions/_shared/domain/profile.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { instant, validZone } from "../../supabase/functions/_shared/domain/temporal.ts";
import {
  type ObjectValue,
  type OpportunityDraft,
} from "../../supabase/functions/_shared/domain/model.ts";
import { explainAssessment } from "../../supabase/functions/_shared/application/ranking.ts";

// Offline review, not training or a database mutation. Personal inputs/results stay ignored.
try {
  const read = async (path: string) => {
    if ((await Deno.stat(path)).size > 524288) throw new Error("review_input_too_large");
    return JSON.parse(await Deno.readTextFile(path));
  };
  const synthetic = Deno.args[0] === "--synthetic";
  const golden = synthetic ? await read("tests/fixtures/ranking/golden.json") : null;
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
  const input = synthetic
    ? {
      schema_version: 1,
      kind: "synthetic",
      timezone: "UTC",
      rules: golden.profile,
      clock: golden.clock,
      thresholds: [40, 60, 70, 80, 90],
      items: golden.cases.map((
        c: { name: string; changes: ObjectValue; label: string },
        i: number,
      ) => ({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        draft: { ...base, ...c.changes },
        first_seen_at: "2030-12-31T00:00:00Z",
        expected: c.label,
      })),
    }
    : await read("private/ranking-review.json");
  if (
    input.schema_version !== 1 || !["synthetic", "researcher"].includes(input.kind) ||
    !validZone(input.timezone) || !instant(input.clock) ||
    Object.keys(input).some((k) =>
      !["schema_version", "kind", "timezone", "rules", "clock", "thresholds", "items"].includes(k)
    ) ||
    !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 24 ||
    !Array.isArray(input.thresholds) || input.thresholds.length > 8 ||
    input.thresholds.some((n: unknown) =>
      typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100
    )
  ) throw new Error("review_input_invalid");
  const rules = parseRules(input.rules),
    profile = { id: "review", revision: 1, timezone: input.timezone, enabled: true, rules };
  const entries = await Promise.all(
    input.items.map(
      async (
        item: { id: string; draft: OpportunityDraft; first_seen_at: string; expected?: string },
      ) => {
        if (
          !/^[a-f0-9-]{36}$/.test(item.id) || !instant(item.first_seen_at) ||
          item.expected !== undefined &&
            !["relevant", "irrelevant", "uncertain"].includes(item.expected)
        ) throw new Error("review_item_invalid");
        const o = {
          ...await normalize(item.draft),
          id: item.id,
          revision: 1,
          evidenceVersion: "review",
          firstSeenAt: item.first_seen_at,
          provenance: {},
        };
        return {
          o,
          label: item.expected ?? "unreviewed",
          a: assess(o, profile, { saved: false, ignored: false }, input.clock),
        };
      },
    ),
  );
  const counts: Record<string, number> = {}, types: Record<string, number> = {};
  for (const e of entries) {
    counts[e.label] = (counts[e.label] ?? 0) + 1;
    types[e.o.fields.type] = (types[e.o.fields.type] ?? 0) + 1;
  }
  const lines = [
    "# Bounded deterministic relevance review",
    "",
    `${
      input.kind === "synthetic"
        ? "Synthetic technical fixture; not researcher calibration."
        : "Private researcher review; do not commit this artifact."
    } Rule: ${rulesVersion}. Sample: ${entries.length}.`,
    "",
    `Labels: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}. Types: ${
      Object.entries(types).map(([k, v]) => `${k} ${v}`).join(", ")
    }.`,
    "",
    "| Threshold | False positives | False negatives | Uncertain admitted |",
    "| --- | --- | --- | --- |",
  ];
  for (const threshold of input.thresholds) {
    const admitted = (e: typeof entries[number]) => e.a.eligible && (e.a.score ?? -1) >= threshold;
    lines.push(
      `| ${threshold} | ${
        entries.filter((e) => e.label === "irrelevant" && admitted(e)).length
      } | ${entries.filter((e) => e.label === "relevant" && !admitted(e)).length} | ${
        entries.filter((e) => e.label === "uncertain" && admitted(e)).length
      } |`,
    );
  }
  lines.push(
    "",
    "No threshold is selected automatically. The default 40 is provisional. Review false positives/negatives and a broader category mix before personal acceptance; this small set supports no statistical generalization.",
    "",
    "## Review items",
    "",
  );
  for (const a of orderAssessments(entries.map((e) => e.a))) {
    const e = entries.find((e) => e.a === a)!;
    lines.push(
      `- ${e.o.fields.title.replace(/[\r\n|<>]/g, " ")} · ${e.o.fields.type} · ${
        a.score ?? "excluded"
      }/100 · ${e.label}`,
      `  ${explainAssessment(a.reasonCodes, a.components).join("; ")}`,
      "",
    );
  }
  const path = synthetic
    ? "docs/verification/phase08-synthetic-review.md"
    : "private/ranking-review.md";
  await Deno.writeTextFile(path, lines.join("\n") + "\n");
  console.log(
    `PASS: bounded ${
      synthetic ? "synthetic" : "private"
    } review prepared; no profile/database/threshold changed.`,
  );
} catch {
  console.error(
    "Review validation failed; details withheld. Check schema, bounds, explicit timezone and labels. No database work ran.",
  );
  Deno.exitCode = 1;
}
