import postgres from "postgres";
import {
  assertHistory,
  GuardError,
  normalize,
  safeError,
  validateConnection,
  validateProject,
  validateTarget,
} from "./guards.ts";
import { verifyConcurrency } from "./verify-concurrency.ts";

type Migration = { version: string; name: string; text: string; sha256: string };
type History = { version: string; name: string; statements: string[] | null };
const root = new URL("../../", import.meta.url);
const toolchain = JSON.parse(await Deno.readTextFile(new URL("scripts/toolchain.json", root)));
const mode = Deno.args[0];
let stage = "configuration";

export async function hash(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function migrations(): Promise<Migration[]> {
  const entries = [...Deno.readDirSync(new URL("supabase/migrations/", root))]
    .filter((entry) => entry.isFile && entry.name.endsWith(".sql"))
    .sort((a, b) => a.name.localeCompare(b.name));
  return await Promise.all(entries.map(async (entry) => {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(entry.name);
    if (!match) {
      throw new GuardError("Migration filename does not have a unique ordered version/name.");
    }
    const text = normalize(
      await Deno.readTextFile(new URL(`supabase/migrations/${entry.name}`, root)),
    );
    return { version: match[1], name: match[2], text, sha256: await hash(text) };
  }));
}

async function verificationSuiteHash(): Promise<string> {
  const paths = [
    "deno.json",
    "scripts/db/main.ts",
    "scripts/db/guards.ts",
    "scripts/db/verify-concurrency.ts",
    ...[...Deno.readDirSync(new URL("supabase/tests/database/", root))]
      .filter((entry) => entry.isFile && entry.name.endsWith(".sql"))
      .map((entry) => `supabase/tests/database/${entry.name}`),
  ].sort();
  return await hash(JSON.stringify(
    await Promise.all(paths.map(async (path) => [
      path,
      normalize(await Deno.readTextFile(new URL(path, root))),
    ])),
  ));
}

async function cliPath(): Promise<string> {
  const candidates = [Deno.env.get("RADAR_SUPABASE_CLI"), "supabase"];
  if (Deno.build.os === "windows") {
    for (const directory of (Deno.env.get("PATH") ?? "").split(";")) {
      candidates.push(`${directory}/supabase.exe`, `${directory}/../supabase/bin/supabase.exe`);
    }
  }
  for (const candidate of candidates.filter((value): value is string => Boolean(value))) {
    try {
      const output = await new Deno.Command(candidate, {
        args: ["--version"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (output.success && new TextDecoder().decode(output.stdout).trim() === toolchain.supabase) {
        return candidate;
      }
    } catch { /* Missing PATH entries are expected; never print command diagnostics. */ }
  }
  throw new GuardError(
    "Pinned Supabase CLI is unavailable. Use the documented pinned npm-cache invocation or RADAR_SUPABASE_CLI.",
  );
}

async function management(token: string, path: string): Promise<unknown> {
  const response = await fetch(`https://api.supabase.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) {
    throw new GuardError(
      `Read-only Management API inventory failed (HTTP ${response.status}); response withheld.`,
    );
  }
  return await response.json();
}

async function history(sql: postgres.Sql | postgres.TransactionSql): Promise<History[]> {
  const [{ exists }] =
    await sql`select to_regclass('supabase_migrations.schema_migrations') is not null as exists`;
  if (!exists) return [];
  const rows = await sql<
    History[]
  >`select version,name,statements from supabase_migrations.schema_migrations order by version`;
  return Array.from(rows);
}

async function inventory(sql: postgres.Sql, local: Migration[]): Promise<History[]> {
  return await sql.begin(async (tx) => {
    await tx`set transaction read only`;
    const [{ version }] =
      await tx`select current_setting('server_version_num')::integer as version`;
    if (version < 150000) {
      throw new GuardError("PostgreSQL 15 or newer is required; actual version must be reviewed.");
    }
    const rows = await history(tx);
    assertHistory(local, rows);
    const objects = await tx<{ schema: string; name: string }[]>`
      select n.nspname as schema,c.relname as name from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p','v','m','S') and n.nspname not like 'pg_%'
        and n.nspname not in ('information_schema','auth','storage','extensions','graphql','graphql_public',
          'net','supabase_functions','supabase_migrations','realtime','vault','pgbouncer','cron')
        and not exists(select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
        and not (n.nspname = 'radar' and ${rows.length > 0})`;
    if (objects.length) {
      throw new GuardError(
        "Target has unrelated/unrecognized application objects; inventory requires operator review before any write.",
      );
    }
    const functions = await tx`
      select p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and not exists (
        select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        and not (${rows.length > 0} and p.proname = any(${[
      "rr_create_collection_run",
      "rr_enqueue_task",
      "rr_claim_task",
      "rr_renew_task",
      "rr_finish_task",
      "rr_accept_telegram_update",
      "rr_apply_feedback",
      "rr_commit_source_page",
      "rr_prepare_notification",
      "rr_begin_notification_attempt",
      "rr_finish_notification_attempt",
      "rr_store_assessments",
      "rr_read_collection_context",
      "rr_read_candidates",
      "rr_read_assessment_context",
    ]}))`;
    if (functions.length) {
      throw new GuardError("Target has unrelated public routines; refusing automatic mutation.");
    }
    const schemas = await tx<{ name: string }[]>`
      select nspname as name from pg_catalog.pg_namespace where nspname not like 'pg_%'
        and nspname not in ('public','information_schema','auth','storage','extensions','graphql','graphql_public',
          'net','supabase_functions','supabase_migrations','realtime','vault','pgbouncer','cron','radar')`;
    if (schemas.length) {
      throw new GuardError("Target has unreviewed custom schemas; refusing automatic mutation.");
    }
    // Supabase-owned schemas may still contain valuable user data/configuration.
    // Inspect existence only, never secret values or personal records.
    for (
      const table of [
        "auth.users",
        "storage.objects",
        "storage.buckets",
        "vault.secrets",
        "cron.job",
      ]
    ) {
      const [{ present }] = await tx`select to_regclass(${table}) is not null as present`;
      if (present) {
        const [{ occupied }] = await tx.unsafe<{ occupied: boolean }[]>(
          `select exists(select 1 from ${table} limit 1) as occupied`,
        );
        if (occupied) {
          throw new GuardError(
            "Target contains hosted auth/storage/Vault/Cron data or configuration; isolated no-valuable-data gate failed.",
          );
        }
      }
    }
    if (rows.length) {
      const tables = await tx<
        { name: string }[]
      >`select tablename as name from pg_catalog.pg_tables where schemaname = 'radar' and tablename not in ('opportunity_types','system_settings')`;
      for (const table of tables) {
        const [{ count }] = await tx.unsafe<{ count: string }[]>(
          `select count(*)::text as count from radar."${table.name.replaceAll('"', '""')}"`,
        );
        if (count !== "0") {
          throw new GuardError(
            "Target contains application data; review valuable-data status or clean only known test fixtures before verification.",
          );
        }
      }
    }
    const extensions = await tx<
      { name: string; version: string }[]
    >`select extname as name,extversion as version from pg_catalog.pg_extension order by extname`;
    const roles =
      await tx`select rolname,rolbypassrls from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')`;
    if (
      roles.length !== 3 ||
      !roles.some((role) => role.rolname === "service_role" && role.rolbypassrls)
    ) {
      throw new GuardError(
        "Expected Supabase roles/backend RLS-bypass configuration was not verified.",
      );
    }
    console.log(
      JSON.stringify({
        postgresVersion: version,
        extensions,
        applicationData: "none",
        migrationCount: rows.length,
        roles,
      }),
    );
    return rows;
  });
}

async function apply(sql: postgres.Sql, local: Migration[]) {
  for (const migration of local) {
    const applied = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('research-radar:migrations',0))`;
      const rows = await history(tx);
      assertHistory(local, rows);
      if (rows.some((row) => row.version === migration.version)) return false;
      if (local[rows.length]?.version !== migration.version) {
        throw new GuardError("Migration sequence changed during application.");
      }
      // Supabase CLI-compatible metadata only; application DDL is exclusively in migration files.
      await tx.unsafe("create schema if not exists supabase_migrations");
      await tx.unsafe(
        "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)",
      );
      await tx.unsafe(migration.text).simple();
      await tx`insert into supabase_migrations.schema_migrations(version,name,statements)
        values(${migration.version},${migration.name},${[migration.text]})`;
      return true;
    });
    console.log(
      `Migration ${migration.version}_${migration.name}: ${
        applied ? "applied" : "already applied (no-op)"
      }`,
    );
  }
}

async function schemaFingerprint(sql: postgres.Sql): Promise<string> {
  const rows = await sql`
    select 'column' as kind,table_name || '.' || column_name as name,
      data_type || ':' || is_nullable || ':' || coalesce(column_default,'') || ':' || coalesce(domain_name,'') as definition
    from information_schema.columns where table_schema = 'radar'
    union all select 'function',p.proname,pg_catalog.pg_get_functiondef(p.oid) || ':' || coalesce(p.proacl::text,'')
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'radar' or (n.nspname = 'public' and p.proname like 'rr_%')
    union all select 'constraint',c.conname,pg_catalog.pg_get_constraintdef(c.oid)
    from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace where n.nspname = 'radar'
    union all select 'index',indexname,indexdef from pg_catalog.pg_indexes where schemaname = 'radar'
    union all select 'table_acl',c.relname,c.relrowsecurity::text || ':' || coalesce(c.relacl::text,'')
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'radar' and c.relkind = 'r'
    union all select 'schema_acl',nspname,coalesce(nspacl::text,'') from pg_catalog.pg_namespace where nspname = 'radar'
    union all select 'policy',tablename || '.' || policyname,roles::text || ':' || cmd || ':' || coalesce(qual,'') || ':' || coalesce(with_check,'')
    from pg_catalog.pg_policies where schemaname = 'radar'
    order by kind,name,definition`;
  return await hash(JSON.stringify(rows));
}

async function generate(cli: string, projectRef: string): Promise<void> {
  const result = await new Deno.Command(cli, {
    args: ["gen", "types", "typescript", "--project-id", projectRef, "--schema", "radar,public"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const types = new TextDecoder().decode(result.stdout);
  if (!result.success || !types.includes("export type Database") || !types.includes("radar:")) {
    throw new GuardError(
      "Actual hosted type generation failed; no fabricated type file was written.",
    );
  }
  const directory = new URL("supabase/functions/_shared/infrastructure/supabase/", root);
  await Deno.mkdir(directory, { recursive: true });
  const file = new URL("database.types.ts", directory);
  await Deno.writeTextFile(file, types);
  const formatted = await new Deno.Command(Deno.execPath(), {
    args: [
      "fmt",
      "--no-config",
      "--line-width=100",
      decodeURIComponent(file.pathname).replace(/^\/(?=[A-Za-z]:)/, ""),
    ],
    stdout: "null",
    stderr: "null",
  }).output();
  if (!formatted.success) {
    throw new GuardError(
      "Generated hosted types exist but formatting failed; inspect before completion.",
    );
  }
  console.log(
    "Generated actual hosted persistence types at supabase/functions/_shared/infrastructure/supabase/database.types.ts",
  );
}

async function main() {
  if (
    ![
      "plan",
      "verify",
      "types",
      "integration",
      "conferences",
      "positions",
      "funding",
      "journals",
      "sources-smoke",
    ]
      .includes(mode)
  ) {
    throw new GuardError(
      "Expected plan, verify, types, integration, conferences, positions, funding, journals or sources-smoke mode.",
    );
  }
  if (
    mode === "sources-smoke" &&
    (Deno.args.length !== 3 || Deno.args[1] !== "--source" ||
      ![
        "ccfddl",
        "ccfddl-hotos",
        "openreview-workshop-call",
        "bath-research",
        "cern-students",
        "grants-gov-research",
        "jeacs-journal-calls",
      ]
        .includes(
          Deno.args[2],
        ))
  ) {
    throw new GuardError(
      "An explicit approved --source slug is required; no upstream or database writes ran.",
    );
  }
  if (Deno.version.deno !== toolchain.deno) {
    throw new GuardError("Use the pinned Deno version in scripts/toolchain.json.");
  }
  const local = await migrations();
  let input: unknown;
  try {
    input = JSON.parse(
      await Deno.readTextFile(
        Deno.env.get("RADAR_DB_TARGET_FILE") ?? new URL("private/database-target.json", root),
      ),
    );
  } catch {
    throw new GuardError(
      "Missing/invalid private database target configuration. No remote inventory, mutation, or type generation ran.",
    );
  }
  let linked: string | undefined;
  try {
    linked = (await Deno.readTextFile(new URL("supabase/.temp/project-ref", root))).trim();
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const target = validateTarget(input, linked);
  const url = validateConnection(Deno.env.get("RADAR_DB_URL"), target);
  const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    throw new GuardError(
      "SUPABASE_ACCESS_TOKEN is absent; hosted project authentication/inventory is blocked.",
    );
  }
  stage = "CLI and read-only project inventory";
  const cli = await cliPath();
  validateProject(target, await management(token, `projects/${target.projectRef}`));
  const rest = await management(token, `projects/${target.projectRef}/postgrest`) as Record<
    string,
    unknown
  >;
  if (
    typeof rest.db_schema !== "string" ||
    rest.db_schema.split(",").map((x) => x.trim()).includes("radar")
  ) {
    throw new GuardError("Data API exposed schemas were not verified as excluding radar.");
  }
  let ca: string | undefined;
  try {
    ca = await Deno.readTextFile(new URL("private/supabase-ca.crt", root));
    if (ca.length > 65536 || !ca.includes("-----BEGIN CERTIFICATE-----")) {
      throw new GuardError("Local database CA must be a bounded PEM certificate bundle.");
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const sql = postgres(url.href, {
    ssl: { rejectUnauthorized: true, servername: url.hostname, ...(ca ? { ca } : {}) },
    prepare: false,
    max: 4,
    connect_timeout: 10,
    idle_timeout: 5,
    connection: {
      application_name: "research-radar-phase02",
      statement_timeout: 30000,
      lock_timeout: 10000,
    },
    onnotice: () => {},
    debug: false,
  });
  let verificationLock: Awaited<ReturnType<typeof sql.reserve>> | undefined;
  try {
    stage = "read-only database inventory and migration plan";
    const remote = await inventory(sql, local);
    const planHash = await hash(
      JSON.stringify({
        projectRef: target.projectRef,
        local: local.map((m) => [m.version, m.sha256]),
        applied: remote.map((m) => m.version),
      }),
    );
    console.log(
      JSON.stringify({
        targetClass: target.targetClass,
        projectRef: target.projectRef,
        planHash,
        pending: local.slice(remote.length).map((m) => ({
          version: m.version,
          name: m.name,
          sha256: m.sha256,
        })),
      }),
    );
    if (mode === "plan") {
      console.log(
        "Read-only plan complete; review migration SQL and set RADAR_DB_PLAN_SHA256 only for the reviewed pending plan.",
      );
      return;
    }
    const receiptPath = new URL("private/phase02-verification.json", root);
    if (mode === "verify") {
      if (remote.length < local.length && Deno.env.get("RADAR_DB_PLAN_SHA256") !== planHash) {
        throw new GuardError(
          "Pending migrations require the exact reviewed RADAR_DB_PLAN_SHA256 from db:plan. No writes ran.",
        );
      }
      verificationLock = await sql.reserve();
      const [{ locked }] =
        await verificationLock`select pg_try_advisory_lock(hashtextextended('research-radar:verification',0)) as locked`;
      if (!locked) {
        throw new GuardError("Another verifier owns this isolated target; no writes ran.");
      }
      const lockedHistory = await inventory(sql, local);
      if (lockedHistory.length !== remote.length) {
        throw new GuardError("Target history changed after the reviewed plan; rerun db:plan.");
      }
      stage = "migration application";
      await apply(sql, local);
      assertHistory(local, await history(sql));
      // Second invocation must be a history-based no-op, not schema re-creation.
      await apply(sql, local);
      stage = "transaction-rollback SQL assertions";
      for (
        const entry of [...Deno.readDirSync(new URL("supabase/tests/database/", root))].sort((
          a,
          b,
        ) => a.name.localeCompare(b.name))
      ) {
        if (!entry.name.endsWith(".sql")) continue;
        await sql.begin(async (tx) => {
          await tx.unsafe(
            await Deno.readTextFile(new URL(`supabase/tests/database/${entry.name}`, root)),
          ).simple();
          const [{ assertions, plans }] = await tx`select
            to_regclass('pg_temp.rr_assertions') is not null as assertions,
            to_regclass('pg_temp.rr_query_plans') is not null as plans`;
          if (assertions) {
            const [{ count }] =
              await tx`select count(*)::integer as count from pg_temp.rr_assertions`;
            console.log(JSON.stringify({ sqlTest: entry.name, assertions: count }));
          }
          if (plans) {
            console.log(
              JSON.stringify({
                queryPlans:
                  await tx`select name,index_name from pg_temp.rr_query_plans order by name`,
              }),
            );
          }
          throw new RollbackPassed();
        }).catch((error) => {
          if (error instanceof RollbackPassed) return;
          // Only fixture-authored assertion labels, never SQL/values/server details.
          if (
            error?.code === "P0001" && typeof error.message === "string" &&
            /^(assertion_failed|unexpected_sqlstate):[A-Za-z0-9 _]+(:[A-Z0-9]{5})?$/.test(
              error.message,
            )
          ) {
            throw new GuardError(`Hosted fixture ${entry.name}: ${error.message}`);
          }
          throw error;
        });
        console.log(`PASS: hosted SQL ${entry.name} (test transaction rolled back)`);
      }
      stage = "hosted concurrent-client assertions and cleanup";
      await verifyConcurrency(sql);
      await inventory(sql, local);
      const receipt = {
        projectRef: target.projectRef,
        verifiedAt: new Date().toISOString(),
        migrations: local.map((m) => [m.version, m.sha256]),
        schemaFingerprint: await schemaFingerprint(sql),
        verificationSuite: await verificationSuiteHash(),
        deno: Deno.version.deno,
        supabase: toolchain.supabase,
      };
      await Deno.mkdir(new URL("private/", root), { recursive: true });
      await Deno.writeTextFile(receiptPath, JSON.stringify(receipt, null, 2));
    } else {
      const receipt = JSON.parse(await Deno.readTextFile(receiptPath));
      if (
        receipt.projectRef !== target.projectRef ||
        JSON.stringify(receipt.migrations) !==
          JSON.stringify(local.map((m) => [m.version, m.sha256])) ||
        receipt.schemaFingerprint !== await schemaFingerprint(sql) ||
        remote.length !== local.length ||
        receipt.verificationSuite !== await verificationSuiteHash()
      ) {
        throw new GuardError(
          "Types require successful hosted verification for this exact schema/ref/migration set.",
        );
      }
    }
    if (
      ["integration", "conferences", "positions", "funding", "journals", "sources-smoke"].includes(
        mode,
      )
    ) {
      stage = "Phase 03 hosted application integration";
      verificationLock = await sql.reserve();
      const [{ locked }] =
        await verificationLock`select pg_try_advisory_lock(hashtextextended('research-radar:verification',0)) as locked`;
      if (!locked) {
        throw new GuardError("Another verifier owns this isolated target; no writes ran.");
      }
      if (mode === "integration") {
        const suite = await import(
          new URL("../../tests/integration/pipeline.ts", import.meta.url).href
        ) as {
          verifyPipeline: (
            sql: postgres.Sql,
            target: { projectRef: string },
            token: string,
          ) => Promise<void>;
        };
        await suite.verifyPipeline(sql, target, token);
      }
      stage = "Phase 04 hosted conference integration";
      if (
        ["integration", "conferences"].includes(mode) ||
        mode === "sources-smoke" && Deno.args[2] === "ccfddl"
      ) {
        const conferences = await import(
          new URL("../../tests/integration/conferences.ts", import.meta.url).href
        ) as {
          verifyConferences: (
            sql: postgres.Sql,
            target: { projectRef: string },
            token: string,
            live?: boolean,
          ) => Promise<void>;
        };
        await conferences.verifyConferences(sql, target, token, mode === "sources-smoke");
      }
      if (
        ["integration", "conferences"].includes(mode) ||
        mode === "sources-smoke" &&
          ["ccfddl-hotos", "openreview-workshop-call"].includes(Deno.args[2])
      ) {
        const coverage = await import(
          new URL("../../tests/integration/conference_coverage.ts", import.meta.url).href
        ) as {
          verifyCoverageSources: (
            sql: postgres.Sql,
            target: { projectRef: string },
            token: string,
            liveSlug?: string,
          ) => Promise<void>;
        };
        await coverage.verifyCoverageSources(
          sql,
          target,
          token,
          mode === "sources-smoke" ? Deno.args[2] : undefined,
        );
      }
      if (
        ["integration", "positions"].includes(mode) ||
        mode === "sources-smoke" && Deno.args[2] === "bath-research"
      ) {
        stage = "Phase 05 hosted position integration";
        const positions = await import("../../tests/integration/positions.ts");
        await positions.verifyPositions(
          sql,
          target,
          token,
          mode === "sources-smoke" ? Deno.args[2] : undefined,
        );
      }
      if (
        ["integration", "positions"].includes(mode) ||
        mode === "sources-smoke" && Deno.args[2] === "cern-students"
      ) {
        stage = "Phase 05 hosted CERN integration";
        const cern = await import("../../tests/integration/cern.ts");
        await cern.verifyCern(sql, target, token, mode === "sources-smoke");
      }
      if (
        ["integration", "funding"].includes(mode) ||
        mode === "sources-smoke" && Deno.args[2] === "grants-gov-research"
      ) {
        stage = "Phase 05 hosted funding integration";
        const funding = await import("../../tests/integration/funding.ts");
        await funding.verifyFunding(sql, target, token, mode === "sources-smoke");
      }
      if (
        ["integration", "journals"].includes(mode) ||
        mode === "sources-smoke" && Deno.args[2] === "jeacs-journal-calls"
      ) {
        stage = "Phase 06 hosted journal author-call integration";
        const journals = await import("../../tests/integration/journals.ts");
        await journals.verifyJournals(sql, target, token, mode === "sources-smoke");
      }
      if (["integration", "funding", "journals"].includes(mode)) {
        stage = "Phase 06 hosted cross-source failure isolation and disable behavior";
        const isolation = await import("../../tests/integration/source_isolation.ts");
        await isolation.verifySourceIsolation(sql, target, token);
      }
      await inventory(sql, local);
      return;
    }
    stage = "actual hosted persistence type generation";
    await generate(cli, target.projectRef);
    console.log(
      "PASS: hosted verification/type generation. Update phase evidence; this tool does not change roadmap status.",
    );
  } finally {
    try {
      if (verificationLock) {
        try {
          await verificationLock`select pg_advisory_unlock(hashtextextended('research-radar:verification',0))`;
        } finally {
          verificationLock.release();
        }
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

class RollbackPassed extends Error {}
try {
  await main();
} catch (error) {
  console.error(`FAIL [${stage}]: ${safeError(error)}`);
  Deno.exitCode = 1;
}
