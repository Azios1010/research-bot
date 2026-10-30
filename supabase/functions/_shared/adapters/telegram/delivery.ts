import {
  type ReplyDelivery,
  type ReplyPart,
  type SendOutcome,
} from "../../application/interaction.ts";
import { ProcessingError } from "../../application/ports.ts";
import { limitedBody } from "../../infrastructure/http/bounded.ts";
import { safeUrl } from "../../domain/primitives.ts";
import { decodeCallback, losslessJson, numericId, record } from "./protocol.ts";

export class TelegramDelivery implements ReplyDelivery {
  private readonly botId: string;
  constructor(private readonly token: string, private readonly transport: typeof fetch = fetch) {
    // Never include token-bearing URLs or provider exception messages in errors/logs.
    if (!/^\d{1,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) {
      throw new ProcessingError("bot_config_invalid");
    }
    this.botId = numericId(token.split(":")[0]);
  }
  private async call(
    method: "sendMessage" | "answerCallbackQuery",
    payload: object,
    signal?: AbortSignal,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const timeout = AbortSignal.timeout(method === "sendMessage" ? 8000 : 2500);
    const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.transport(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: bounded,
    });
    const body = losslessJson(await limitedBody(response.body, 32768, bounded));
    return { status: response.status, body };
  }
  async acknowledge(id: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return;
    await this.call("answerCallbackQuery", { callback_query_id: id });
  }
  async send(
    destination: { account: string; bot: string },
    part: ReplyPart,
    signal?: AbortSignal,
  ): Promise<SendOutcome> {
    if (
      numericId(destination.bot) !== this.botId || !numericId(destination.account) ||
      part.renderingVersion !== 1
    ) throw new ProcessingError("delivery_binding_invalid");
    const keyboard = part.buttons.map((row) =>
      row.map((b) => {
        if (b.action) {
          decodeCallback(b.action);
          return { text: b.label, callback_data: b.action };
        }
        if (b.url) return { text: b.label, url: safeUrl(b.url) };
        throw new ProcessingError("button_invalid");
      })
    );
    try {
      const { status, body } = await this.call("sendMessage", {
        chat_id: destination.account,
        text: part.text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: keyboard },
      }, signal);
      if (status === 200 && body.ok === true) {
        const result = record(body.result),
          chat = record(result.chat),
          sender = record(result.from);
        if (
          numericId(chat.id) !== destination.account || numericId(sender.id) !== this.botId ||
          sender.is_bot !== true
        ) return { outcome: "uncertain", code: "send_response_mismatch" };
        return { outcome: "sent", messageId: numericId(result.message_id) };
      }
      const errorCode = typeof body.error_code === "string" ? body.error_code : "";
      if (body.ok === false && errorCode === "429" && status === 429) {
        const parameters = record(body.parameters ?? {});
        const retry = Number(parameters.retry_after);
        return {
          outcome: "retryable_failure",
          code: "telegram_rate_limit",
          retrySeconds: Number.isSafeInteger(retry) && retry >= 1 && retry <= 86400 ? retry : 60,
        };
      }
      if (
        body.ok === false && [400, 401, 403, 404].includes(status) && errorCode === String(status)
      ) {
        return {
          outcome: "permanent_failure",
          code: status === 403
            ? "telegram_forbidden"
            : status === 400
            ? "telegram_bad_request"
            : "telegram_auth_failure",
        };
      }
      // A 5xx or unclassified reply cannot prove sendMessage had no visible effect.
      return { outcome: "uncertain", code: "telegram_server_unknown" };
    } catch {
      return { outcome: "uncertain", code: "telegram_transport_unknown" };
    }
  }
}
