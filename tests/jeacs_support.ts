import type {
  CollectContext,
  CollectedPage,
} from "../supabase/functions/_shared/application/ports.ts";
import { collectionLimits } from "../supabase/functions/_shared/application/ports.ts";
import { jeacsManifest as m } from "../supabase/functions/_shared/adapters/sources/jeacs/manifest.ts";
export const journalFixture = (name: string) =>
  Deno.readTextFile(new URL(`./fixtures/jeacs/${name}`, import.meta.url));
export async function journalFixtures() {
  return {
    html: await journalFixture("directory.html"),
    policy: await journalFixture("policy.html"),
    detail: await journalFixture("detail-230.html"),
  };
}
export type JournalFixtures = Awaited<ReturnType<typeof journalFixtures>>;
export function journalPage(
  input: Omit<JournalFixtures, "detail"> & { detail: string | null },
  now = "2026-10-29T00:00:00Z",
  documentUrl: string = m.endpoint,
): CollectedPage {
  return {
    payload: JSON.stringify({ schemaVersion: 1, documentUrl, ...input, detailError: null }),
    format: "jeacs-html-v1",
    sourceUrl: documentUrl,
    fetchedAt: now,
    sourceRevision: "a".repeat(64),
    nextCursor: null,
    validators: {},
    notModified: false,
  };
}
export function journalTransport(f: JournalFixtures): typeof fetch {
  return (input) =>
    Promise.resolve(
      new Response(
        String(input) === m.policyUrl
          ? f.policy
          : String(input) === m.detailUrl
          ? f.detail
          : f.html,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    );
}
export function journalContext(http: CollectContext["http"]): CollectContext {
  return {
    source: {
      id: "s",
      slug: m.slug,
      enabled: true,
      approved: true,
      parserVersion: m.parserVersion,
      configVersion: 1,
      config: {},
    },
    http,
    clock: { now: () => "2026-10-29T00:00:00Z" },
    signal: new AbortController().signal,
    limits: collectionLimits,
  };
}
export function article(html: string, id: string): string {
  return [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].find((m) =>
    m[0].includes(`/view/${id}\"`)
  )![0];
}
export const directory = (...articles: string[]) =>
  `<!DOCTYPE html><html><body><div class="page page_announcements"><h1>Announcements</h1><ul class="cmp_announcements">${
    articles.map((a) => `<li>${a}</li>`).join("")
  }</ul></div></body></html>`;
