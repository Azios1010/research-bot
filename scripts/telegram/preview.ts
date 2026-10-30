import {
  handleInteraction,
  type ReplyModel,
  type ReplyPart,
} from "../../supabase/functions/_shared/application/interaction.ts";
import { TelegramRenderer } from "../../supabase/functions/_shared/adapters/telegram/render.ts";
import { replyKey, sampleContext, sampleItem, sampleModel } from "../../tests/telegram_support.ts";

// A credential-free 38-column mobile text review, not a live Telegram screenshot.
const renderer = new TelegramRenderer(), samples: { label: string; parts: ReplyPart[] }[] = [];
const details = sampleModel();
samples.push({
  label: "Details: multilingual, date-only, score, source link",
  parts: renderer.render(details, replyKey),
});
const list: ReplyModel = {
  ...sampleModel(),
  title: "Conferences",
  details: false,
  items: Array.from({ length: 3 }, (_, i) => ({
    ...sampleItem(),
    id: `30000000-0000-4000-8000-00000000000${i}`,
    type: "conference",
    notes: [],
    eventStart: "2027-06-01",
    eventEnd: "2027-06-03",
    title: i === 0
      ? "A very long conference title on multilingual research & reliable systems ".repeat(6)
      : `Synthetic conference ${i + 1}`,
    deadlines: i === 0
      ? [{
        label: "Paper submission",
        precision: "instant",
        status: "current",
        dueAt: "2027-01-15T12:00:00Z",
        dueDate: null,
        timezone: "UTC",
      }]
      : i === 1
      ? [{
        label: "Rolling applications",
        precision: "unknown",
        status: "current",
        dueAt: null,
        dueDate: null,
        timezone: null,
      }]
      : [{
        label: "Abstract",
        precision: "date",
        status: "conflicted",
        dueAt: null,
        dueDate: "2027-02-28",
        timezone: null,
      }],
  })),
  snapshot: {
    kind: "conferences",
    ids: ["one", "two", "three", "four"],
    offset: 0,
    expiresAt: "2026-10-30T10:30:00Z",
    revision: 1,
    capped: false,
  },
};
samples.push({
  label: "Three-item list: long title, exact, rolling, conflicting, pagination",
  parts: renderer.render(list, replyKey),
});
for (const command of ["saved", "profile"] as const) {
  const context = sampleContext();
  context.action = { kind: "command", command };
  await handleInteraction({
    id: replyKey,
    owner: "synthetic-owner",
    generation: 1,
    kind: "telegram_command",
    attempt: 1,
    leaseUntil: "2026-10-30T11:00:00Z",
    runId: null,
  }, {
    clock: { now: () => "2026-10-30T10:00:00Z" },
    renderer,
    repository: {
      execute: () => Promise.resolve(context),
      browse: () =>
        Promise.resolve({
          items: [],
          snapshot: {
            kind: "saved",
            ids: [],
            offset: 0,
            expiresAt: "2026-10-30T10:30:00Z",
            revision: 1,
            capped: false,
          },
        }),
      commitReply: (_, parts) => {
        samples.push({ label: `/${command}: empty/setup state`, parts });
        return Promise.resolve();
      },
    },
  });
}
const decode = (s: string) =>
  s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll(
    "&#39;",
    "'",
  ).replaceAll("&amp;", "&");
function wrap(s: string) {
  return s.split("\n").flatMap((line) => {
    const result: string[] = [];
    let part = "";
    for (const ch of line) {
      if ([...part].length === 38) {
        result.push(part);
        part = "";
      }
      part += ch;
    }
    result.push(part);
    return result;
  });
}
let output = "Phase 07 synthetic mobile text review\n38 columns; no live bot or screenshot\n\n";
for (const sample of samples) {
  output += sample.label + "\n";
  for (const [i, part] of sample.parts.entries()) {
    output += `--- message ${i + 1} ---\n` + wrap(decode(part.text)).join("\n") + "\n" +
      part.buttons.map((row) => row.map((b) => `[${b.label}]`).join(" ")).join("\n") + "\n\n";
  }
}
await Deno.writeTextFile("docs/verification/phase07-rendering.txt", output);
console.log("Rendered synthetic 38-column preview to docs/verification/phase07-rendering.txt");
