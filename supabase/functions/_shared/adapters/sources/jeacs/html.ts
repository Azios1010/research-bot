import { type DefaultTreeAdapterMap, parse } from "parse5";
import { ProcessingError } from "../../../application/ports.ts";
import { bytes, safeUrl } from "../../../domain/primitives.ts";
import { jeacsManifest as m } from "./manifest.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const element = (n: Node): n is Element => "tagName" in n;
const children = (n: Node): Node[] => "childNodes" in n ? n.childNodes : [];
export function tree(input: string, maximum: number): Node {
  if (typeof input !== "string" || bytes(input) > maximum) {
    throw new ProcessingError("response_too_large");
  }
  // Bound token work BEFORE HTML tree allocation; parse5 never executes/fetches scripts or DTDs.
  if ([...input.matchAll(/<[A-Za-z!/]/g)].length > m.maxTags) {
    throw new ProcessingError("html_token_limit");
  }
  if (/<!ENTITY\b/i.test(input)) throw new ProcessingError("html_unsafe_declaration");
  const root = parse(input, { scriptingEnabled: false });
  const pending: [Node, number][] = [[root, 0]];
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop()!;
    if (++count > m.maxNodes || depth > m.maxDepth) {
      throw new ProcessingError("html_structure_limit");
    }
    for (const child of children(node)) pending.push([child, depth + 1]);
  }
  return root;
}
export const attr = (n: Element, key: string) => n.attrs.find((a) => a.name === key)?.value ?? null;
export const hasClass = (n: Element, name: string) =>
  (attr(n, "class") ?? "").split(/\s+/).includes(name);
