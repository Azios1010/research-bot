import { rssItems as parse } from "../shared/rss.ts";
import { bathManifest } from "./manifest.ts";
export { object, plain } from "../shared/rss.ts";
export const rssItems = (payload: string): unknown[] =>
  parse(payload, {
    maxBytes: bathManifest.maxBytes,
    maxRecords: bathManifest.maxRecords,
    titleContains: "Bath",
  });
