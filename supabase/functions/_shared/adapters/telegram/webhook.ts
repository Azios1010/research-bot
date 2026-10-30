import { limitedBody } from "../../infrastructure/http/bounded.ts";
import {
  type AcceptedAction,
  callbackQueryId,
  losslessJson,
  type TelegramConfig,
  translateUpdate,
  validConfig,
} from "./protocol.ts";
import { ProcessingError } from "../../application/ports.ts";

export interface InboxPort {
  accept(
    input: AcceptedAction,
    botId: string,
    signal?: AbortSignal,
  ): Promise<{ duplicate: boolean; status: string }>;
}
async function equalSecret(a: string, b: string) {
  const hash = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  const av = new Uint8Array(x), bv = new Uint8Array(y);
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= av[i] ^ bv[i];
  return difference === 0;
}
export function webhookHandler(
  deps: {
    config: TelegramConfig;
    inbox: () => InboxPort;
    acknowledge: (id: string) => Promise<void>;
    afterReceipt?: () => Promise<void>;
    log?: (code: string) => void;
  },
) {
  const response = (status: number, code: string) =>
    new Response(JSON.stringify({ status: code }), {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...(status === 405 ? { allow: "POST" } : {}),
      },
    });
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response(405, "method_not_allowed");
    if (!validConfig(deps.config)) return response(503, "not_configured");
    const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!header || header.length > 256 || !await equalSecret(header, deps.config.secret)) {
      return response(401, "unauthorized");
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return response(415, "content_type_invalid");
    }
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || BigInt(length) > 65536n)) {
      return response(413, "body_too_large");
    }
    let update: Record<string, unknown>;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
      const body = await limitedBody(request.body, 65536, signal);
      update = losslessJson(body);
    } catch (error) {
      return response(
        error instanceof ProcessingError && error.code === "response_too_large" ? 413 : 400,
        "invalid_request",
      );
    }
    const queryId = callbackQueryId(update);
    // Acknowledgement carries no private data and is bounded by the transport. Even rejected
    // supported callbacks are answered. Business effects never depend on this best effort IO.
    if (queryId) {
      try {
        await deps.acknowledge(queryId);
      } catch {
        deps.log?.("callback_ack_failed");
      }
    }
    let accepted: AcceptedAction | null;
    try {
      accepted = translateUpdate(update, deps.config);
    } catch {
      return response(200, "rejected");
    }
    if (!accepted) return response(200, "rejected");
    try {
      await deps.inbox().accept(accepted, deps.config.botId, request.signal);
    } catch {
      deps.log?.("receipt_unavailable");
      return response(503, "receipt_unavailable");
    }
    if (deps.afterReceipt) {
      try {
        await deps.afterReceipt();
      } catch {
        deps.log?.("processing_deferred");
      }
    }
    return response(200, "accepted");
  };
}
