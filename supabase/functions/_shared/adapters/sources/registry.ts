import type { SourceAdapter } from "../../application/ports.ts";
import { CcfddlAdapter } from "./ccfddl/adapter.ts";
import { ccfddlManifest, hotosManifest } from "./ccfddl/manifest.ts";
import { OpenreviewCallAdapter } from "./openreview/adapter.ts";
import { openreviewManifest } from "./openreview/manifest.ts";

export const approvedEndpoints = [
  ccfddlManifest.endpoint,
  hotosManifest.endpoint,
  openreviewManifest.endpoint,
] as const;
export function approvedSources(): ReadonlyMap<string, SourceAdapter> {
  const adapters: SourceAdapter[] = [
    new CcfddlAdapter(),
    new CcfddlAdapter(hotosManifest),
    new OpenreviewCallAdapter(),
  ];
  return new Map(adapters.map((a) => [a.slug, a]));
}
