import { assert, equals } from "../support.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { SupabaseInteractions } from "../../supabase/functions/_shared/infrastructure/supabase/interactions.ts";
import {
  callbackData,
  losslessJson,
  translateUpdate,
} from "../../supabase/functions/_shared/adapters/telegram/protocol.ts";
import { TelegramRenderer } from "../../supabase/functions/_shared/adapters/telegram/render.ts";
import {
  handleInteraction,
  type InteractionAction,
  type ReplyPart,
} from "../../supabase/functions/_shared/application/interaction.ts";
import {
  config,
  messageFixture,
  replyKey,
  sampleContext,
  sampleModel,
} from "../telegram_support.ts";
import { assess, parseRules } from "../../supabase/functions/_shared/domain/assessment.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";

Deno.test("bodyless successful outcome RPC is preserved without a fabricated body or retry", async () => {
  let calls = 0;
  const store = new SupabaseInteractions(
    persistenceClient(
      "https://abcdefghijklmnopqrst.supabase.co",
      "synthetic-key-value-for-tests",
      () => {
        calls++;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    ),
  );
  await store.finishSend(
    {
      id: replyKey,
      owner: replyKey,
      generation: 1,
      kind: "send_notification",
      attempt: 1,
      leaseUntil: "2026-10-30T00:00:00Z",
      runId: null,
    },
    replyKey,
    { outcome: "sent", messageId: "100" },
  );
  equals(calls, 1);
});

Deno.test("Telegram receipt adapter uses text RPC arguments and never sends raw payloads", async () => {
  let calls = 0;
  const transport: typeof fetch = (input, init) => {
    calls++;
    assert(String(input).endsWith("/rpc/rr_receive_telegram"));
    const body = JSON.parse(String(init?.body));
    equals(body.p_update, "9007199254740995");
    equals(typeof body.p_user, "string");
    assert(!JSON.stringify(body).includes("username"));
    assert(!JSON.stringify(body).includes("message_id"));
    equals(body.p_action, { kind: "command", command: "start" });
    return Promise.resolve(new Response('{"duplicate":false,"status":"accepted"}'));
  };
  const store = new SupabaseInteractions(
    persistenceClient(
      "https://abcdefghijklmnopqrst.supabase.co",
      "synthetic-key-value-for-tests",
      transport,
    ),
  );
  const translated = translateUpdate(losslessJson(await messageFixture()), config);
  assert(translated);
  await store.accept(translated, config.botId);
  equals(calls, 1);
});
Deno.test("application actions and rendered reply plans expose no Telegram DTOs", async () => {
  const context = sampleContext(),
    action: InteractionAction = { kind: "details", opportunityId: sampleModel().items[0].id };
  context.action = action;
  let parts: ReplyPart[] = [];
  await handleInteraction({
    id: replyKey,
    owner: "owner",
    generation: 1,
    kind: "telegram_command",
    attempt: 1,
    leaseUntil: "2026-10-30T00:00:00Z",
    runId: null,
  }, {
    clock: { now: () => "2026-10-30T00:00:00Z" },
    renderer: new TelegramRenderer(),
    repository: {
      execute: () => Promise.resolve(context),
      browse: () => Promise.resolve({ items: sampleModel().items }),
      commitReply: (_, p) => {
        parts = p;
        return Promise.resolve();
      },
    },
  });
  const body = JSON.stringify({ action, parts });
  for (const name of ["callback_query", "message_id", "chat_id", "parse_mode", "inline_keyboard"]) {
    assert(!body.includes(name));
  }
  assert(
    parts.some((p) => p.buttons.flat().some((b) => b.action === callbackData("s", replyKey, 0))),
  );
});
Deno.test("projection failure after authorized context produces a safe durable temporary reply", async () => {
  const context = sampleContext();
  context.action = { kind: "command", command: "jobs" };
  let text = "";
  await handleInteraction({
    id: replyKey,
    owner: "owner",
    generation: 1,
    kind: "telegram_command",
    attempt: 1,
    leaseUntil: "2026-10-30T00:00:00Z",
    runId: null,
  }, {
    clock: { now: () => "2026-10-30T00:00:00Z" },
    renderer: new TelegramRenderer(),
    repository: {
      execute: () => Promise.resolve(context),
      browse: () => Promise.reject(new Error("credential-bearing private failure")),
      commitReply: (_, p) => {
        text = p.map((p) => p.text).join("");
        return Promise.resolve();
      },
    },
  });
  assert(text.includes("temporarily unavailable"));
  assert(!text.includes("credential"));
});
Deno.test("enabled profile types are an exclusion before deterministic scoring", async () => {
  const now = "2026-10-30T00:00:00Z";
  const normalized = await normalize({
    type: "phd",
    title: "Synthetic topic",
    canonicalUrl: "https://example.invalid/item",
  });
  const result = assess(
    {
      ...normalized,
      id: replyKey,
      revision: 1,
      evidenceVersion: "fixture",
      firstSeenAt: now,
      provenance: {},
    },
    {
      id: "profile",
      enabled: true,
      revision: 1,
      timezone: "UTC",
      rules: parseRules({ enabled_types: ["conference"], positive_topics: ["synthetic"] }),
    },
    { saved: false, ignored: false },
    now,
  );
  equals(result.eligible, false);
  equals(result.score, null);
  assert(result.reasonCodes.includes("disabled_type"));
});
