import {
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  ProcessingError,
} from "../../application/ports.ts";
import { safeUrl } from "../../domain/primitives.ts";

export async function limitedBody(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new ProcessingError("response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } catch {
    throw new ProcessingError("invalid_response_encoding");
  }
}
export class BoundedHttpClient implements HttpClient {
  private active = new Set<{ host: string; done: Promise<void>; release: () => void }>();
  private waiting = 0;
  private allowed: Set<string>;
  constructor(endpoints: readonly string[], private readonly transport: typeof fetch = fetch) {
    this.allowed = new Set(endpoints.map((url) => {
      const safe = safeUrl(url);
      if (!safe.startsWith("https://") || new URL(safe).port) {
        throw new ProcessingError("fetch_endpoint_invalid");
      }
      return safe;
    }));
  }
  async request(input: HttpRequest): Promise<HttpResponse> {
    const url = safeUrl(input.url), host = new URL(url).hostname;
    if (!this.allowed.has(url)) throw new ProcessingError("fetch_destination_denied");
    if (!["GET", "HEAD"].includes(input.method)) throw new ProcessingError("fetch_method_denied");
    const timeout = input.timeoutMs ?? 15000, maxBytes = input.maxBytes ?? 2097152;
    if (
      !Number.isInteger(timeout) || timeout < 1 || timeout > 15000 || !Number.isInteger(maxBytes) ||
      maxBytes < 1 || maxBytes > 2097152
    ) throw new ProcessingError("http_limits_invalid");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;
    let slot: { host: string; done: Promise<void>; release: () => void } | undefined;
    try {
      if (++this.waiting > 8) {
        this.waiting--;
        throw new ProcessingError("http_queue_full", true);
      }
      try {
        while (this.active.size >= 2 || [...this.active].some((s) => s.host === host)) {
          signal.throwIfAborted();
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              cleanup();
              reject(new ProcessingError("transport_timeout", true));
            };
            const cleanup = () => signal.removeEventListener("abort", abort);
            signal.addEventListener("abort", abort, { once: true });
            Promise.race([...this.active].map((s) => s.done)).then(() => {
              cleanup();
              resolve();
            });
          });
        }
      } finally {
        this.waiting--;
      }
      signal.throwIfAborted();
      let release!: () => void;
      slot = { host, done: new Promise<void>((r) => release = r), release: () => release() };
      this.active.add(slot);
      const headers = new Headers();
      for (const [name, value] of Object.entries(input.headers ?? {})) {
        if (
          !["accept", "if-none-match", "if-modified-since", "user-agent"].includes(
            name.toLowerCase(),
          ) || value.length > 1024 || /[\r\n]/.test(value)
        ) throw new ProcessingError("request_header_denied");
        headers.set(name, value);
      }
      const response = await this.transport(url, {
        method: input.method,
        headers,
        redirect: "manual",
        signal,
      });
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        await response.body?.cancel();
        throw new ProcessingError("redirect_denied");
      }
      if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
        await response.body?.cancel();
        throw new ProcessingError("response_too_large");
      }
      const selected: Record<string, string> = {};
      for (const name of ["etag", "last-modified", "retry-after", "content-type"]) {
        const value = response.headers.get(name);
        if (value && value.length <= 1024) selected[name] = value;
      }
      return {
        status: response.status,
        body: await limitedBody(response.body, maxBytes),
        contentType: response.headers.get("content-type"),
        headers: selected,
      };
    } catch (error) {
      if (error instanceof ProcessingError) throw error;
      throw new ProcessingError(
        signal.aborted ? "transport_timeout" : "transport_network_error",
        true,
      );
    } finally {
      clearTimeout(timer);
      if (slot) {
        this.active.delete(slot);
        slot.release();
      }
    }
  }
}
