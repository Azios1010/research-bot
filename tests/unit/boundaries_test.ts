import { assert, equals, rejects } from "../support.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { workerHandler } from "../../supabase/functions/_shared/infrastructure/http/worker-handler.ts";
import { StructuredLogger } from "../../supabase/functions/_shared/infrastructure/observability/logging.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import type { LogContext } from "../../supabase/functions/_shared/application/ports.ts";
const endpoint = "https://fixtures.example.invalid/feed";
const transport = (
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch =>
  ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;

Deno.test("worker authenticates before any database/composition work", async () => {
  let calls = 0;
  const secret = "a".repeat(40);
  const handler = workerHandler({
    secret,
    run: (maximum) => {
      calls++;
      equals(maximum, 1);
      return Promise.resolve({ claimed: 0, completed: 0, failed: 0, leaseLost: 0 });
    },
  });
  for (const header of [null, "wrong"]) {
    const headers = new Headers();
    if (header) headers.set("X-Radar-Job-Secret", header);
    equals((await handler(new Request(endpoint, { method: "POST", headers }))).status, 401);
  }
  equals(calls, 0);
  equals(
    (await workerHandler({
      secret: undefined,
      run: () => {
        throw new Error("must not run");
      },
    })(new Request(endpoint, { method: "POST" }))).status,
    503,
  );
  equals(
    (await handler(
      new Request(endpoint, {
        method: "POST",
        headers: { "X-Radar-Job-Secret": secret },
        body: '{"maxTasks":1}',
      }),
    )).status,
    200,
  );
  equals(calls, 1);
  for (const body of ['{"maxTasks":6}', '{"url":"https://other.invalid"}', "x".repeat(2000)]) {
    equals(
      (await handler(
        new Request(endpoint, { method: "POST", headers: { "X-Radar-Job-Secret": secret }, body }),
      )).status,
      400,
    );
  }
  equals(calls, 1);
});
Deno.test("HTTP fetch restricts reviewed destinations and redirects, strips response secrets", async () => {
  let calls = 0;
  const http = new BoundedHttpClient(
    [endpoint],
    transport((_url, init) => {
      calls++;
      equals(init?.redirect, "manual");
      return new Response("ok", { headers: { "etag": "v1", "set-cookie": "private" } });
    }),
  );
  equals((await http.request({ url: endpoint, method: "GET" })).headers, {
    etag: "v1",
    "content-type": "text/plain;charset=UTF-8",
  });
  await rejects(
    () => http.request({ url: "https://elsewhere.invalid/feed", method: "GET" }),
    "fetch_destination_denied",
  );
  await rejects(
    () =>
      http.request({
        url: endpoint,
        method: "GET",
        headers: { Authorization: "should never send" },
      }),
    "request_header_denied",
  );
  equals(calls, 1);
  await rejects(
    () =>
      new BoundedHttpClient(
        [endpoint],
        transport(() =>
          new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } })
        ),
      ).request({ url: endpoint, method: "GET" }),
    "redirect_denied",
  );
});
Deno.test("response body bounds, encoding and timeout apply without external requests", async () => {
  await rejects(
    () =>
      new BoundedHttpClient([endpoint], transport(() => new Response("123456"))).request({
        url: endpoint,
        method: "GET",
        maxBytes: 5,
      }),
    "response_too_large",
  );
  await rejects(
    () =>
      new BoundedHttpClient([endpoint], transport(() => new Response(new Uint8Array([255]))))
        .request({ url: endpoint, method: "GET" }),
    "invalid_response_encoding",
  );
  const slow = new BoundedHttpClient(
    [endpoint],
    transport((_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      )
    ),
  );
  await rejects(
    () => slow.request({ url: endpoint, method: "GET", timeoutMs: 5 }),
    "transport_timeout",
  );
});
Deno.test("concurrent HTTP is at most two requests total and one per host", async () => {
  const other = "https://second.example.invalid/feed";
  let active = 0, maximum = 0;
  const hosts = new Set<string>();
  const http = new BoundedHttpClient(
    [endpoint, other],
    transport(async (url) => {
      const host = new URL(url).host;
      assert(!hosts.has(host));
      hosts.add(host);
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      active--;
      hosts.delete(host);
      return new Response("fixture");
    }),
  );
  await Promise.all(
    [endpoint, endpoint, other, other].map((url) => http.request({ url, method: "GET" })),
  );
  equals(maximum, 2);
  equals(active, 0);
});
Deno.test("privileged client rejects non-Supabase configuration and non-RPC destinations", async () => {
  await rejects(
    () => persistenceClient("http://localhost:54321", "not-a-real-test-key-value"),
    "backend_config_invalid",
  );
  let calls = 0;
  const client = persistenceClient(
    "https://abcdefghijklmnopqrst.supabase.co",
    "not-a-real-test-key-value",
    transport(() => {
      calls++;
      return new Response("[]");
    }),
  );
  const { error } = await client.from("unrelated_table" as never).select();
  assert(error);
  equals(calls, 0);
});
Deno.test("structured logs discard secrets, arbitrary documents and unsafe identifiers", () => {
  const entries: string[] = [], logger = new StructuredLogger((line) => entries.push(line));
  logger.log(
    "task_failed",
    {
      taskId: "valid-id",
      errorCode: "transport_timeout",
      sourceSlug: "token=https://secret",
      raw: "do not log",
      count: -1,
    } as LogContext,
  );
  equals(JSON.parse(entries[0]), {
    event: "task_failed",
    taskId: "valid-id",
    errorCode: "transport_timeout",
  });
});

Deno.test("RPC optimistic conflict maps to one safe failure without SDK retries or detail leakage", async () => {
  for (const code of ["PT409", "40001"]) {
    let calls = 0;
    const client = persistenceClient(
      "https://abcdefghijklmnopqrst.supabase.co",
      "not-a-real-test-key-value",
      transport(() => {
        calls++;
        return new Response(
          JSON.stringify({
            code,
            message: "reconciliation_revision_stale",
            details: "Sensitive server details must stay at the boundary",
          }),
          { status: code === "PT409" ? 409 : 500 },
        );
      }),
    );
    const repository = new SupabaseRepository(client);
    await rejects(
      () =>
        repository.collection({
          id: "task",
          owner: "owner",
          generation: 1,
          attempt: 1,
          kind: "collect_page",
          leaseUntil: "2031-01-01T00:01:30Z",
          runId: "run",
        }),
      "reconciliation_stale",
    );
    equals(calls, 1);
  }
});
