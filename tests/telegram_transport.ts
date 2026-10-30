import { assert } from "./support.ts";
import { syntheticBot, syntheticUser } from "./telegram_support.ts";

export type BotScenario =
  | "success"
  | "rate_limit"
  | "permanent"
  | "forbidden"
  | "timeout"
  | "server";
export class MockBotApi {
  scenario: BotScenario = "success";
  sends: { messageId: string; payload: Record<string, unknown> }[] = [];
  acknowledgements = 0;
  readonly fetch: typeof fetch = (input, init) => {
    const url = String(input), payload = JSON.parse(String(init?.body));
    assert(
      url.startsWith("https://api.telegram.org/bot"),
      "mock transport only permits Telegram methods",
    );
    if (url.endsWith("/answerCallbackQuery")) {
      this.acknowledgements++;
      return Promise.resolve(new Response('{"ok":true,"result":true}'));
    }
    assert(url.endsWith("/sendMessage"), "mock transport supports no lifecycle methods");
    assert(init?.redirect === "error" && init.method === "POST", "bounded Bot API request");
    const id = String(100 + this.sends.length);
    this.sends.push({ messageId: id, payload });
    if (this.scenario === "timeout") return Promise.reject(new Error("Synthetic ambiguous send"));
    const status = this.scenario === "rate_limit"
      ? 429
      : this.scenario === "permanent"
      ? 400
      : this.scenario === "forbidden"
      ? 403
      : this.scenario === "server"
      ? 500
      : 200;
    const body = status === 200
      ? {
        ok: true,
        result: {
          message_id: id,
          chat: { id: syntheticUser },
          from: { id: syntheticBot, is_bot: true },
        },
      }
      : {
        ok: false,
        error_code: status,
        ...(status === 429 ? { parameters: { retry_after: 37 } } : {}),
      };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}
