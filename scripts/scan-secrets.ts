const patterns = [
  /\b[0-9]{6,12}:[A-Za-z0-9_-]{30,}\b/,
  /\bsb[p]_\w{30,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^\s/:'"]+:[^\s@'"`]+@/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
];
let scanned = 0;
const findings: string[] = [];
const result = await new Deno.Command("git", {
  args: ["ls-files", "-c", "-o", "--exclude-standard", "-z"],
  stdout: "piped",
  stderr: "null",
}).output();
if (!result.success) throw new Error("Credential scan requires the verified repository Git index.");
for (const file of new Set(new TextDecoder().decode(result.stdout).split("\0").filter(Boolean))) {
  if (
    /^(private|backups)\//.test(file) ||
    /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example")
  ) {
    findings.push(`${file}: private file would enter Git`);
    continue;
  }
  try {
    if ((await Deno.lstat(file)).isSymlink) {
      findings.push(`${file}: symlink content was not scanned`);
      continue;
    }
    const text = await Deno.readTextFile(file);
    scanned++;
    if (patterns.some((pattern) => pattern.test(text))) {
      findings.push(`${file}: credential-shaped content`);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
if (findings.length) {
  for (const finding of findings) console.error(finding);
  Deno.exit(1);
}
console.log(
  `PASS: credential-pattern scan of ${scanned} project files; no matching values printed.`,
);
