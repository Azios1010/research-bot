import { limitedBody } from "./bounded.ts";
import type { WorkerResult } from "../../application/worker.ts";

async function equalSecret(actual: string, expected: string): Promise<boolean> {
  const hash = (v: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  const av = new Uint8Array(a), bv = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < av.length; i++) mismatch |= av[i] ^ bv[i];
  return mismatch === 0;
}
export function workerHandler(
  config: {
    secret: string | undefined;
    run: (maximum: number, signal: AbortSignal) => Promise<WorkerResult>;
  },
) {
  const response = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response(405, { error: "method_not_allowed" });
    if (!config.secret || config.secret.length < 32 || config.secret.length > 256) {
      return response(503, { error: "worker_not_configured" });
    }
    const supplied = request.headers.get("X-Radar-Job-Secret");
    if (!supplied || supplied.length > 256 || !await equalSecret(supplied, config.secret)) {
      return response(401, { error: "unauthorized" });
    }
    let maximum = 5;
    try {
      const body = await limitedBody(request.body, 1024);
      const value = body ? JSON.parse(body) : {};
      if (
        !value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some((k) => k !== "maxTasks")
      ) return response(400, { error: "invalid_request" });
      maximum = value.maxTasks ?? 5;
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 5) {
        return response(400, { error: "invalid_request" });
      }
    } catch {
      return response(400, { error: "invalid_request" });
    }
    try {
      return response(200, await config.run(maximum, request.signal));
    } catch {
      return response(503, { error: "worker_unavailable" });
    }
  };
}
