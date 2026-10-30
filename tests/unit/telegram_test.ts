import { assert, equals, rejects } from "../support.ts";
import {
  callbackData,
  decodeCallback,
  losslessJson,
  numericId,
  parseCommand,
  translateUpdate,
} from "../../supabase/functions/_shared/adapters/telegram/protocol.ts";
import { webhookHandler } from "../../supabase/functions/_shared/adapters/telegram/webhook.ts";
import {
  deadlineText,
  escapeHtml,
  splitText,
  TelegramRenderer,
} from "../../supabase/functions/_shared/adapters/telegram/render.ts";
import { TelegramDelivery } from "../../supabase/functions/_shared/adapters/telegram/delivery.ts";
import {
  deliverReply,
  handleInteraction,
  profileMissing,
  type ReplyPart,
  validateBasicPatch,
} from "../../supabase/functions/_shared/application/interaction.ts";
import type { Lease } from "../../supabase/functions/_shared/application/ports.ts";
import { healthView } from "../../supabase/functions/_shared/infrastructure/supabase/interactions.ts";
import {
  callbackFixture,
  config,
  messageFixture,
  replyKey,
  sampleContext,
  sampleItem,
  sampleModel,
  syntheticBot,
  syntheticUser,
} from "../telegram_support.ts";

const lease: Lease = {
  id: replyKey,
  owner: "owner",
  generation: 1,
  kind: "telegram_command",
  attempt: 1,
  leaseUntil: "2026-10-30T10:00:00Z",
  runId: null,
};
const clock = { now: () => "2026-10-30T09:59:00Z" };
function request(body: string, headers: Record<string, string> = {}, method = "POST") {
  return new Request("https://example.invalid/webhook", {
    method,
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": config.secret,
      ...headers,
    },
    ...(method !== "GET" ? { body } : {}),
  });
}

