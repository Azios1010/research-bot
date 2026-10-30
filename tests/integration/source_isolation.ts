import type postgres from "postgres";
import { assert, equals } from "../support.ts";
import { sourceSession } from "./source_session.ts";
import { BathAdapter } from "../../supabase/functions/_shared/adapters/sources/bath/adapter.ts";
import { CcfddlAdapter } from "../../supabase/functions/_shared/adapters/sources/ccfddl/adapter.ts";
import { GrantsAdapter } from "../../supabase/functions/_shared/adapters/sources/grantsgov/adapter.ts";
import { JeacsAdapter } from "../../supabase/functions/_shared/adapters/sources/jeacs/adapter.ts";
import { journalFixtures, journalTransport } from "../jeacs_support.ts";
import { fundingFixtures, fundingTransport } from "../grants_support.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import { ProcessingError } from "../../supabase/functions/_shared/application/ports.ts";
import { conferenceInputHash } from "../../scripts/sources/evidence.ts";

// Fixture IO is injected, but all task/cursor/source/identity writes use the real hosted RPCs.
export async function verifySourceIsolation(
  sql: postgres.Sql,
  target: { projectRef: string; targetClass?: string },
  token: string,
) {
  const inputHash = await conferenceInputHash(), passed: string[] = [];
  const bath = await Deno.readTextFile("tests/fixtures/bath/research.xml"),
    conference = await Deno.readTextFile("tests/fixtures/ccfddl/sigmod.yml"),
    funding = fundingTransport(await fundingFixtures()),
    journal = journalTransport(await journalFixtures());
  let fail: "position" | "conference" | "funding" | "journal" | null = null;
  const unavailable = () => Promise.resolve(new Response("", { status: 503 }));
  const positionTransport: typeof fetch = () =>
    fail === "position"
      ? unavailable()
      : Promise.resolve(new Response(bath, { headers: { "content-type": "application/rss+xml" } }));
  const conferenceTransport: typeof fetch = () =>
    fail === "conference"
      ? unavailable()
      : Promise.resolve(new Response(conference, { headers: { "content-type": "text/plain" } }));
  const fundingRead: typeof fetch = (...args) =>
    fail === "funding" ? unavailable() : funding(...args);
  const journalRead: typeof fetch = (...args) =>
    fail === "journal" ? unavailable() : journal(...args);
  const ok = (value: unknown, label: string) => {
    assert(value, label);
    passed.push(label);
    console.log(`PASS: isolation ${label}`);
  };
  await sourceSession(
    sql,
    target,
    token,
    new BathAdapter(),
    positionTransport,
    async (positions) => {
      await sourceSession(
        sql,
        target,
        token,
        new CcfddlAdapter(),
        conferenceTransport,
        async (events) => {
          await sourceSession(
            sql,
            target,
            token,
            new GrantsAdapter(),
            fundingRead,
            async (funds) => {
              await sourceSession(
                sql,
                target,
                token,
                new JeacsAdapter(),
                journalRead,
                async (journals) => {
                  const sessions = {
                    position: positions,
                    conference: events,
                    funding: funds,
                    journal: journals,
                  };
                  for (const kind of ["position", "funding", "conference", "journal"] as const) {
                    fail = kind;
                    const broken = sessions[kind],
                      run = await broken.repository.createRun(
                        broken.id,
                        `p05:${broken.id}:${crypto.randomUUID()}`,
                        "test",
                      ),
                      lease = await broken.repository.claim(crypto.randomUUID(), ["collect_page"]);
                    assert(lease?.runId === run, "isolated failing source task claim");
                    try {
                      await collect(lease, broken.deps, new AbortController().signal);
                      throw new Error("expected source failure");
                    } catch (error) {
                      assert(
                        error instanceof ProcessingError && error.code === "source_http_failed" &&
                          error.retryable,
                        "explicit transport failure",
                      );
                    }
                    // Exhaust this controlled fixture attempt without enqueuing an uncontrolled retry.
                    await broken.repository.finish(lease, "failed", "source_http_failed", 60);
                    const [state] =
                      await sql`select status,pages_committed,records_seen::integer from radar.collection_runs where id=${run}`;
                    ok(
                      state.status === "failed" && state.pages_committed === 0 &&
                        state.records_seen === 0,
                      `${kind} transport failure cannot become an empty successful page or advance cursor`,
                    );
                    for (const [name, healthy] of Object.entries(sessions)) {
                      if (name !== kind) {
                        await healthy.execute();
                        ok(
                          (await healthy.snapshot()).length > 0,
                          `${kind} failure leaves ${name} source usable`,
                        );
                      }
                    }
                  }
                  fail = null;
                  await positions.execute();
                  const identities = (await positions.snapshot()).map(
                    (r) => [r.id, r.source_record_key],
                  );
                  const run = await positions.repository.createRun(
                      positions.id,
                      `p05:${positions.id}:disable`,
                      "test",
                    ),
                    lease = await positions.repository.claim(crypto.randomUUID(), ["collect_page"]);
                  assert(lease?.runId === run);
                  await sql`update radar.sources set enabled=false where id=${positions.id}`;
                  try {
                    await collect(lease, positions.deps, new AbortController().signal);
                    throw new Error("disabled source collected");
                  } catch (error) {
                    assert(
                      error instanceof ProcessingError && error.code === "source_disabled" &&
                        error.canceled,
                    );
                  }
                  await positions.repository.finish(lease, "canceled", "source_disabled", 60);
                  await events.execute();
                  await funds.execute();
                  equals(
                    (await positions.snapshot()).map((r) => [r.id, r.source_record_key]),
                    identities,
                  );
                  ok(
                    true,
                    "disabled position source retains canonicals while conference and funding tasks succeed",
                  );
                  await sql`update radar.sources set enabled=true where id=${positions.id}`;
                  await positions.execute();
                  equals(
                    (await positions.snapshot()).map((r) => [r.id, r.source_record_key]),
                    identities,
                  );
                  const [health] =
                    await sql`select consecutive_failures from radar.sources where id=${positions.id}`;
                  ok(
                    health.consecutive_failures === 0,
                    "reenabling retains deterministic identity and canceled work does not harm health",
                  );
                },
              );
            },
          );
        },
      );
    },
  );
  assert(inputHash === await conferenceInputHash(), "source isolation inputs changed");
  await Deno.writeTextFile(
    "private/phase06-source-isolation.json",
    JSON.stringify(
      {
        projectRef: target.projectRef,
        targetClass: target.targetClass,
        verifiedAt: new Date().toISOString(),
        inputHash,
        assertions: passed,
        cleanup: true,
      },
      null,
      2,
    ),
  );
}
