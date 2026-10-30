import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { limitedBody } from "../http/bounded.ts";
import { ProcessingError } from "../../application/ports.ts";

// Privileged transport is confined to the configured Supabase RPC origin. No redirects.
export function persistenceClient(url: string, key: string, transport: typeof fetch = fetch) {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(endpoint.hostname) || endpoint.pathname !== "/" ||
    endpoint.search || endpoint.hash || key.length < 20
  ) throw new ProcessingError("backend_config_invalid");
  const rpcFetch: typeof fetch = async (input, init) => {
    const destination = new URL(input instanceof Request ? input.url : String(input));
    if (
      destination.origin !== endpoint.origin ||
      !/^\/rest\/v1\/rpc\/rr_[a-z_]+$/.test(destination.pathname) ||
      destination.search || destination.hash
    ) throw new ProcessingError("backend_destination_denied");
    const signal = init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);
    try {
      const response = await transport(input, { ...init, signal, redirect: "error" });
      const body = await limitedBody(response.body, 2097152);
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      throw new ProcessingError(
        signal.aborted ? "backend_timeout" : "backend_transport_failed",
        true,
      );
    }
  };
  return createClient<Database>(endpoint.href, key, {
    db: { retry: false }, // A request must share the durable task's attempt budget.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: rpcFetch },
  });
}
