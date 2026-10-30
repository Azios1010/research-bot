import {
  type BasicPatch,
  type Command,
  commands,
  validateBasicPatch,
} from "../../application/interaction.ts";
import { ProcessingError } from "../../application/ports.ts";

export function numericId(value: unknown): string {
  if (
    typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  ) throw new ProcessingError("telegram_id_invalid");
  return value;
}
// Validate JSON syntax, then preserve number lexemes before constructing accepted DTOs.
// No value from the ordinary numeric parse is used for authorization or persistence.
export function losslessJson(body: string): Record<string, unknown> {
  let result = "", i = 0, depth = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"') {
      const start = i++;
      while (i < body.length) {
        if (body[i] === "\\") i += 2;
        else if (body[i++] === '"') break;
      }
      result += body.slice(start, i);
    } else if (c === "-" || /\d/.test(c)) {
      const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(body.slice(i));
      if (!match) throw new ProcessingError("telegram_json_invalid");
      result += JSON.stringify(match[0]);
      i += match[0].length;
    } else {
      if (c === "{" || c === "[") {
        if (++depth > 32) throw new ProcessingError("telegram_json_depth");
      }
      if (c === "}" || c === "]") depth--;
      result += c;
      i++;
    }
  }
  JSON.parse(body); // syntax only; including invalid leading zeros / unescaped controls
  return record(JSON.parse(result));
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProcessingError("telegram_shape_invalid");
  }
  return value as Record<string, unknown>;
}
export type CallbackCode = "d" | "s" | "u" | "i" | "r" | "o" | "p";
export function callbackData(code: CallbackCode, key: string, index: number): string {
  const token = `1:${code}:${key.replaceAll("-", "")}:${index}`;
  decodeCallback(token);
  return token;
}
export function decodeCallback(value: string): { code: CallbackCode; key: string; index: number } {
  if (new TextEncoder().encode(value).length > 64) throw new ProcessingError("callback_too_large");
  const m = /^1:([dsuirop]):([a-f0-9]{32}):([0-2])$/.exec(value);
  if (!m) throw new ProcessingError("callback_invalid");
  const s = m[2];
  return {
    code: m[1] as CallbackCode,
    key: `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`,
    index: Number(m[3]),
  };
}
export function parseCommand(
  text: string,
  botUsername: string,
): { kind: "command"; command: Command | "unknown"; patch?: BasicPatch } | null {
  if (text.length > 4096 || !text.startsWith("/")) return null;
  const match = /^\/([a-zA-Z]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text);
  if (!match || match[2] && match[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  const command = match[1].toLowerCase();
  if (!commands.includes(command as Command)) return { kind: "command", command: "unknown" };
  if (command !== "profile" || !match[3]?.trim()) {
    return { kind: "command", command: command as Command };
  }
  const args = /^(timezone|topics|types|enabled|digest|time)\s+([\s\S]+)$/.exec(match[3].trim());
  if (!args) return { kind: "command", command: "profile" }; // instructions; no raw text retained
  try {
    const [field, input] = [args[1], args[2].trim()];
    const patch = field === "timezone"
      ? { timezone: input }
      : field === "topics"
      ? { topics: input.split(";").map((s) => s.trim()) }
      : field === "types"
      ? { types: input.split(",").map((s) => s.trim()) }
      : field === "time"
      ? { digestTime: input }
      : /^(true|false)$/.test(input)
      ? { [field === "digest" ? "digestEnabled" : "enabled"]: input === "true" }
      : null;
    return { kind: "command", command: "profile", patch: validateBasicPatch(patch) };
  } catch {
    return { kind: "command", command: "profile" };
  }
}
export interface TelegramBinding {
  userId: string;
  chatId: string;
  targetId: string;
}
export interface TelegramConfig {
  secret: string;
  botId: string;
  botUsername: string;
  allowedUsers: readonly string[];
  bindings: readonly TelegramBinding[];
}
export function validConfig(config: TelegramConfig): boolean {
  try {
    numericId(config.botId);
    return /^[A-Za-z0-9_-]{32,256}$/.test(config.secret) &&
      /^[A-Za-z0-9_]{5,32}$/.test(config.botUsername) && config.allowedUsers.length > 0 &&
      config.allowedUsers.length <= 10 && config.bindings.length === 1 &&
      config.allowedUsers.every((s) => numericId(s) === s) && config.bindings.every((b) =>
        numericId(b.userId) === numericId(b.chatId) && config.allowedUsers.includes(b.userId) &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(b.targetId)
      );
  } catch {
    return false;
  }
}
export interface AcceptedAction {
  updateId: string;
  binding: TelegramBinding;
  action: { kind: "command"; command: Command | "unknown"; patch?: BasicPatch } | {
    kind: "callback";
    token: string;
    messageId: string;
  } | { kind: "rejected"; reason: string };
}
export function callbackQueryId(update: Record<string, unknown>): string | null {
  try {
    const q = record(update.callback_query);
    return typeof q.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(q.id) ? q.id : null;
  } catch {
    return null;
  }
}
export function translateUpdate(
  update: Record<string, unknown>,
  config: TelegramConfig,
): AcceptedAction | null {
  const updateId = numericId(update.update_id);
  const callback = update.callback_query !== undefined;
  // Ambiguous supported shapes are rejected before authorization or database work.
  if (callback && update.message !== undefined) return null;
  if (!callback && update.message === undefined) return null;
  const query = callback ? record(update.callback_query) : null;
  const message = record(callback ? query!.message : update.message),
    sender = record(callback ? query!.from : message.from),
    chat = record(message.chat);
  const userId = numericId(sender.id), chatId = numericId(chat.id);
  if (sender.is_bot !== false || chat.type !== "private" || !config.allowedUsers.includes(userId)) {
    return null;
  }
  const binding = config.bindings.find((b) => b.userId === userId && b.chatId === chatId);
  if (!binding || userId !== chatId) return null;
  const messageId = numericId(message.message_id);
  if (callback) {
    const author = record(message.from);
    if (author.is_bot !== true || numericId(author.id) !== config.botId) return null;
    if (typeof query!.data !== "string") {
      return { updateId, binding, action: { kind: "rejected", reason: "callback_invalid" } };
    }
    try {
      decodeCallback(query!.data);
    } catch {
      return { updateId, binding, action: { kind: "rejected", reason: "callback_invalid" } };
    }
    return { updateId, binding, action: { kind: "callback", token: query!.data, messageId } };
  }
  if (typeof message.text !== "string") {
    return { updateId, binding, action: { kind: "rejected", reason: "unsupported" } };
  }
  const action = parseCommand(message.text, config.botUsername);
  return { updateId, binding, action: action ?? { kind: "rejected", reason: "unsupported" } };
}
