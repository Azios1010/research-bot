import { CcfddlAdapter } from "../../supabase/functions/_shared/adapters/sources/ccfddl/adapter.ts";
import {
  ccfddlManifest,
  hotosManifest,
} from "../../supabase/functions/_shared/adapters/sources/ccfddl/manifest.ts";
import { OpenreviewCallAdapter } from "../../supabase/functions/_shared/adapters/sources/openreview/adapter.ts";
import { openreviewManifest } from "../../supabase/functions/_shared/adapters/sources/openreview/manifest.ts";
import { safeYaml } from "../../supabase/functions/_shared/adapters/sources/ccfddl/yaml.ts";
import { mapEdition } from "../../supabase/functions/_shared/adapters/sources/ccfddl/mapping.ts";
import { normalize } from "../../supabase/functions/_shared/domain/normalize.ts";
import { bytes } from "../../supabase/functions/_shared/domain/primitives.ts";
import { reconcile } from "../../supabase/functions/_shared/domain/reconcile.ts";

// Local measurements only; hosted Edge CPU/RSS evidence remains a Phase 10 gate.
for (
  const [file, series] of [["sigmod.yml", "SIGMOD"], ["vldb-upper-bound.yml", "VLDB"], [
    "hotos.yml",
    "HotOS",
  ]]
) {
  const payload = await Deno.readTextFile(`tests/fixtures/ccfddl/${file}`),
    before = Deno.memoryUsage();
  const manifest = series === "HotOS" ? hotosManifest : { ...ccfddlManifest, series },
    adapter = new CcfddlAdapter(manifest);
  const parse: number[] = [], mapping: number[] = [];
  let recordCount = 0, deadlines = 0, maxSnapshotBytes = 0, maxProposalBytes = 0;
  for (let iteration = 0; iteration < 50; iteration++) {
    const start = performance.now();
    const rows = safeYaml(payload, manifest.maxBytes) as Record<string, unknown>[];
    parse.push(performance.now() - start);
    const mapStart = performance.now();
    const mapped = (rows[0].confs as Record<string, unknown>[]).map((e) =>
      mapEdition(rows[0], e, manifest)
    );
    mapping.push(performance.now() - mapStart);
    recordCount = mapped.length;
    if (iteration === 0) {
      for (const draft of mapped) {
        const normalized = await normalize(draft);
        deadlines += normalized.deadlines.length;
        const snapshot = {
          schema_version: 1,
          fields: normalized.fields,
          deadlines: normalized.deadlines,
          deadline_evidence: draft.deadlines,
        };
        maxSnapshotBytes = Math.max(maxSnapshotBytes, bytes(JSON.stringify(snapshot)));
        const resolved = await reconcile(normalized, {
          recordKey: "benchmark",
          observationId: null,
          observationOpportunityId: null,
          strongIds: [],
          candidates: [],
          truncated: false,
        }, {
          sourceId: "00000000-0000-4000-8000-000000000001",
          sourceSlug: manifest.slug,
          sourceRecordKey: `ccfddl-v1:DB:${series}:${draft.cycleKey}:main`,
          parserVersion: adapter.parserVersion,
          observedAt: "2026-10-29T09:00:00.000Z",
          authority: 0,
        });
        maxProposalBytes = Math.max(
          maxProposalBytes,
          bytes(JSON.stringify({
            snapshot,
            canonical: resolved.canonical,
            provenance: resolved.provenance,
            metadata: { source_revision: "a".repeat(64) },
            sourceUrl: manifest.endpoint,
            recordKey: "benchmark",
            payloadHash: "a".repeat(64),
            disposition: "accepted",
          })),
        );
      }
    }
  }
  const parsed = [
    ...adapter.parsePage({
      payload,
      sourceUrl: manifest.endpoint,
      fetchedAt: "2026-10-29T00:00:00Z",
      sourceRevision: null,
      validators: {},
      format: "yaml",
      notModified: false,
      nextCursor: null,
    }),
  ];
  if (parsed.some((r) => r.kind === "error") || recordCount > manifest.maxRecords) {
    throw new Error("benchmark mapping failed");
  }
  const after = Deno.memoryUsage();
  console.log(JSON.stringify({
    file,
    payloadBytes: bytes(payload),
    decodedUtf8Bytes: bytes(payload),
    compression: "none in fixture",
    records: recordCount,
    canonicalDeadlines: deadlines,
    maxSnapshotBytes,
    maxProposalBytes,
    parseMaxMs: Math.max(...parse),
    parseMeanMs: parse.reduce((a, b) => a + b, 0) / parse.length,
    mappingMaxMs: Math.max(...mapping),
    rssBefore: before.rss,
    rssAfter: after.rss,
    heapUsedBefore: before.heapUsed,
    heapUsedAfter: after.heapUsed,
    workUnit: "one approved series file, one request, one page; VLDB benchmark only",
  }));
}

const publicMetadata = JSON.parse(
  await Deno.readTextFile("tests/fixtures/openreview/invitation.json"),
);
// Omitted public workflow fields are represented by explicit synthetic padding, never personal data.
// Actual full-response parser timings are separately captured by opted-in live smoke.
for (const size of [4850, openreviewManifest.maxBytes]) {
  const base = { ...publicMetadata, benchmark_padding: "" };
  base.benchmark_padding = "x".repeat(size - bytes(JSON.stringify(base)));
  const payload = JSON.stringify(base),
    adapter = new OpenreviewCallAdapter(),
    samples: number[] = [];
  const before = Deno.memoryUsage();
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    const records = [
      ...adapter.parsePage({
        payload,
        format: "json",
        sourceUrl: openreviewManifest.endpoint,
        fetchedAt: "2026-10-29T00:00:00Z",
        sourceRevision: null,
        validators: {},
        nextCursor: null,
        notModified: false,
      }),
    ];
    if (records.length !== 1 || records[0].kind !== "record") {
      throw new Error("invitation benchmark failed");
    }
    await normalize(records[0].draft);
    samples.push(performance.now() - start);
  }
  const after = Deno.memoryUsage();
  console.log(JSON.stringify({
    source: openreviewManifest.slug,
    payloadBytes: bytes(payload),
    decodedUtf8Bytes: bytes(payload),
    syntheticPadding: true,
    records: 1,
    parseMappingNormalizationMaxMs: Math.max(...samples),
    parseMappingNormalizationMeanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    rssBefore: before.rss,
    rssAfter: after.rss,
    heapUsedBefore: before.heapUsed,
    heapUsedAfter: after.heapUsed,
    workUnit: "one scoped public invitation, one request, one page",
  }));
}
