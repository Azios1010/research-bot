import { digest } from "../../supabase/functions/_shared/domain/primitives.ts";

// Only reviewed repository inputs. Never read secret/target configuration into an evidence hash.
export async function conferenceInputHash(): Promise<string> {
  const root = new URL("../../", import.meta.url), paths = ["deno.json", "deno.lock"];
  async function walk(path: string) {
    for await (const entry of Deno.readDir(new URL(path, root))) {
      const next = `${path}${entry.name}`;
      if (entry.isDirectory) await walk(`${next}/`);
      else if (/\.(ts|json|sql|yml)$/.test(next) || entry.name === "LICENSE") paths.push(next);
    }
  }
  for (
    const path of [
      "supabase/functions/",
      "supabase/migrations/",
      "tests/",
      "scripts/db/",
      "scripts/sources/",
    ]
  ) await walk(path);
  return await digest(
    await Promise.all(
      paths.sort().map(
        async (path) => [
          path,
          (await Deno.readTextFile(new URL(path, root))).replaceAll("\r\n", "\n"),
        ],
      ),
    ),
  );
}
