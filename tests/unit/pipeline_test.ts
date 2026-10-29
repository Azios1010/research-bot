import { assert, equals, fixture, rejects } from "../support.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import { runWorker } from "../../supabase/functions/_shared/application/worker.ts";
import {
  type CollectionContext,
  type Lease,
  ProcessingError,
  type Repository,
} from "../../supabase/functions/_shared/application/ports.ts";
import { FakeSourceAdapter } from "../../supabase/functions/_shared/adapters/sources/fake/adapter.ts";
import type { Proposal } from "../../supabase/functions/_shared/domain/model.ts";

const lease: Lease = {
  id: "task",
  owner: "owner",
  generation: 1,
  kind: "collect_page",
  attempt: 1,
  leaseUntil: "2031-01-01T00:01:30Z",
  runId: "run",
};
const signal = new AbortController().signal;
function setup(body: string, overrides: Partial<Repository> = {}) {
  const proposals: Proposal[][] = [],
    finishes: { outcome: string; code: string; delay: number }[] = [];
  let claims = 0;
  const context: CollectionContext = {
    source: {
      id: "source",
      slug: "fake",
      enabled: true,
      approved: true,
      parserVersion: "fake-json-v1",
      configVersion: 1,
      config: { pages: [body], revision: "v1" },
    },
    runId: "run",
    sequence: 0,
    cursor: null,
    cursorHash: "database-owned-hash",
    validators: {},
    sourceRevision: null,
    replayed: false,
    paused: false,
  };
  const repository: Repository = {
    createRun: () => Promise.resolve("run"),
    claim: () => Promise.resolve(claims++ === 0 ? lease : null),
    renew: (l) => Promise.resolve(l),
    finish: (_lease, outcome, code, delay) => {
      finishes.push({ outcome, code, delay });
      return Promise.resolve();
    },
    collection: () => Promise.resolve(context),
    candidates: (_lease, records) =>
      Promise.resolve(
        records.map((r) => ({
          recordKey: r.recordKey,
          observationId: null,
          observationOpportunityId: null,
          strongIds: [],
          candidates: [],
          truncated: false,
        })),
      ),
    commit: (_lease, _context, _page, records) => {
      proposals.push([...records]);
      return Promise.resolve({
        replayed: false,
        runId: "run",
        inserted: records.filter((r) => r.disposition === "accepted").length,
        updated: 0,
        duplicates: 0,
        rejected: records.filter((r) => r.disposition === "quarantined").length,
      });
    },
    assessment: () => {
      throw new Error("not an assessment task");
    },
    storeAssessments: () => {
      throw new Error("not an assessment task");
    },
    ...overrides,
  };
  const deps = {
    repository,
    adapters: new Map([["fake", new FakeSourceAdapter()]]),
    clock: { now: () => "2031-01-01T00:00:00Z" },
    http: {
      request: () => {
        throw new Error("normal tests forbid network");
      },
    },
    logger: { log: () => {} },
  };
  return { context, repository, deps, proposals, finishes };
}
Deno.test("mixed page normalizes valid siblings and durably proposes one rejected sibling", async () => {
  const test = setup(await fixture("mixed.json"));
  const result = await collect(lease, test.deps, signal);
  equals(result.inserted, 2);
  equals(result.rejected, 1);
  equals(test.proposals[0].length, 3);
  equals(test.proposals[0][1].errorCode, "malformed_record");
  assert(test.proposals[0][0].provenance?.title.sourceRecordKey === "fake-v1:valid-a");
});
Deno.test("replayed task stops before transport parser or commit", async () => {
  const test = setup("not even JSON");
  test.context.replayed = true;
  assert((await collect(lease, test.deps, signal)).replayed);
  equals(test.proposals.length, 0);
});
Deno.test("document failure differs from valid empty and never commits cursor", async () => {
  const bad = setup('{"items":{"changed":true}}');
  await rejects(() => collect(lease, bad.deps, signal));
  equals(bad.proposals.length, 0);
  const good = setup(await fixture("empty.json"));
  await collect(lease, good.deps, signal);
  equals(good.proposals, [[]]);
});
Deno.test("stale reconciliation retries bounded reads/commit without refetching source", async () => {
  let commits = 0, fetches = 0;
  const test = setup(await fixture("mixed.json"));
  const initial = test.repository.commit.bind(test.repository);
  test.repository.commit = (...args) => {
    if (++commits === 1) throw new ProcessingError("reconciliation_stale", true);
    return initial(...args);
  };
  const adapter = new FakeSourceAdapter(), get = adapter.collectPage.bind(adapter);
  adapter.collectPage = (...args) => {
    fetches++;
    return get(...args);
  };
  test.deps.adapters.set("fake", adapter);
  await collect(lease, test.deps, signal);
  equals(commits, 2);
  equals(fetches, 1);
  test.repository.commit = () => {
    commits++;
    throw new ProcessingError("reconciliation_stale", true);
  };
  commits = 0;
  await rejects(() => collect(lease, test.deps, signal), "reconciliation_stale");
  equals(commits, 2);
});
Deno.test("ambiguous deadline evidence stays in bounded snapshot without invented round", async () => {
  const test = setup(
    JSON.stringify({
      schema_version: 1,
      items: [{
        id: "a",
        category: "phd",
        heading: "Fixture",
        link: "https://example.invalid/a",
        calls: [{ kind: "application", round: null, label: "Unknown round", value: "2031-03-01" }],
      }],
    }),
  );
  await collect(lease, test.deps, signal);
  const record = test.proposals[0][0];
  equals(record.canonical?.deadlines.length, 0);
  assert(record.canonical?.fields.qualityFlags.includes("ambiguous_round"));
  assert(Array.isArray(record.snapshot?.deadline_evidence));
});
Deno.test("worker isolates a transient source failure then processes another bounded task", async () => {
  const test = setup(await fixture("mixed.json"));
  let claims = 0;
  test.repository.claim = () =>
    Promise.resolve(claims < 2 ? { ...lease, id: `task-${++claims}` } : null);
  test.repository.collection = (claimed) =>
    Promise.resolve(
      claimed.id === "task-1"
        ? {
          ...test.context,
          source: {
            ...test.context.source,
            config: { ...test.context.source.config, fault: "503" },
          },
        }
        : test.context,
    );
  const result = await runWorker(test.deps, { owner: "owner" });
  equals(result, { claimed: 2, completed: 1, failed: 1, leaseLost: 0 });
  equals(test.finishes[0].outcome, "retry");
  assert(test.finishes[0].delay >= 60);
  equals(test.proposals.length, 1);
});
Deno.test("stale fence cannot finish and disabled source is canceled", async () => {
  const stale = setup(await fixture("empty.json"), {
    collection: () => {
      throw new ProcessingError("lease_stale");
    },
  });
  equals((await runWorker(stale.deps, { owner: "owner" })).leaseLost, 1);
  equals(stale.finishes.length, 0);
  const disabled = setup(await fixture("empty.json"));
  disabled.context.source.enabled = false;
  await runWorker(disabled.deps, { owner: "owner" });
  equals(disabled.finishes[0].outcome, "canceled");
  equals(disabled.proposals.length, 0);
});
Deno.test("worker enforces batch bound even when queue never empties", async () => {
  const test = setup(await fixture("empty.json"));
  test.repository.claim = () => Promise.resolve(lease);
  equals((await runWorker(test.deps, { owner: "owner", maxTasks: 5 })).claimed, 5);
  await rejects(
    () => runWorker(test.deps, { owner: "owner", maxTasks: 6 }),
    "worker_batch_invalid",
  );
});

Deno.test("unsafe original URL is quarantined beside a valid record with safe page provenance", async () => {
  const test = setup(JSON.stringify({
    schema_version: 1,
    items: [
      { id: "unsafe", category: "phd", heading: "Unsafe URL fixture", link: "javascript:alert(1)" },
      {
        id: "valid",
        category: "grant",
        heading: "Valid sibling",
        link: "https://example.invalid/valid",
      },
    ],
  }));
  const result = await collect(lease, test.deps, signal);
  equals(result.inserted, 1);
  equals(result.rejected, 1);
  assert(test.proposals[0][0].sourceUrl.startsWith("https://fixtures.example.invalid/"));
  assert(!JSON.stringify(test.proposals).includes("javascript:"));
});
