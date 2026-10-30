import { handleInteraction } from "../../supabase/functions/_shared/application/interaction.ts";
import { TelegramRenderer } from "../../supabase/functions/_shared/adapters/telegram/render.ts";
import { parseRules } from "../../supabase/functions/_shared/domain/profile.ts";
import { explainAssessment } from "../../supabase/functions/_shared/application/ranking.ts";
import { sampleContext, sampleItem } from "../../tests/telegram_support.ts";

const context = sampleContext();
context.profile = {
  ...context.profile,
  enabled: true,
  timezone: "UTC",
  topics: ["medical imaging", "machine learning"],
  types: ["phd", "conference"],
  remindersEnabled: false,
  preferences: parseRules({
    positive_topics: [{ phrase: "medical imaging", weight: 3, aliases: ["MRI"] }, {
      phrase: "machine learning",
      weight: 1,
      aliases: ["AI"],
    }],
    enabled_types: ["phd", "conference"],
    type_weights: { phd: 1, conference: 0.5 },
    preferred_countries: ["DE"],
    excluded_countries: ["US"],
    preferred_institutions: ["Example Institute"],
    reminder_offsets: [30, 7, 1],
  }),
};
let artifact = "Synthetic 38-column text review; no live Telegram or personal settings.\n\n";
const item = sampleItem();
item.score = 82;
item.reasons = ["topic_match", "type_preference", "deadline_usefulness"];
item.explanation = explainAssessment(item.reasons, {
  matched_terms: ["medical imaging"],
  date_only_advisory: true,
  quality_flags: ["unknown_work_mode"],
});
for (
  const action of [{ kind: "command" as const, command: "profile" as const }, {
    kind: "details" as const,
    opportunityId: item.id,
  }]
) {
  context.action = action;
  await handleInteraction({
    id: "00000000-0000-4000-8000-000000000001",
    owner: "preview",
    generation: 1,
    kind: "telegram_command",
    attempt: 1,
    leaseUntil: "2031-01-01T00:01:30Z",
    runId: null,
  }, {
    repository: {
      execute: () => Promise.resolve(context),
      browse: () => Promise.resolve({ items: [item] }),
      commitReply: (_l, parts) => {
        artifact += `VIEW ${action.kind}\n`;
        for (const part of parts) {
          const plain = part.text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll(
            "&quot;",
            '"',
          ).replaceAll("&#39;", "'").replaceAll("&amp;", "&");
          for (const line of plain.split("\n")) {
            const chars = [...line];
            while (chars.length) artifact += chars.splice(0, 38).join("") + "\n";
            if (!line) {
              artifact += "\n";
            }
          }
          artifact += part.buttons.map((r) => r.map((b) => `[${b.label}]`).join(" ")).join("\n") +
            "\n\n";
        }
        return Promise.resolve();
      },
    },
    renderer: new TelegramRenderer(),
    clock: { now: () => "2031-01-01T00:00:00Z" },
  });
}
await Deno.writeTextFile("docs/verification/phase08-rendering.txt", artifact);
console.log("PASS: synthetic profile/details mobile text preview written.");
