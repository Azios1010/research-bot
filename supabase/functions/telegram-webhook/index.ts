import { webhookHandler } from "../_shared/adapters/telegram/webhook.ts";
import { telegramRuntime } from "../_shared/infrastructure/supabase/telegram-runtime.ts";
import { persistenceClient } from "../_shared/infrastructure/supabase/client.ts";
import { SupabaseRepository } from "../_shared/infrastructure/supabase/repository.ts";

const runtime = telegramRuntime((key) => Deno.env.get(key));
Deno.serve(
  runtime
    ? webhookHandler({
      config: runtime.config,
      inbox: runtime.repository,
      acknowledge: (id) => runtime.delivery.acknowledge(id),
      log: (code) => console.log(JSON.stringify({ event: "telegram_ingress", code })),
      afterReceipt: async () => {
        // Await at most five tasks. Receipt is already durable; recovery uses job-worker.
        // No collection task, detached promise, waitUntil, polling or schedule is started here.
        const store = new SupabaseRepository(
          persistenceClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("RADAR_SUPABASE_SECRET_KEY") ??
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          ),
        );
        const signal = AbortSignal.timeout(20000);
        const owner = crypto.randomUUID();
        for (let i = 0; i < 5 && !signal.aborted; i++) {
          const lease = await store.claim(owner, ["telegram_command", "send_notification"], signal);
          if (!lease) break;
          await runtime.handle(lease, signal);
        }
      },
    })
    : (request) =>
      new Response('{"status":"not_configured"}', {
        status: request.method === "POST" ? 503 : 405,
        headers: { "content-type": "application/json" },
      }),
);
