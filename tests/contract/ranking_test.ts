import { executeLease } from "../../supabase/functions/_shared/application/worker.ts";
import type { Lease, Repository } from "../../supabase/functions/_shared/application/ports.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { parseRules } from "../../supabase/functions/_shared/domain/profile.ts";
import type { Assessment } from "../../supabase/functions/_shared/domain/assessment.ts";
import { assert, equals } from "../support.ts";
import { handleInteraction } from "../../supabase/functions/_shared/application/interaction.ts";
import { TelegramRenderer } from "../../supabase/functions/_shared/adapters/telegram/render.ts";
import { sampleContext } from "../telegram_support.ts";

Deno.test("reranking uses persisted context only and never source or HTTP IO", async () => {
  const now = "2031-01-01T00:00:00.000Z";
  const o = {
    ...await normalize({ type: "phd", title: "MRI research" }),
    id: "synthetic",
    revision: 2,
    evidenceVersion: "opaque",
    firstSeenAt: now,
    provenance: {},
  };
  const lease: Lease = {
    id: "task",
    owner: "owner",
    generation: 4,
    kind: "assess_batch",
    attempt: 1,
    leaseUntil: "2031-01-01T00:01:30Z",
    runId: null,
  };
  let stored: readonly Assessment[] = [];
  const repository = {
    assessment: () =>
      Promise.resolve({
        profile: {
          id: "profile",
          revision: 5,
          timezone: "UTC",
          enabled: true,
          rules: parseRules({ positive_topics: ["MRI"] }),
        },
        opportunities: [o],
        enabledTypes: ["phd"],
        states: { synthetic: { saved: true, ignored: true } },
      }),
    storeAssessments: (_l: Lease, a: readonly Assessment[]) => {
      stored = a;
      return Promise.resolve(a.length);
    },
  } as unknown as Repository;
  await executeLease(lease, {
    repository,
    adapters: new Map(),
    clock: { now: () => now },
    logger: { log: () => {} },
    http: {
      request: () => {
        throw new Error("source IO forbidden");
      },
    },
  }, new AbortController().signal);
  equals(stored.length, 1);
  equals(stored[0].score, null);
  equals(stored[0].reasonCodes, ["ignored"]);
  equals(stored[0].profileRevision, 5);
  for (const key of ["chat_id", "callback_query", "message_id", "telegram"]) {
    assert(!JSON.stringify(stored).includes(key));
  }
});
Deno.test("profile UI shows explicit preferences and validated errors through application ports", async () => {
  const context = sampleContext();
  context.action = { kind: "command", command: "profile", invalid: true };
  context.profile.preferences = parseRules({
    positive_topics: [{ phrase: "medical imaging", weight: 3, aliases: ["MRI"] }],
    preferred_countries: ["DE"],
    reminder_offsets: [7, 1],
  });
  let text = "";
  await handleInteraction({
    id: "00000000-0000-4000-8000-000000000001",
    owner: "owner",
    generation: 1,
    kind: "telegram_command",
    attempt: 1,
    leaseUntil: "2031-01-01T00:01:00Z",
    runId: null,
  }, {
    repository: {
      execute: () => Promise.resolve(context),
      browse: () => {
        throw new Error("no direct profile query");
      },
      commitReply: (_l, p) => {
        text = p.map((v) => v.text).join("\n");
        return Promise.resolve();
      },
    },
    clock: { now: () => "2031-01-01T00:00:00Z" },
    renderer: new TelegramRenderer(),
  });
  for (
    const label of [
      "no settings changed",
      "mri",
      "DE",
      "7d",
      "institutions",
      "reminders",
      "timezone",
      "weights",
      "offsets",
    ]
  ) assert(text.includes(label), label);
  assert(!text.includes("positive_topics"));
  assert(!text.includes("service_role"));
});
