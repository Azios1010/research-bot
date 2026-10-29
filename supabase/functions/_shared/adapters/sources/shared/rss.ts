import { XMLParser, XMLValidator } from "fast-xml-parser";
import { decodeHTMLStrict } from "entities";
import { ProcessingError } from "../../../application/ports.ts";
import { bytes } from "../../../domain/primitives.ts";
import { dateOnly, instant } from "../../../domain/temporal.ts";

// Linear lexical preflight BEFORE the tree parser: CDATA/comments/PI are skipped, never fetched.
function preflight(input: string) {
  let cursor = 0, depth = 0, nodes = 0;
  while ((cursor = input.indexOf("<", cursor)) !== -1) {
    const start = cursor;
    let end: string | null = null;
    if (input.startsWith("<![CDATA[", cursor)) end = "]]>";
    else if (input.startsWith("<!--", cursor)) end = "-->";
    else if (input.startsWith("<?", cursor)) end = "?>";
    else if (input.startsWith("<!", cursor)) throw new ProcessingError("xml_unsafe_declaration");
    if (end) {
      const finish = input.indexOf(end, cursor + 2);
      if (finish < 0) throw new ProcessingError("document_parse_failed");
      cursor = finish + end.length;
      continue;
    }
    let quote: string | null = null;
    for (cursor++; cursor < input.length; cursor++) {
      const c = input[cursor];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      if (cursor - start > 2048) throw new ProcessingError("xml_tag_limit");
    }
    if (cursor >= input.length) throw new ProcessingError("document_parse_failed");
    const tag = input.slice(start, cursor + 1);
    if (tag.startsWith("</")) depth--;
    else {
      if (++nodes > 4096) throw new ProcessingError("xml_node_limit");
      if (!tag.endsWith("/>")) depth++;
    }
    if (depth < 0 || depth > 20) throw new ProcessingError("xml_depth_limit");
    cursor++;
  }
  if (depth !== 0) throw new ProcessingError("document_parse_failed");
}
export const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function rssItems(
  payload: string,
  options: { maxBytes: number; maxRecords: number; titleContains: string },
): unknown[] {
  if (bytes(payload) > options.maxBytes) throw new ProcessingError("response_too_large");
  preflight(payload);
  if (XMLValidator.validate(payload) !== true) throw new ProcessingError("document_parse_failed");
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: false,
      trimValues: false,
      ignoreDeclaration: true,
      ignorePiTags: true,
      isArray: (_name, path) => path === "rss.channel.item",
    }).parse(payload);
  } catch {
    throw new ProcessingError("document_parse_failed");
  }
  if (
    !object(parsed) || !object(parsed.rss) || parsed.rss["@_version"] !== "2.0" ||
    !object(parsed.rss.channel)
  ) throw new ProcessingError("document_shape_changed");
  const channel = parsed.rss.channel;
  if (
    typeof channel.title !== "string" ||
    !decodeHTMLStrict(channel.title).includes(options.titleContains)
  ) {
    throw new ProcessingError("document_shape_changed");
  }
  const items = channel.item ?? [];
  if (!Array.isArray(items) || items.length > options.maxRecords) {
    throw new ProcessingError("page_record_limit");
  }
  return items;
}
export function rssDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ProcessingError("malformed_publication_date");
  const m = /^\w{3}, (\d{1,2}) (\w{3}) (\d{4}) (\d{2}:\d{2}:\d{2}) (GMT|[+-]\d{4})$/.exec(value);
  if (!m) throw new ProcessingError("malformed_publication_date");
  const month =
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      m[2].toLowerCase(),
    ) + 1;
  const date = dateOnly(`${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`),
    offset = m[5] === "GMT" ? "Z" : `${m[5].slice(0, 3)}:${m[5].slice(3)}`;
  return instant(`${date}T${m[4]}${offset}`);
}
// No HTML execution or navigation. Canonical fields are small factual projections, never this body.
export function plain(value: unknown, max = 65536): string {
  if (typeof value !== "string" || bytes(value) > max) {
    throw new ProcessingError("malformed_record");
  }
  return decodeHTMLStrict(
    value.replace(/<!--[\s\S]*?-->/g, " ").replace(
      /<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " ",
    ).replace(/<\/?(?:p|div|br|li|h[1-6]|tr)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " "),
  ).normalize("NFC").replace(/[^\S\n]+/g, " ").trim();
}
