import type postgres from "postgres";
import { assert, TestAssertionError } from "../support.ts";
import { collect } from "../../supabase/functions/_shared/application/collect.ts";
import {
  type Lease,
  ProcessingError,
  type SourceAdapter,
} from "../../supabase/functions/_shared/application/ports.ts";
import {
  approvedEndpoints,
  approvedReadPostEndpoints,
} from "../../supabase/functions/_shared/adapters/sources/registry.ts";
import { SupabaseRepository } from "../../supabase/functions/_shared/infrastructure/supabase/repository.ts";
import { persistenceClient } from "../../supabase/functions/_shared/infrastructure/supabase/client.ts";
import { BoundedHttpClient } from "../../supabase/functions/_shared/infrastructure/http/bounded.ts";
import { StructuredLogger } from "../../supabase/functions/_shared/infrastructure/observability/logging.ts";

// Test-only SQL setup/assertion/cleanup. Called solely after main.ts target/receipt/lock guards.
export async function sourceSession(
  sql: postgres.Sql,
  target: { projectRef: string },
  token: string,
  adapter: SourceAdapter,
  transport: typeof fetch,
  verify: (
    session: {
      id: string;
      repository: SupabaseRepository;
      execute: () => Promise<
        { run: string; leases: Lease[]; results: Awaited<ReturnType<typeof collect>>[] }
      >;
      snapshot: () => Promise<postgres.RowList<postgres.Row[]>>;
      deps: {
        repository: SupabaseRepository;
        adapters: Map<string, SourceAdapter>;
        http: BoundedHttpClient;
        clock: { now: () => string };
        logger: StructuredLogger;
      };
      measurements: unknown[];
    },
  ) => Promise<void>,
) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target.projectRef}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new ProcessingError("backend_key_unavailable");
  const keys = await response.json() as { name?: string; type?: string; api_key?: string }[],
    key = keys.find((k) => k.name === "service_role")?.api_key ??
      keys.find((k) => k.type === "secret")?.api_key;
  if (!key) throw new ProcessingError("backend_key_unavailable");
  const repository = new SupabaseRepository(
      persistenceClient(`https://${target.projectRef}.supabase.co`, key),
    ),
    id = crypto.randomUUID(),
    clock = { now: () => new Date().toISOString() },
    measurements: unknown[] = [];
  const observed: typeof fetch = async (input, init) => {
    const r = await transport(input, init);
    const measurement = { url: String(input), status: r.status, decodedBytes: 0 };
    measurements.push(measurement);
    const stream = r.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          measurement.decodedBytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(stream ?? null, { status: r.status, headers: r.headers });
  };
  const deps = {
      repository,
      adapters: new Map([[adapter.slug, adapter]]),
      http: new BoundedHttpClient(approvedEndpoints, observed, approvedReadPostEndpoints),
      clock,
      logger: new StructuredLogger(),
    },
    created = new Set<string>();
  const [pause] = await sql`select value from radar.system_settings where key='collection_paused'`;
  const snapshot = async () =>
    await sql`select o.id,o.type_code,o.title,o.organization,o.canonical_url,o.cycle_key,o.work_mode,o.country_codes,o.location_text,o.published_at::text,o.qualification_tags,o.attributes,o.field_provenance,o.content_revision,r.id as observation_id,r.source_record_key,r.source_url,d.id as deadline_id,d.due_at::text,d.due_date::text,d.timezone,d.precision,d.revision as deadline_revision from radar.source_records r join radar.opportunities o on o.id=r.opportunity_id left join radar.opportunity_deadlines d on d.opportunity_id=o.id where r.source_id=${id} order by r.source_record_key`;
  const execute = async () => {
    const run = await repository.createRun(id, `p05:${id}:${crypto.randomUUID()}`, "test"),
      leases: Lease[] = [],
      results: Awaited<ReturnType<typeof collect>>[] = [];
    for (let i = 0; i < 6; i++) {
      const lease = await repository.claim(crypto.randomUUID(), ["collect_page"]);
      if (!lease) break;
      assert(lease.runId === run, "scoped source task claim");
      leases.push(lease);
      results.push(await collect(lease, deps, new AbortController().signal));
      for (const row of await snapshot()) created.add(String(row.id));
    }
    const [state] = await sql`select status from radar.collection_runs where id=${run}`;
    assert(
      ["succeeded", "partial"].includes(state.status),
      "bounded source run reached terminal state",
    );
    return { run, leases, results };
  };
  try {
    await sql`update radar.system_settings set value='{"enabled":false}' where key='collection_paused'`;
    await sql`insert into radar.sources(id,slug,name,category,adapter_version,enabled,approved_at)values(${id},${adapter.slug},'Scoped Phase 05 source','phase05-test',${adapter.parserVersion},true,clock_timestamp())`;
    await verify({ id, repository, execute, snapshot, deps, measurements });
  } catch (error) {
    if (error instanceof TestAssertionError) console.error(`Source assertion: ${error.message}`);
    if (error instanceof ProcessingError) console.error(`Source error: ${error.code}`);
    throw error;
  } finally {
    for (const row of await snapshot()) created.add(String(row.id));
    const ids = [...created];
    await sql.begin(async (tx) => {
      await tx`delete from radar.job_tasks where collection_run_id in(select id from radar.collection_runs where source_id=${id})`;
      await tx`delete from radar.opportunity_deadlines where opportunity_id=any(${ids}::uuid[])`;
      await tx`delete from radar.opportunity_identities where opportunity_id=any(${ids}::uuid[])`;
      await tx`delete from radar.source_records where source_id=${id}`;
      await tx`delete from radar.collection_runs where source_id=${id}`;
      await tx`delete from radar.opportunities where id=any(${ids}::uuid[])`;
      await tx`delete from radar.sources where id=${id}`;
      await tx`update radar.system_settings set value=${
        tx.json(pause.value)
      } where key='collection_paused'`;
    });
    const [remaining] =
      await sql`select exists(select 1 from radar.sources where id=${id}) as source,exists(select 1 from radar.opportunities where id=any(${ids}::uuid[])) as canonical`;
    assert(!remaining.source && !remaining.canonical, "scoped source cleanup");
    console.log(`PASS: ${adapter.slug} scoped source cleanup; pause restored.`);
  }
}