Deno.test("Telegram numeric identifiers cross JSON and translation without rounding", async () => {
  const parsed = losslessJson(await messageFixture()), accepted = translateUpdate(parsed, config);
  equals(accepted?.updateId, "9007199254740995");
  equals(accepted?.binding.userId, syntheticUser);
  equals(numericId("9223372036854775807"), "9223372036854775807");
  for (const input of [9007199254740995, "1e3", "01", "-1", "9223372036854775808"]) {
    await rejects(() => Promise.resolve(numericId(input)), "telegram_id_invalid");
  }
  const strings = losslessJson(
    '{"update_id":1001,"message":{"text":"escaped \\"id\\": 9007199254740995","id":1e3}}',
  );
  equals(strings.update_id, "1001");
  await rejects(() => Promise.resolve(losslessJson('{"update_id":01}')));
  await rejects(
    () => Promise.resolve(losslessJson("[".repeat(33) + "0" + "]".repeat(33))),
    "telegram_json_depth",
  );
});
Deno.test("all eleven command fixtures translate; username is never authority", async () => {
  const cases = JSON.parse(await Deno.readTextFile("tests/fixtures/telegram/cases.json"));
  for (const cmd of cases.commands) {
    equals(translateUpdate(losslessJson(await messageFixture(cmd)), config)?.action, {
      kind: "command",
      command: cmd,
    });
  }
  equals(parseCommand("/unknown", config.botUsername), { kind: "command", command: "unknown" });
  equals(parseCommand("/today@another_bot", config.botUsername), null);
  equals(parseCommand("/HELP@SYNTHETIC_BOT", config.botUsername), {
    kind: "command",
    command: "help",
  });
  equals(parseCommand("/profile topics machine learning; dữ liệu", config.botUsername)?.patch, {
    topics: ["machine learning", "dữ liệu"],
  });
  equals(parseCommand("/profile digest false", config.botUsername)?.patch, {
    digestEnabled: false,
  });
  assert(!parseCommand("/profile timezone invented", config.botUsername)?.patch);
});
Deno.test("versioned callback encoding enforces byte limit and fixed action grammar", async () => {
  for (const c of ["s", "u", "i", "r", "d", "p", "o"] as const) {
    const encoded = callbackData(c, replyKey, 2);
    assert(new TextEncoder().encode(encoded).length <= 64);
    equals(decodeCallback(encoded), { code: c, key: replyKey, index: 2 });
  }
  for (
    const bad of [
      "2:s:" + "a".repeat(32) + ":0",
      "1:s:profile:0",
      "😀".repeat(20),
      "1:x:" + "a".repeat(32) + ":0",
      "1:s:" + "a".repeat(32) + ":3",
    ]
  ) await rejects(() => Promise.resolve(decodeCallback(bad)));
});
Deno.test("ingress rejects secrets methods content type bodies and malformed input before private work", async () => {
  let privateCalls = 0;
  const handler = webhookHandler({
    config,
    inbox: () => {
      privateCalls++;
      throw new Error("must not construct");
    },
    acknowledge: async () => {},
  });
  const body = await messageFixture();
  for (
    const [r, status] of [
      [request(body, {}, "GET"), 405],
      [request(body, { "X-Telegram-Bot-Api-Secret-Token": "" }), 401],
      [request(body, { "X-Telegram-Bot-Api-Secret-Token": "wrong" }), 401],
      [request(body, { "content-type": "text/plain" }), 415],
      [request("{"), 400],
      [request("x".repeat(65537)), 413],
      [request(body, { "content-length": "65537" }), 413],
    ] as const
  ) equals((await handler(r)).status, status);
  equals(privateCalls, 0);
  equals(
    (await webhookHandler({
      config: { ...config, secret: "" },
      inbox: () => {
        throw 0;
      },
      acknowledge: async () => {},
    })(request(body))).status,
    503,
  );
});
Deno.test("unauthorized user group mismatched chat and callback sender cannot construct repositories", async () => {
  let privateCalls = 0, acknowledgements = 0;
  const handler = webhookHandler({
      config,
      inbox: () => {
        privateCalls++;
        throw 0;
      },
      acknowledge: () => {
        acknowledgements++;
        return Promise.resolve();
      },
    }),
    body = await messageFixture();
  for (
    const b of [
      body.replaceAll(syntheticUser, "20000000000000002"),
      body.replace('"private"', '"group"'),
      body.replace('"chat": { "id": ' + syntheticUser, '"chat": { "id": 20000000000000002'),
      callbackFixture(callbackData("s", replyKey, 0), { sender: "20000000000000002" }),
      callbackFixture(callbackData("s", replyKey, 0), { bot: "333" }),
    ]
  ) equals((await handler(request(b))).status, 200);
  equals(privateCalls, 0);
  equals(acknowledgements, 2);
});
Deno.test("durable receipt failures retry while duplicates and out of order updates get 2xx", async () => {
  const seen = new Set<string>();
  const effects: string[] = [];
  const handler = webhookHandler({
    config,
    inbox: () => ({
      accept: (input) => {
        const duplicate = seen.has(input.updateId);
        seen.add(input.updateId);
        if (!duplicate) effects.push(input.updateId);
        return Promise.resolve({ duplicate, status: "accepted" });
      },
    }),
    acknowledge: async () => {},
  });
  for (const id of ["1002", "1002", "1001"]) {
    equals((await handler(request(await messageFixture("start", id)))).status, 200);
  }
  equals(effects, ["1002", "1001"]);
  const down = webhookHandler({
    config,
    inbox: () => ({
      accept: () => Promise.reject(new Error("private credentials must never escape")),
    }),
    acknowledge: async () => {},
  });
  const response = await down(request(await messageFixture()));
  equals(response.status, 503);
  assert(!(await response.text()).includes("credentials"));
});
Deno.test("supported callbacks acknowledge before durable work even if acknowledgement fails", async () => {
  const order: string[] = [];
  const handler = webhookHandler({
    config,
    inbox: () => ({
      accept: () => {
        order.push("accept");
        return Promise.resolve({ duplicate: false, status: "accepted" });
      },
    }),
    acknowledge: () => {
      order.push("ack");
      return Promise.reject(new Error("timeout"));
    },
  });
  equals((await handler(request(callbackFixture(callbackData("s", replyKey, 0))))).status, 200);
  equals(order, ["ack", "accept"]);
  equals((await handler(request(callbackFixture("malformed")))).status, 200);
});
Deno.test("HTML rendering escapes hostile multilingual text; split parts preserve Unicode and markup", () => {
  equals(escapeHtml('<a href="_">&\'😀'), "&lt;a href=&quot;_&quot;&gt;&amp;&#39;😀");
  const plain = ('Tiếng Việt <>&_" 😀東京 ').repeat(700), chunks = splitText(plain);
  equals(chunks.join(""), plain);
  assert(chunks.every((c) => c.length <= 3000 && !/[\uD800-\uDBFF]$/.test(c)));
  const renderer = new TelegramRenderer(), model = sampleModel();
  model.items[0].title = "Long & <title> 😀 ".repeat(100);
  const parts = renderer.render(model, replyKey);
  assert(parts.length <= 10);
  assert(parts.some((p) => p.text.includes("&lt;title&gt;")));
  assert(parts.every((p) => !p.text.includes("<title>")));
  model.items[0].url = "javascript:alert(1)";
  assert(!renderer.render(model, replyKey).some((p) => p.buttons.flat().some((b) => b.url)));
});
Deno.test("deadline rendering does not manufacture countdown precision", () => {
  const d = sampleItem().deadlines[0];
  assert(deadlineText(d).includes("date only"));
  assert(deadlineText({ ...d, status: "conflicted" }).includes("conflicting"));
  assert(
    deadlineText({ ...d, precision: "unknown", dueDate: null, label: "Rolling application" })
      .includes("rolling"),
  );
  assert(deadlineText({ ...d, precision: "unknown", dueDate: null }).includes("unknown"));
});
Deno.test("basic profile validation requires explicit timezone topics types before enablement", async () => {
  for (
    const value of [
      { timezone: "No/SuchZone" },
      { digestTime: "25:00" },
      { types: ["invented"] },
      { topics: [""] },
      { enabled: "true" },
      { unknown: true },
      { topics: Array.from({ length: 20 }, (_, i) => `${i}${"ữ".repeat(159)}`) },
    ]
  ) await rejects(() => Promise.resolve(validateBasicPatch(value)));
  equals(profileMissing(sampleContext().profile), ["timezone", "topics", "types"]);
  equals(
    validateBasicPatch({
      timezone: "Asia/Ho_Chi_Minh",
      topics: ["dữ liệu", "dữ liệu"],
      types: ["postdoc"],
    }),
    { timezone: "Asia/Ho_Chi_Minh", topics: ["dữ liệu"], types: ["postdoc"] },
  );
});
Deno.test("every command returns bounded useful content and persists one logical reply", async () => {
  for (
    const command of [
      "start",
      "help",
      "today",
      "deadlines",
      "conferences",
      "jobs",
      "journals",
      "saved",
      "profile",
      "refresh",
      "status",
    ] as const
  ) {
    const context = sampleContext();
    context.action = { kind: "command", command };
    context.result = { status: "queued", queued: 2 };
    let reply: ReplyPart[] = [];
    await handleInteraction(lease, {
      clock,
      renderer: new TelegramRenderer(),
      repository: {
        execute: () => Promise.resolve(context),
        browse: () =>
          Promise.resolve({
            items: [],
            snapshot: {
              kind: command as "saved",
              ids: [],
              offset: 0,
              expiresAt: "2026-10-30T10:29:00Z",
              revision: 1,
              capped: false,
            },
          }),
        commitReply: (_, parts) => {
          reply = parts;
          return Promise.resolve();
        },
      },
    });
    assert(reply.length > 0 && reply.length <= 10, command);
    assert(reply.every((p) => p.text.length < 24000));
    if (command === "today") assert(reply.some((p) => p.text.includes("Setup incomplete")));
  }
});
Deno.test("desired state and tracked open actions are explicit; direct URL has no telemetry", async () => {
  for (const desired of ["save", "unsave", "ignore", "unignore", "open_intent"] as const) {
    const context = sampleContext();
    context.action = { kind: "feedback", desired, opportunityId: sampleItem().id };
    let prepared = 0;
    await handleInteraction(lease, {
      clock,
      renderer: new TelegramRenderer(),
      repository: {
        execute: () => Promise.resolve(context),
        browse: () => Promise.resolve({ items: [sampleItem()] }),
        commitReply: () => {
          prepared++;
          return Promise.resolve();
        },
      },
    });
    equals(prepared, 1);
  }
  const buttons = new TelegramRenderer().render(sampleModel(), replyKey).flatMap((p) =>
    p.buttons.flat()
  );
  assert(buttons.some((b) => b.url && !b.action));
  assert(buttons.some((b) => b.action?.startsWith("1:o:")));
});
Deno.test("status mapper drops raw errors and credential fields", () => {
  const clean = healthView({
    ...sampleContext().health,
    raw_error: "credential secret",
    connection: "private",
    sources: [{ name: "Synthetic source", lastSuccess: null, stale: true, secret: "private" }],
  });
  assert(!JSON.stringify(clean).includes("private"));
  assert(!JSON.stringify(clean).includes("credential"));
});

