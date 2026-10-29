import { CcfddlAdapter } from "../supabase/functions/_shared/adapters/sources/ccfddl/adapter.ts";
import { ccfddlManifest } from "../supabase/functions/_shared/adapters/sources/ccfddl/manifest.ts";
import { safeYaml } from "../supabase/functions/_shared/adapters/sources/ccfddl/yaml.ts";
import {
  type CollectContext,
  type CollectedPage,
  collectionLimits,
  type HttpResponse,
} from "../supabase/functions/_shared/application/ports.ts";
import type { ParsedRecord } from "../supabase/functions/_shared/domain/model.ts";
import { assert } from "./support.ts";

export const adapter = new CcfddlAdapter();
export const fixture = (name = "sigmod.yml") =>
  Deno.readTextFile(new URL(`fixtures/ccfddl/${name}`, import.meta.url));
export const page = (payload: string): CollectedPage => ({
  payload,
  format: "yaml",
  sourceUrl: ccfddlManifest.endpoint,
  fetchedAt: "2026-10-29T09:00:00Z",
  sourceRevision: "a".repeat(64),
  nextCursor: null,
  validators: {},
  notModified: false,
});
export function records(payload: string): ParsedRecord[] {
  return [...adapter.parsePage(page(payload))].map((record) => {
    assert(record.kind === "record");
    return record;
  });
}
export async function document(): Promise<Record<string, unknown>[]> {
  return safeYaml(await fixture(), ccfddlManifest.maxBytes) as Record<string, unknown>[];
}
export const context = (response: HttpResponse): CollectContext => ({
  source: {
    id: "source",
    slug: adapter.slug,
    enabled: true,
    approved: true,
    parserVersion: adapter.parserVersion,
    configVersion: 1,
    config: {},
  },
  http: { request: () => Promise.resolve(response) },
  clock: { now: () => "2026-10-29T09:00:00Z" },
  signal: new AbortController().signal,
  limits: collectionLimits,
});
export const response = (body: string, status = 200): HttpResponse => ({
  status,
  body,
  contentType: "text/plain; charset=utf-8",
  headers: { etag: '"fixture"' },
});
