import {
  type Deadline,
  type DeadlineDraft,
  DomainError,
  type QualityFlag,
  type TemporalEvidence,
} from "./model.ts";
import { key, text } from "./primitives.ts";

const day = 86400000;
export function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("invalid_date");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError("invalid_date");
  }
  return value;
}
export function instant(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/i
    .exec(value);
  if (!match) throw new DomainError("instant_needs_offset");
  dateOnly(match[1]);
  if (+match[2] > 23 || +match[3] > 59 || +(match[4] ?? 0) > 59) {
    throw new DomainError("invalid_time");
  }
  if (
    match[6].toUpperCase() !== "Z" &&
    (+match[6].slice(1, 3) > 14 || +match[6].slice(4) > 59 ||
      (+match[6].slice(1, 3) === 14 && +match[6].slice(4) !== 0))
  ) throw new DomainError("invalid_offset");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new DomainError("invalid_time");
  const remainder = (match[5]?.slice(1) ?? "").padEnd(3, "0").slice(3);
  return parsed.toISOString().replace("Z", remainder ? `${remainder}Z` : "Z");
}
const formats = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  if (!formats.has(zone)) {
    if (formats.size >= 32) formats.delete(formats.keys().next().value!);
    formats.set(
      zone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  }
  return formats.get(zone)!;
}
export function localDate(now: string, zone: string): string {
  const p = Object.fromEntries(
    formatter(zone).formatToParts(new Date(now)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function validZone(zone: string): boolean {
  try {
    formatter(zone).format(new Date(0));
    return zone === "UTC" || zone.includes("/");
  } catch {
    return false;
  }
}
export function calendarEnd(date: string): number {
  return Date.parse(`${dateOnly(date)}T00:00:00Z`) + day + 12 * 3600000;
}
function localInstant(value: string, zone: string): string | null {
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!local) return null;
  const base = Date.parse(instant(`${value}Z`));
  const target = `${local[1]}T${local[2]}:${local[3]}:${local[4] ?? "00"}`;
  const offsets = new Set<number>();
  const formatLocal = (ms: number) => {
    const p = Object.fromEntries(
      formatter(zone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  };
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = base + hours * 3600000;
    offsets.add(Date.parse(`${formatLocal(sample)}Z`) - sample);
  }
  const matches = [...offsets].map((offset) => base - offset).filter((ms) =>
    formatLocal(ms) === target
  );
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}
export function normalizeTime(evidence: TemporalEvidence): {
  dueAt: string | null;
  dueDate: string | null;
  timezone: string | null;
  precision: Deadline["precision"];
  basis: Deadline["basis"];
  flags: QualityFlag[];
} {
  const raw = evidence.value == null
    ? ""
    : text(evidence.value, 2048).replace(/^(\d{4}-\d{2}-\d{2}) (?=\d{2}:\d{2})/, "$1T");
  const zone = evidence.timezone == null ? null : text(evidence.timezone, 120) || null;
  const basis = evidence.basis ?? "explicit";
  const unknown = (flag?: QualityFlag) => ({
    dueAt: null,
    dueDate: null,
    timezone: zone,
    precision: "unknown" as const,
    basis: "unknown" as const,
    flags: flag ? [flag] : [],
  });
  if (!raw || ["tbd", "rolling", "unknown", "ongoing", "until filled"].includes(key(raw))) {
    return unknown();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return {
      dueAt: null,
      dueDate: dateOnly(raw),
      timezone: zone,
      precision: "date",
      basis,
      flags: zone ? [] : ["unknown_timezone"],
    };
  }
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    return {
      dueAt: instant(raw),
      dueDate: raw.slice(0, 10),
      timezone: zone ?? raw.match(/(Z|[+-]\d{2}:\d{2})$/i)![0],
      precision: "instant",
      basis: basis === "unknown" ? "explicit" : basis,
      flags: [],
    };
  }
  if (zone && basis === "unknown") return unknown("unknown_timezone");
  if (zone === "AoE" && evidence.aoeSupported) {
    return {
      dueAt: instant(`${raw}-12:00`),
      dueDate: raw.slice(0, 10),
      timezone: "AoE",
      precision: "instant",
      basis,
      flags: [],
    };
  }
  if (!zone || !validZone(zone)) return unknown("unknown_timezone");
  const resolved = localInstant(raw, zone);
  return resolved
    ? {
      dueAt: resolved,
      dueDate: raw.slice(0, 10),
      timezone: zone,
      precision: "instant",
      basis,
      flags: [],
    }
    : unknown("ambiguous_time");
}
export function normalizeDeadline(
  draft: DeadlineDraft,
): { deadline: Deadline; flags: QualityFlag[] } {
  const result = normalizeTime(draft);
  const { flags, ...normalized } = result;
  return {
    deadline: {
      ...normalized,
      kind: draft.kind,
      roundKey: key(draft.roundKey!),
      label: text(draft.label, 1024),
      rawValue: draft.value,
      status: flags.includes("ambiguous_time") ? "conflicted" : "current",
    },
    flags,
  };
}