Deno.test("refresh decisions return queued active throttled and unavailable without collection IO", async () => {
  const expected = {
    queued: "Queued 2",
    active: "already queued",
    throttled: "five minutes",
    unavailable: "temporarily unavailable",
  };
  for (const status of ["queued", "active", "throttled", "unavailable"] as const) {
    const context = sampleContext();
    context.action = { kind: "command", command: "refresh" };
    context.result = { status, queued: 2 };
    let text = "";
    await handleInteraction(lease, {
      clock,
      renderer: new TelegramRenderer(),
      repository: {
        execute: () => Promise.resolve(context),
        browse: () => {
          throw new Error("Refresh cannot browse or collect synchronously");
        },
        commitReply: (_, parts) => {
          text = parts.map((part) => part.text).join("");
          return Promise.resolve();
        },
      },
    });
    assert(text.includes(expected[status]));
  }
});

Deno.test("Bot API mock success rate limit permanent timeout and server ambiguity classification", async () => {
  const cases: [number, unknown, string][] = [
    [200, {
      ok: true,
      result: {
        message_id: "9007199254740997",
        chat: { id: syntheticUser },
        from: { id: syntheticBot, is_bot: true },
      },
    }, "sent"],
    [429, { ok: false, error_code: 429, parameters: { retry_after: 37 } }, "retryable_failure"],
    [429, { ok: false, error_code: 429 }, "retryable_failure"],
    [403, { ok: false, error_code: 403 }, "permanent_failure"],
    [400, { ok: false, error_code: 400 }, "permanent_failure"],
    [500, { ok: false, error_code: 500 }, "uncertain"],
    [200, { ok: true, result: {} }, "uncertain"],
  ];
  for (const [status, body, outcome] of cases) {
    let calls = 0;
    const transport: typeof fetch = (_input, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      equals(payload.parse_mode, "HTML");
      equals(payload.chat_id, syntheticUser);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    const delivery = new TelegramDelivery(`${syntheticBot}:${"x".repeat(40)}`, transport),
      result = await delivery.send(
        { account: syntheticUser, bot: syntheticBot },
        new TelegramRenderer().render(sampleModel(), replyKey)[0],
      );
    equals(result.outcome, outcome);
    equals(calls, 1);
    if (status === 429) equals(result.retrySeconds, "parameters" in (body as object) ? 37 : 60);
    if (outcome === "sent") equals(result.messageId, "9007199254740997");
  }
  const delivery = new TelegramDelivery(
    `${syntheticBot}:${"x".repeat(40)}`,
    () => Promise.reject(new Error("private token URL")),
  );
  equals(
    (await delivery.send(
      { account: syntheticUser, bot: syntheticBot },
      new TelegramRenderer().render(sampleModel(), replyKey)[0],
    )).outcome,
    "uncertain",
  );
});
Deno.test("sending marker precedes IO; crash after possible send leaves unresolved marker", async () => {
  const order: string[] = [];
  const part = new TelegramRenderer().render(sampleModel(), replyKey)[0];
  await rejects(() =>
    deliverReply({ ...lease, kind: "send_notification" }, {
      repository: {
        begin: () => {
          order.push("persist sending");
          return Promise.resolve({
            disposition: "sending",
            attemptId: "attempt",
            part,
            destination: { account: syntheticUser, bot: syntheticBot },
          });
        },
        finishSend: () => {
          order.push("outcome write failed");
          return Promise.reject(new Error("crash"));
        },
      },
      delivery: {
        send: () => {
          order.push("external IO");
          return Promise.resolve({ outcome: "sent" as const, messageId: "100" });
        },
      },
    })
  );
  equals(order, ["persist sending", "external IO", "outcome write failed"]);
  let sends = 0;
  await deliverReply({ ...lease, kind: "send_notification" }, {
    repository: {
      begin: () => Promise.resolve({ disposition: "uncertain" }),
      finishSend: () => {
        throw 0;
      },
    },
    delivery: {
      send: () => {
        sends++;
        return Promise.resolve({ outcome: "sent" as const });
      },
    },
  });
  equals(sends, 0);
});