export function all(root: Node, predicate: (n: Element) => boolean): Element[] {
  const result: Element[] = [], pending = [root];
  while (pending.length) {
    const n = pending.pop()!;
    if (element(n) && predicate(n)) result.push(n);
    pending.push(...children(n).toReversed());
  }
  return result;
}
const ignored = new Set(["script", "style", "template", "iframe", "object", "svg", "noscript"]);
const blocks = new Set(["p", "div", "li", "br", "h1", "h2", "h3", "h4", "ul", "ol", "tr"]);
export function content(root: Node, maximum = 24576): string {
  const visit = (n: Node): string => {
    if (
      element(n) &&
      (ignored.has(n.tagName) || hasClass(n, "read_more") || hasClass(n, "pkp_screen_reader"))
    ) return "";
    if (n.nodeName === "#text" && "value" in n) return n.value;
    const value = children(n).map(visit).join("");
    return element(n) && blocks.has(n.tagName) ? `\n${value}\n` : value;
  };
  const value = visit(root).normalize("NFC").replace(/[^\S\n]+/g, " ").replace(/\n\s*\n+/g, "\n")
    .trim();
  if (bytes(value) > maximum) throw new ProcessingError("record_too_large");
  return value;
}
export function callId(raw: string, base: string = m.endpoint): string {
  const safe = safeUrl(new URL(raw, base).href), u = new URL(safe);
  const id = /^\/index.php\/jeacs\/announcement\/view\/(\d{1,9})$/.exec(u.pathname)?.[1];
  if (u.origin !== "https://journals.univie.ac.at" || u.search || !id) {
    throw new ProcessingError("source_url_unreviewed");
  }
  return id;
}
export interface Card {
  id: string | null;
  heading: string;
  body: string;
  paragraphs: string[];
  lists: string[];
  publicationDate: string | null;
  malformed: boolean;
}
function card(node: Element, detailId: string | null): Card {
  try {
    const heading = all(node, (n) => ["h1", "h2"].includes(n.tagName))[0];
    if (!heading) throw new ProcessingError("malformed_record");
    const anchor = all(heading, (n) => n.tagName === "a")[0],
      id = detailId ?? (anchor ? callId(attr(anchor, "href") ?? "") : null),
      summary = all(node, (n) => hasClass(n, "summary") || hasClass(n, "description"))[0];
    if (!id || !summary) throw new ProcessingError("malformed_record");
    const date = all(node, (n) => hasClass(n, "date"))[0];
    const body = content(summary, m.maxCardBytes), title = content(heading, 1024);
    return {
      id,
      heading: title,
      body,
      paragraphs: all(summary, (n) => n.tagName === "p").map((n) => content(n)),
      // Only an explicitly introduced TOPIC list is taxonomy. Submission guidelines,
      // review instructions and contact bullets are not topics, even when short.
      lists: all(summary, (n) => n.tagName === "ul" || n.tagName === "ol").filter((list) => {
        const siblings = list.parentNode ? children(list.parentNode) : [];
        const previous = siblings.slice(0, siblings.indexOf(list)).toReversed().find(element);
        return previous &&
          /^(?:(?:possible|suggested) )?topics(?: include|:| covered)/i.test(content(previous));
      }).flatMap((list) => all(list, (n) => n.tagName === "li").map((n) => content(n))),
      publicationDate: date
        ? /\b20\d{2}-\d{2}-\d{2}\b/.exec(content(date, 100))?.[0] ?? null
        : null,
      malformed: !title,
    };
  } catch {
    let id = detailId;
    if (!id) {
      try {
        const a = all(node, (n) => n.tagName === "a")[0];
        if (a) id = callId(attr(a, "href") ?? "");
      } catch { /* Rejection key only. */ }
    }
    return {
      id,
      heading: "",
      body: "",
      paragraphs: [],
      lists: [],
      publicationDate: null,
      malformed: true,
    };
  }
}
export function cards(html: string, documentUrl: string = m.endpoint): Card[] {
  const root = tree(html, m.maxDirectoryBytes),
    directory = all(root, (n) => hasClass(n, "page_announcements"));
  if (documentUrl === m.endpoint) {
    if (directory.length !== 1) throw new ProcessingError("document_shape_changed");
    const nodes = all(directory[0], (n) => hasClass(n, "obj_announcement_summary"));
    if (nodes.length > m.maxRecords) throw new ProcessingError("page_record_limit");
    if (!nodes.length && !/No announcements/i.test(content(directory[0], m.maxDirectoryBytes))) {
      throw new ProcessingError("document_shape_changed");
    }
    return nodes.map((n) => card(n, null));
  }
  const id = callId(documentUrl), full = all(root, (n) => hasClass(n, "obj_announcement_full"));
  if (full.length !== 1) throw new ProcessingError("document_shape_changed");
  return [card(full[0], id)];
}
export interface JournalContext {
  name: string;
  publisher: string;
  issn: string | null;
  url: string;
  fee: { amount: number; currency: string | null; conditions: string; evidence_url: string } | null;
}
export function feeEvidence(body: string, evidenceUrl: string): JournalContext["fee"] {
  const free = /does not charge submission or publication fees/i.test(body),
    charged =
      /(?:Article processing charge|APC):\s*(EUR|USD|GBP|CHF)\s*(\d+(?:\.\d{1,2})?)([^\n]{0,160})/i
        .exec(body);
  if (free && charged) throw new ProcessingError("conflicting_fee_evidence");
  return free
    ? {
      amount: 0,
      currency: null,
      conditions: "No submission or publication fees",
      evidence_url: evidenceUrl,
    }
    : charged
    ? {
      amount: Number(charged[2]),
      currency: charged[1].toUpperCase(),
      conditions: charged[3].trim(),
      evidence_url: evidenceUrl,
    }
    : null;
}
export function journalContext(html: string): JournalContext {
  const root = tree(html, m.maxPolicyBytes), body = content(root, m.maxPolicyBytes);
  if (!body.includes(m.journalName) || !body.includes(m.publisher)) {
    throw new ProcessingError("policy_shape_changed");
  }
  const token = /\bISSN:\s*([^\s]+)/i.exec(body)?.[1] ?? null;
  if (token && !/^\d{4}-\d{3}[\dX]$/i.test(token)) {
    throw new ProcessingError("invalid_journal_issn");
  }
  return {
    name: m.journalName,
    publisher: m.publisher,
    issn: token,
    url: m.journalUrl,
    fee: feeEvidence(body, m.policyUrl),
  };
}
