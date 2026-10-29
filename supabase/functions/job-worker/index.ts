import { workerHandler } from "../_shared/infrastructure/http/worker-handler.ts";
import { persistenceClient } from "../_shared/infrastructure/supabase/client.ts";
import { SupabaseRepository } from "../_shared/infrastructure/supabase/repository.ts";
import { BoundedHttpClient } from "../_shared/infrastructure/http/bounded.ts";
import { StructuredLogger } from "../_shared/infrastructure/observability/logging.ts";
import { FakeSourceAdapter } from "../_shared/adapters/sources/fake/adapter.ts";
import { runWorker } from "../_shared/application/worker.ts";

// No privileged client is constructed until the request passes internal authentication.
Deno.serve(
  workerHandler({
    secret: Deno.env.get("RADAR_INTERNAL_JOB_SECRET"),
    run: async (maxTasks, signal) => {
      const client = persistenceClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("RADAR_SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
          "",
      );
      const fake = new FakeSourceAdapter();
      return await runWorker({
        repository: new SupabaseRepository(client),
        adapters: new Map([[fake.slug, fake]]),
        clock: { now: () => new Date().toISOString() },
        http: new BoundedHttpClient([]),
        logger: new StructuredLogger(),
      }, { owner: crypto.randomUUID(), maxTasks, signal });
    },
  }),
);
