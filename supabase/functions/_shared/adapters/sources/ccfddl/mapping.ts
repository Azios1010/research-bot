import type { DeadlineDraft, ObjectValue, OpportunityDraft } from "../../../domain/model.ts";
import { dateOnly, normalizeTime } from "../../../domain/temporal.ts";
import { ProcessingError } from "../../../application/ports.ts";
import type { ConferenceManifest } from "./manifest.ts";

export const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
function text(value: unknown, max = 1024): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ProcessingError("malformed_record");
  }
  return value;
}
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function eventDates(value: string): [string | null, string | null] {
  const match = /^([A-Za-z]+) (\d{1,2})(?:[-–](\d{1,2}))?, (\d{4})$/.exec(value);
  if (!match) return [null, null];
  const month = months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  try {
    if (!month) return [null, null];
    const first = dateOnly(
      `${match[4]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`,
    );
    const last = dateOnly(
      `${match[4]}-${String(month).padStart(2, "0")}-${(match[3] ?? match[2]).padStart(2, "0")}`,
    );
    return last >= first ? [first, last] : [null, null];
  } catch {
    return [null, null];
  }
}
export function clockEvidence(
  raw: string,
  zone: string,
): Pick<DeadlineDraft, "value" | "timezone" | "basis" | "aoeSupported"> {
  let value = raw;
  let basis: DeadlineDraft["basis"] = "source_default";
  if (/^\d{4}-\d{2}-\d{2} 23:59:59$/.test(raw)) value = raw.slice(0, 10);
  else if (/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) basis = "explicit";
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const offset = /^UTC([+-])(\d{1,2})$/.exec(zone);
    if (zone === "UTC") value = `${raw.replace(" ", "T")}Z`;
    else if (offset && +offset[2] <= 14) {
      value = `${raw.replace(" ", "T")}${offset[1]}${offset[2].padStart(2, "0")}:00`;
    } else if (zone === "PT") {
      const resolved = normalizeTime({ value: raw, timezone: "America/Los_Angeles", basis });
      if (resolved.dueAt) {
        const difference = (Date.parse(`${raw.replace(" ", "T")}Z`) - Date.parse(resolved.dueAt)) /
          3600000;
        value = `${raw.replace(" ", "T")}${difference < 0 ? "-" : "+"}${
          String(Math.abs(difference)).padStart(2, "0")
        }:00`;
      }
    }
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) && !/^(TBD|unknown|rolling)$/i.test(raw)) {
    throw new ProcessingError("malformed_deadline");
  }
  return { value, timezone: zone, basis, aoeSupported: zone === "AoE" };
}
function roundKey(comment: unknown, count: number): string | null {
  if (comment == null) return count === 1 ? "main" : null;
  const label = text(comment, 200).trim().toLowerCase();
  const ordinals = ["first", "second", "third", "fourth", "fifth"];
  const match = /^(?:round (\d{1,2})|(first|second|third|fourth|fifth) round)$/.exec(label);
  if (match) return `round-${match[1] ?? ordinals.indexOf(match[2]) + 1}`;
  return count === 1 ? "main" : null;
}
const countryNames: Record<string, string> = {
  USA: "US",
  China: "CN",
  Chile: "CL",
  Germany: "DE",
  India: "IN",
  Canada: "CA",
};
export function mapEdition(
  series: Record<string, unknown>,
  edition: Record<string, unknown>,
  manifest: ConferenceManifest,
): OpportunityDraft {
  if (
    !Number.isInteger(edition.year) || Number(edition.year) < 2000 || Number(edition.year) > 2100
  ) throw new ProcessingError("malformed_record");
  const id = text(edition.id, 120);
  if (!/^[a-z0-9'-]+$/.test(id)) throw new ProcessingError("malformed_record");
  const link = text(edition.link), place = text(edition.place), date = text(edition.date);
  const zone = edition.timezone == null ? "AoE" : text(edition.timezone, 120);
  const timeline = edition.timeline;
  if (!Array.isArray(timeline) || timeline.length > manifest.maxRounds) {
    throw new ProcessingError("record_shape_changed");
  }
  const deadlines: DeadlineDraft[] = [], rawTimeline: ObjectValue[] = [];
  for (const entry of timeline) {
    if (!object(entry) || !("deadline" in entry)) throw new ProcessingError("record_shape_changed");
    if (
      Object.keys(entry).some((k) =>
        (k.endsWith("deadline") || k.endsWith("_deadline")) &&
        !["deadline", "abstract_deadline", "rebuttal_deadline", "decision_deadline"].includes(k)
      )
    ) throw new ProcessingError("record_shape_changed");
    const round = roundKey(entry.comment, timeline.length);
    const raw: ObjectValue = {};
    for (
      const [field, kind] of [["abstract_deadline", "abstract"], ["deadline", "submission"], [
        "rebuttal_deadline",
        "rebuttal",
      ], ["decision_deadline", "decision"]] as const
    ) {
      if (entry[field] == null) continue;
      const value = text(entry[field], 100);
      raw[field] = value;
      deadlines.push({
        kind,
        roundKey: round,
        label: `${kind} ${round ?? "unlabeled round"}`,
        ...clockEvidence(value, zone),
      });
    }
    if (entry.comment != null) raw.comment = text(entry.comment, 200);
    rawTimeline.push(raw);
  }
  const [eventStart, eventEnd] = eventDates(date);
  const countries = Object.entries(countryNames).filter(([name]) =>
    new RegExp(`\\b${name}\\b`).test(place)
  ).map(([, code]) => code);
  const url = new URL(link);
  const reviewed = manifest.reviewedListings.find((listing) =>
    listing.id === id && listing.canonicalUrl === link
  );
  return {
    type: manifest.type,
    title: `${series.title} ${edition.year}`,
    description: text(series.description, 2048),
    organization: null,
    publishedAt: null,
    canonicalUrl: link,
    topics: [text(series.sub, 20)],
    countryCodes: countries,
    locationText: place,
    workMode: /\b(?:Online|Virtual)\b/i.test(place)
      ? (/\/|local event/i.test(place) ? "hybrid" : "remote")
      : "unknown",
    cycleKey: String(edition.year),
    trackKey: "main",
    eventStart,
    eventEnd,
    status: "unknown",
    attributes: {
      ccfddl: {
        series: text(series.title, 80),
        edition_id: id,
        category: text(series.sub, 20),
        event_date_text: date,
        timezone_token: zone,
        timeline: rawTimeline,
        clock_policy: "conservative-end-of-day-v1",
      },
    },
    deadlines,
    identities: reviewed &&
        (url.hostname === manifest.officialHost ||
          url.hostname.endsWith(`.${manifest.officialHost}`))
      ? [{
        kind: "listing_url",
        value: reviewed.identityUrl,
        reviewed: true,
        listingSpecific: true,
      }]
      : [],
  };
}
