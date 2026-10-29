import {
  assertHistory,
  GuardError,
  safeError,
  validateConnection,
  validateProject,
  validateTarget,
} from "./guards.ts";

const ref = "a".repeat(20);
const input = {
  projectRef: ref,
  expectedProjectName: "Research Radar test",
  targetClass: "development",
  confirmedNoValuableData: true,
  confirmation: `phase-02:${ref}`,
  productionProjectRefs: [],
};
function assert(value: boolean) {
  if (!value) throw new Error("Assertion failed");
}
function rejects(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    assert(error instanceof GuardError);
    return;
  }
  throw new Error("Expected a safety guard rejection");
}
function connection(host: string, user = "postgres"): string {
  const url = new URL(`postgresql://${host}/postgres`);
  url.username = user;
  url.password = "test-only-not-a-credential";
  return url.href;
}

Deno.test("target is explicit, attested, nonproduction and consistent with linking", () => {
  assert(validateTarget(input).projectRef === ref);
  for (
    const patch of [
      { projectRef: "research-radar" },
      { confirmedNoValuableData: false },
      { confirmation: "" },
      { targetClass: "production" },
      { productionProjectRefs: [ref] },
      { productionProjectRefs: undefined },
      { expectedProjectName: "Production" },
    ]
  ) rejects(() => validateTarget({ ...input, ...patch }));
  rejects(() => validateTarget(input, "b".repeat(20)));
});

Deno.test("connection cannot silently target localhost, another project or unsafe TLS options", () => {
  const target = validateTarget(input);
  const wrongPort = new URL(connection(`db.${ref}.supabase.co`));
  wrongPort.port = "6543";
  assert(validateConnection(connection(`db.${ref}.supabase.co`), target).hostname.includes(ref));
  validateConnection(
    connection("aws-0-ap-southeast-1.pooler.supabase.com", `postgres.${ref}`),
    target,
  );
  for (
    const raw of [
      undefined,
      connection("localhost"),
      connection(`db.${"b".repeat(20)}.supabase.co`),
      connection(`db.${ref}.supabase.co`) + "?sslmode=disable",
      connection("aws-0-ap-southeast-1.pooler.supabase.com", "postgres"),
      wrongPort.href,
    ]
  ) rejects(() => validateConnection(raw, target));
});

Deno.test("management identity must match name, ref and actual health", () => {
  const target = validateTarget(input);
  validateProject(target, { id: ref, name: input.expectedProjectName, status: "ACTIVE_HEALTHY" });
  for (const patch of [{ id: "b".repeat(20) }, { name: "Other" }, { status: "INACTIVE" }]) {
    rejects(() =>
      validateProject(target, {
        id: ref,
        name: input.expectedProjectName,
        status: "ACTIVE_HEALTHY",
        ...patch,
      })
    );
  }
});

Deno.test("history is an exact ordered immutable prefix, not merely matching version names", () => {
  const local = [{ version: "20261028000100", name: "radar_schema", text: "select 1;\n" }];
  assertHistory(local, []);
  assertHistory(local, [{ ...local[0], statements: ["select 1;\r\n"] }]);
  for (
    const row of [
      { ...local[0], statements: ["select 2;"] },
      { ...local[0], version: "20261028000200", statements: [local[0].text] },
      { ...local[0], name: "other", statements: [local[0].text] },
    ]
  ) rejects(() => assertHistory(local, [row]));
});

Deno.test("driver errors cannot leak query, password or URL through diagnostics", () => {
  const error = { code: "23505", message: "sensitive value", query: "sensitive query" };
  assert(!safeError(error).includes("sensitive"));
  assert(safeError(error).includes("23505"));
  const tls = safeError({ code: "SELF_SIGNED_CERT_IN_CHAIN", message: "private connection URL" });
  assert(tls.includes("TLS certificate verification failed"));
  assert(!tls.includes("private connection URL"));
  assert(!safeError(new Error("private password")).includes("private password"));
});
