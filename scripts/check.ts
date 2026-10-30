async function run(command: string, args: string[]) {
  const result = await new Deno.Command(command, { args, stdout: "inherit", stderr: "inherit" })
    .output();
  if (!result.success) Deno.exit(result.code || 1);
}

const migrations = [...Deno.readDirSync("supabase/migrations")]
  .filter((entry) => entry.name.endsWith(".sql")).sort((a, b) => a.name.localeCompare(b.name));
if (migrations.length < 3) throw new Error("Missing Phase 02 baseline migrations.");
const sql = migrations.map((entry) => Deno.readTextFileSync(`supabase/migrations/${entry.name}`))
  .join("\n");
if ((sql.match(/^create table radar\./gm) ?? []).length !== 18) {
  throw new Error("Expected all 18 contract tables.");
}
if ((sql.match(/^create function public\.rr_/gm) ?? []).length !== 22) {
  throw new Error("Expected twenty-two narrow backend RPCs (including bounded rerank requests).");
}
const domainCountries = /AD AE AF[^"\r\n]+/.exec(
  Deno.readTextFileSync("supabase/functions/_shared/domain/primitives.ts"),
)?.[0];
const sqlCountries = [...sql.matchAll(/string_to_array\('(AD AE AF[^']+)'/g)].at(-1)?.[1];
if (!domainCountries || domainCountries !== sqlCountries) {
  throw new Error("Profile SQL/domain country catalogs differ.");
}
if (/security\s+definer/i.test(sql) || /^\s*(drop|truncate)\s/im.test(sql)) {
  throw new Error("Unexpected privilege escalation/destructive migration statement.");
}
function files(directory: string): string[] {
  return [...Deno.readDirSync(directory)].flatMap((entry) =>
    entry.isDirectory
      ? files(`${directory}/${entry.name}`)
      : entry.name.endsWith(".ts")
      ? [`${directory}/${entry.name}`]
      : []
  );
}
const modules = files("supabase/functions");
for (const path of modules) {
  if (path.endsWith("database.types.ts")) continue;
  const body = Deno.readTextFileSync(path);
  const imports = [...body.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)].map((m) => m[2]);
  if (
    path.includes("/_shared/domain/") &&
    (imports.some((p) => !p.startsWith("./")) || /\bDeno\b|\bfetch\s*\(/.test(body))
  ) throw new Error(`Domain boundary violation: ${path}`);
  if (
    path.includes("/_shared/application/") &&
    imports.some((p) => !p.startsWith("./") && !p.startsWith("../domain/"))
  ) throw new Error(`Application boundary violation: ${path}`);
  if (
    !path.includes("/infrastructure/supabase/") && !path.includes("/job-worker/") &&
    !path.includes("/telegram-webhook/") &&
    /database\.types|supabase-js/.test(body)
  ) throw new Error(`Persistence DTO leaked: ${path}`);
}
for (const kind of ["unit", "contract"]) {
  if (!files(`tests/${kind}`).some((p) => /_test\.ts$/.test(p))) {
    throw new Error(`Empty ${kind} test discovery`);
  }
}
await run(Deno.execPath(), [
  "fmt",
  "--check",
  "deno.json",
  "scripts",
  "supabase/functions",
  "tests",
]);
await run(Deno.execPath(), ["lint", "scripts", "supabase/functions", "tests"]);
await run(Deno.execPath(), [
  "check",
  "--frozen",
  "scripts/check.ts",
  "scripts/scan-secrets.ts",
  "scripts/db/main.ts",
  "scripts/db/guards_test.ts",
  ...files("scripts/sources"),
  ...files("scripts/telegram"),
  ...files("scripts/ranking"),
  ...modules,
  ...files("tests"),
]);
await run(Deno.execPath(), ["test", "--frozen", "--cached-only", "scripts/db/guards_test.ts"]);
await run(Deno.execPath(), ["task", "test:unit"]);
await run(Deno.execPath(), ["task", "test:contract"]);
const generated = "supabase/functions/_shared/infrastructure/supabase/database.types.ts";
try {
  await Deno.stat(generated);
  await run(Deno.execPath(), ["check", "--frozen", generated]);
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  console.log(
    "Hosted generated types are absent; Phase 02 completion remains gated on actual hosted verification.",
  );
}
await run(Deno.execPath(), [
  "run",
  "--frozen",
  "--allow-read=.",
  "--allow-run=git",
  "scripts/scan-secrets.ts",
]);
await run(Deno.build.os === "windows" ? "powershell" : "pwsh", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "scripts/validate-docs.ps1",
]);
console.log(
  "PASS: repository tooling checks. Hosted SQL execution/concurrency/grants are separate gates.",
);
