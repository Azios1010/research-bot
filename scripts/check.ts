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
if ((sql.match(/^create function public\.rr_/gm) ?? []).length < 12) {
  throw new Error("Expected twelve narrow backend RPCs.");
}
if (/security\s+definer/i.test(sql) || /^\s*(drop|truncate)\s/im.test(sql)) {
  throw new Error("Unexpected privilege escalation/destructive migration statement.");
}
await run(Deno.execPath(), [
  "fmt",
  "--check",
  "deno.json",
  "scripts/check.ts",
  "scripts/scan-secrets.ts",
  "scripts/db",
  "scripts/toolchain.json",
]);
await run(Deno.execPath(), ["lint", "scripts/check.ts", "scripts/scan-secrets.ts", "scripts/db"]);
await run(Deno.execPath(), [
  "check",
  "--frozen",
  "scripts/check.ts",
  "scripts/scan-secrets.ts",
  "scripts/db/main.ts",
  "scripts/db/guards_test.ts",
]);
await run(Deno.execPath(), ["test", "--frozen", "--cached-only", "scripts/db/guards_test.ts"]);
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
