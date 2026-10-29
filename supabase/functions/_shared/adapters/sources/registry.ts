import type { SourceAdapter } from "../../application/ports.ts";
import { CcfddlAdapter } from "./ccfddl/adapter.ts";
import { ccfddlManifest, hotosManifest } from "./ccfddl/manifest.ts";
import { OpenreviewCallAdapter } from "./openreview/adapter.ts";
import { openreviewManifest } from "./openreview/manifest.ts";
import { BathAdapter } from "./bath/adapter.ts";
import { bathManifest } from "./bath/manifest.ts";
import { CernAdapter } from "./cern/adapter.ts";
import { cernManifest } from "./cern/manifest.ts";
import { GrantsAdapter } from "./grantsgov/adapter.ts";
import { grantsManifest } from "./grantsgov/manifest.ts";

export const approvedEndpoints = [
  ccfddlManifest.endpoint,
  hotosManifest.endpoint,
  openreviewManifest.endpoint,
  bathManifest.endpoint,
  ...cernManifest.feeds,
  cernManifest.internshipUrl,
  grantsManifest.search,
  grantsManifest.detail,
] as const;
export const approvedReadPostEndpoints = [grantsManifest.search, grantsManifest.detail] as const;
export function approvedSources(): ReadonlyMap<string, SourceAdapter> {
  const adapters: SourceAdapter[] = [
    new CcfddlAdapter(),
    new CcfddlAdapter(hotosManifest),
    new OpenreviewCallAdapter(),
    new BathAdapter(),
    new CernAdapter(),
    new GrantsAdapter(),
  ];
  return new Map(adapters.map((a) => [a.slug, a]));
}
