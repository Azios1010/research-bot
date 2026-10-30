import { deliverReply, handleInteraction } from "../../application/interaction.ts";
import type { Lease } from "../../application/ports.ts";
import { TelegramDelivery } from "../../adapters/telegram/delivery.ts";
import { TelegramRenderer } from "../../adapters/telegram/render.ts";
import { type TelegramConfig, validConfig } from "../../adapters/telegram/protocol.ts";
import { SupabaseInteractions } from "./interactions.ts";
import { persistenceClient } from "./client.ts";

// Called only by HTTP composition roots. Env access and privileged client construction
// remain outside application/domain. No API call validates configuration at startup.
export function telegramRuntime(env: (name: string) => string | undefined) {
  let config: TelegramConfig;
  try {
    config = {
      secret: env("TELEGRAM_WEBHOOK_SECRET") ?? "",
      botId: env("TELEGRAM_BOT_ID") ?? "",
      botUsername: env("TELEGRAM_BOT_USERNAME") ?? "",
      allowedUsers: (env("TELEGRAM_ALLOWED_USER_IDS") ?? "").split(",").map((s) => s.trim()),
      bindings: JSON.parse(env("TELEGRAM_BINDINGS_JSON") ?? "[]"),
    };
    if (!validConfig(config)) return null;
    const token = env("TELEGRAM_BOT_TOKEN") ?? "";
    if (token.split(":")[0] !== config.botId) return null;
    const delivery = new TelegramDelivery(token), renderer = new TelegramRenderer();
    // Lazy: unauthorized webhook paths never construct a privileged client.
    const repository = () =>
      new SupabaseInteractions(
        persistenceClient(
          env("SUPABASE_URL") ?? "",
          env("RADAR_SUPABASE_SECRET_KEY") ?? env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        ),
      );
    const handle = async (lease: Lease, signal: AbortSignal) => {
      const store = repository();
      if (lease.kind === "send_notification") {
        await deliverReply(lease, { repository: store, delivery }, signal);
      } else {await handleInteraction(lease, {
          repository: store,
          renderer,
          clock: { now: () => new Date().toISOString() },
        }, signal);}
    };
    return { config, repository, delivery, handle };
  } catch {
    return null;
  }
}
