export class GuardError extends Error {}

export interface Target {
  projectRef: string;
  expectedProjectName: string;
  targetClass: "development" | "disposable_branch";
  confirmedNoValuableData: true;
  confirmation: string;
  productionProjectRefs: string[];
}

export function validateTarget(input: unknown, linkedRef?: string): Target {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new GuardError("Target configuration must be an explicit object.");
  }
  const v = input as Record<string, unknown>;
  if (
    typeof v.projectRef !== "string" || !/^[a-z]{20}$/.test(v.projectRef) ||
    typeof v.expectedProjectName !== "string" || !v.expectedProjectName.trim() ||
    !["development", "disposable_branch"].includes(String(v.targetClass)) ||
    v.confirmedNoValuableData !== true ||
    v.confirmation !== `phase-02:${v.projectRef}` ||
    !Array.isArray(v.productionProjectRefs) ||
    !v.productionProjectRefs.every((ref) => typeof ref === "string" && /^[a-z]{20}$/.test(ref))
  ) {
    throw new GuardError(
      "A designated isolated target and no-valuable-data attestation are required.",
    );
  }
  if (v.productionProjectRefs.includes(v.projectRef)) {
    throw new GuardError("Refusing a known production target.");
  }
  if (/\b(prod|production|live)\b/i.test(v.expectedProjectName)) {
    throw new GuardError("Refusing a project identified as production/live.");
  }
  if (linkedRef && linkedRef !== v.projectRef) {
    throw new GuardError("Linked CLI project disagrees with the explicit isolated target.");
  }
  return v as unknown as Target;
}

export function validateConnection(raw: string | undefined, target: Target): URL {
  if (!raw) {
    throw new GuardError(
      "RADAR_DB_URL is required in the local environment; never paste it into a command.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GuardError("Database connection configuration is invalid (value withheld).");
  }
  const direct = url.hostname === `db.${target.projectRef}.supabase.co` &&
    decodeURIComponent(url.username) === "postgres";
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    decodeURIComponent(url.username) === `postgres.${target.projectRef}`;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) || (!direct && !pooler) ||
    (url.port && url.port !== "5432") || url.pathname !== "/postgres" ||
    !url.password || url.search || url.hash
  ) {
    throw new GuardError(
      "Connection must identify the verified hosted project, use port 5432 and no TLS override/query options.",
    );
  }
  return url;
}

export function validateProject(target: Target, input: unknown): void {
  const p = input as Record<string, unknown>;
  if (
    p?.id !== target.projectRef || p?.name !== target.expectedProjectName ||
    p?.status !== "ACTIVE_HEALTHY"
  ) {
    throw new GuardError(
      "Management API project identity/name/healthy status did not match the designated target.",
    );
  }
}

export function assertHistory(
  local: { version: string; name: string; text: string }[],
  remote: { version: string; name: string; statements: string[] | null }[],
): void {
  for (const [index, row] of remote.entries()) {
    const migration = local[index];
    if (
      !migration || row.version !== migration.version || row.name !== migration.name ||
      row.statements?.length !== 1 || normalize(row.statements[0]) !== normalize(migration.text)
    ) {
      throw new GuardError(
        "Remote migration history diverges from immutable repository migrations; no repair was attempted.",
      );
    }
  }
}

export function normalize(text: string): string {
  return text.replaceAll("\r\n", "\n").trim();
}

export function safeError(error: unknown): string {
  if (error instanceof GuardError) return error.message;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (
    [
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "CERT_HAS_EXPIRED",
    ].includes(code)
  ) {
    return "Database TLS certificate verification failed. Review the official Supabase CA in private/supabase-ca.crt; verification was not disabled.";
  }
  return /^[0-9A-Z]{5}$/.test(code)
    ? `Database operation failed (SQLSTATE ${code}); SQL, values and connection details withheld.`
    : "Operation failed; sensitive error details withheld. Inspect configuration/connectivity using secure operator tooling.";
}
