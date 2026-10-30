import { JeacsAdapter } from "../../supabase/functions/_shared/adapters/sources/jeacs/adapter.ts";
import {
  cards,
  journalContext,
} from "../../supabase/functions/_shared/adapters/sources/jeacs/html.ts";
import { mapCall } from "../../supabase/functions/_shared/adapters/sources/jeacs/mapping.ts";
import { jeacsManifest as m } from "../../supabase/functions/_shared/adapters/sources/jeacs/manifest.ts";
import { bytes } from "../../supabase/functions/_shared/domain/primitives.ts";
import { article, directory, journalFixtures, journalPage } from "../../tests/jeacs_support.ts";

const fixture = await journalFixtures();
const pad = (html: string, limit: number) => {
  const count = limit - bytes(html) - 7;
  if (count < 0) throw new Error("Benchmark fixture exceeds approved bound");
  return html.replace("</body>", `<!--${"x".repeat(count)}--></body>`);
};
const upper = {
  html: pad(
    directory(
      ...Array.from(
        { length: m.maxRecords },
        (_, i) =>
          article(fixture.html, "230").replaceAll("/view/230", `/view/${i === 0 ? 230 : 5000 + i}`),
      ),
    ),
    m.maxDirectoryBytes,
  ),
  policy: pad(fixture.policy, m.maxPolicyBytes),
  detail: pad(fixture.detail, m.maxDetailBytes),
};
for (
  const [name, input] of [["sanitized-facts", fixture], ["synthetic-upper-bound", upper]] as const
) {
  const parse: number[] = [],
    mapping: number[] = [],
    total: number[] = [],
    before = Deno.memoryUsage();
  let memory = before, records = 0, accepted = 0;
  const page = journalPage(input);
  for (let i = 0; i < 30; i++) {
    const start = performance.now(),
      journal = journalContext(input.policy),
      rows = cards(input.html),
      detail = cards(input.detail, m.detailUrl)[0];
    parse.push(performance.now() - start);
    const groups = new Map<string, typeof rows>();
    for (const c of rows) {
      const id = c.id ? m.aliases[c.id] ?? c.id : "malformed";
      groups.set(id, [...(groups.get(id) ?? []), c]);
    }
    const mapStart = performance.now();
    const mapped = [...groups].map(([id, group]) =>
      mapCall(group, journal, page, id === m.detailId ? detail : null)
    );
    mapping.push(performance.now() - mapStart);
    records = mapped.length;
    accepted = mapped.filter((r) => r.kind === "record").length;
    const fullStart = performance.now();
    if ([...new JeacsAdapter().parsePage(page)].length !== records) {
      throw new Error("Benchmark mapping mismatch");
    }
    total.push(performance.now() - fullStart);
    const sample = Deno.memoryUsage();
    memory = {
      ...sample,
      rss: Math.max(sample.rss, memory.rss),
      heapUsed: Math.max(sample.heapUsed, memory.heapUsed),
    };
  }
  console.log(JSON.stringify({
    source: m.slug,
    name,
    directoryBytes: bytes(input.html),
    policyBytes: bytes(input.policy),
    detailBytes: bytes(input.detail),
    totalDecodedBytes: bytes(input.html) + bytes(input.policy) + bytes(input.detail),
    envelopeBytes: bytes(page.payload),
    records,
    accepted,
    iterations: 30,
    parseMaxMs: Math.max(...parse),
    mappingMaxMs: Math.max(...mapping),
    fullMaxMs: Math.max(...total),
    fullMeanMs: total.reduce((a, b) => a + b, 0) / total.length,
    rssBefore: before.rss,
    rssObservedMax: memory.rss,
    heapBefore: before.heapUsed,
    heapObservedMax: memory.heapUsed,
    maxRequestsPerTask: 3,
    maxDetailRequests: 1,
    maxPages: 1,
    measurement:
      "Decoded UTF-8 bytes; no compression assumption; local sampled process memory, not a hosted peak",
  }));
}
