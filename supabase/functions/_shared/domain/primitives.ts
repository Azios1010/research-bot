import { DomainError, type Value } from "./model.ts";

export const bytes = (s: string): number => new TextEncoder().encode(s).byteLength;
export function text(value: string, limit = 1024): string {
  // deno-lint-ignore no-control-regex -- reject hostile controls, allow text whitespace.
  if (typeof value !== "string" || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) {
    throw new DomainError("invalid_text");
  }
  const result = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (result.length > limit) throw new DomainError("text_too_long");
  return result;
}
export const key = (value: string): string => text(value.normalize("NFKC").toLowerCase());
export const nullableText = (value: string | null | undefined, limit = 1024): string | null =>
  value == null ? null : text(value, limit) || null;
export const ordered = (values: string[]): string[] => [...new Set(values)].sort();
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function stable(value: Value): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DomainError("invalid_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${
    Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")
  }}`;
}
export async function digest(value: Value): Promise<string> {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(data)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function boundedObject(
  value: unknown,
  limit = 16384,
): asserts value is { [key: string]: Value } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("invalid_object");
  }
  const visit = (v: unknown, depth: number): void => {
    if (depth > 8) throw new DomainError("object_too_deep");
    if (
      v === null || typeof v === "string" || typeof v === "boolean" ||
      typeof v === "number" && Number.isFinite(v)
    ) return;
    if (!v || typeof v !== "object") throw new DomainError("invalid_json_value");
    if (Object.keys(v).length > 200) throw new DomainError("object_too_large");
    for (const child of Object.values(v)) visit(child, depth + 1);
  };
  visit(value, 0);
  if (bytes(stable(value as Value)) > limit) throw new DomainError("object_too_large");
}
export function safeUrl(raw: string): string {
  // deno-lint-ignore no-control-regex -- URLs must not contain controls or backslashes.
  if (typeof raw !== "string" || raw.length > 4096 || /[\s\u0000-\u001F\\]/u.test(raw)) {
    throw new DomainError("unsafe_url");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError("unsafe_url");
  }
  const host = url.hostname.toLowerCase();
  if (
    !["https:", "http:"].includes(url.protocol) || url.username || url.password ||
    !host.includes(".") || host.includes(":") || /^\[|^\d+(?:\.\d+)*$/u.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|test|home|lan)$/u.test(host) || host.endsWith(".")
  ) throw new DomainError("unsafe_url");
  url.hash = "";
  for (const param of [...url.searchParams.keys()]) {
    if (
      /^utm_/i.test(param) ||
      ["fbclid", "gclid", "msclkid", "mc_cid", "mc_eid"].includes(param.toLowerCase())
    ) url.searchParams.delete(param);
  }
  return url.href;
}

// ISO 3166-1 alpha-2 codes; country names/aliases require adapter evidence.
const countries = new Set(
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW")
    .split(" "),
);
export function countryCodes(values: string[]): string[] {
  if (!Array.isArray(values) || values.length > 50) throw new DomainError("invalid_countries");
  const result = values.map((v) => text(v).toUpperCase());
  if (result.some((v) => !countries.has(v))) throw new DomainError("invalid_country_code");
  return ordered(result);
}
export function tags(values: string[] = []): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new DomainError("invalid_tags");
  return ordered(values.map((v) => key(text(v, 160))).filter(Boolean));
}
