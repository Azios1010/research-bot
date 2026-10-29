import { workerHandler } from "../_shared/infrastructure/http/worker-handler.ts";
import { persistenceClient } from "../_shared/infrastructure/supabase/client.ts";
import { SupabaseRepository } from "../_shared/infrastructure/supabase/repository.ts";
import { BoundedHttpClient } from "../_shared/infrastructure/http/bounded.ts";
import { StructuredLogger } from "../_shared/infrastructure/observability/logging.ts";
import {
  approvedEndpoints,
  approvedReadPostEndpoints,
  approvedSources,
} from "../_shared/adapters/sources/registry.ts";
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
      return await runWorker({
        repository: new SupabaseRepository(client),
        adapters: approvedSources(),
        clock: { now: () => new Date().toISOString() },
        http: new BoundedHttpClient(approvedEndpoints, fetch, approvedReadPostEndpoints),
        logger: new StructuredLogger(),
      }, { owner: crypto.randomUUID(), maxTasks, signal });
    },
  }),
);
