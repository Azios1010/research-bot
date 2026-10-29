import { assert, equals, rejects } from "../support.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
Deno.test("read-only POST requires an exact extra allowlist and bounded JSON object; existing GET has no body", async () => {
  const url = "https://api.grants.gov/v1/api/search2", body = '{"rows":1}';
  let calls = 0;
  const transport: typeof fetch = (_input, init) => {
    calls++;
    equals(init?.method, "POST");
    equals(init?.body, body);
    equals(new Headers(init?.headers).get("content-type"), "application/json");
    equals(init?.redirect, "manual");
    return Promise.resolve(
      new Response('{"data":{}}', { headers: { "content-type": "application/json" } }),
    );
  };
  await rejects(
    () => new BoundedHttpClient([url], transport).request({ url, method: "POST", body }),
    "fetch_method_denied",
  );
  const client = new BoundedHttpClient([url], transport, [url]);
  equals((await client.request({ url, method: "POST", body })).status, 200);
  equals(calls, 1);
  for (
    const invalid of [undefined, "null", "[]", "1", '{"a":', '{"pad":"' + "x".repeat(4096) + '"}']
  ) {
    await rejects(
      () => client.request({ url, method: "POST", body: invalid }),
      "request_body_invalid",
    );
  }
  await rejects(() => client.request({ url, method: "GET", body }), "request_body_denied");
  await rejects(
    () =>
      client.request({ url, method: "POST", body, headers: { authorization: "redacted-fixture" } }),
    "request_header_denied",
  );
  await rejects(
    () => new BoundedHttpClient([url], transport, ["https://other.example.org/read"]),
    "fetch_endpoint_invalid",
  );
  equals(calls, 1);
});
Deno.test("approved read POST still denies redirects and enforces response bytes and timeouts", async () => {
  const url = "https://api.grants.gov/v1/api/search2",
    request = { url, method: "POST" as const, body: "{}" };
  await rejects(
    () =>
      new BoundedHttpClient([url], () =>
        Promise.resolve(
          new Response("", { status: 302, headers: { location: "https://evil.invalid" } }),
        ), [url]).request(request),
    "redirect_denied",
  );
  await rejects(
    () =>
      new BoundedHttpClient([url], () => Promise.resolve(new Response("12345")), [url]).request({
        ...request,
        maxBytes: 4,
      }),
    "response_too_large",
  );
  const aborting: typeof fetch = (_u, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("abort", "AbortError")),
        { once: true },
      )
    );
  await rejects(
    () => new BoundedHttpClient([url], aborting, [url]).request({ ...request, timeoutMs: 5 }),
    "transport_timeout",
  );
  assert(true);
});
