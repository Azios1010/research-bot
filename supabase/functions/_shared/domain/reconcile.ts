import {
  type CandidateSet,
  type Deadline,
  type NormalizedOpportunity,
  type Opportunity,
  type Origin,
  type Provenance,
  type QualityFlag,
  type Value,
} from "./model.ts";
import { compare, digest, ordered, stable } from "./primitives.ts";
import { identityComponents } from "./identity.ts";

export interface Reconciliation {
  canonical: NormalizedOpportunity;
  provenance: Provenance;
  targetId?: string;
  expectedRevision?: number;
  expectedEvidenceVersion?: string;
  candidateIds: string[];
  anticipatedConflict: boolean;
}
export function originWins(next: Origin, old: Origin | undefined): boolean {
  if (!old) return true;
  return next.authority !== old.authority
    ? next.authority > old.authority
    : Date.parse(next.observedAt) !== Date.parse(old.observedAt)
    ? Date.parse(next.observedAt) > Date.parse(old.observedAt)
    : compare(next.sourceSlug, old.sourceSlug) < 0;
}
const known = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== "unknown" && (!Array.isArray(v) || v.length > 0);
const fieldNames = [
  "type",
  "title",
  "titleKey",
  "organization",
  "organizationKey",
  "description",
  "topics",
  "qualificationTags",
  "countryCodes",
  "locationText",
  "workMode",
  "canonicalUrl",
  "publishedAt",
  "cycleKey",
  "trackKey",
  "parentId",
  "eventStart",
  "eventEnd",
  "status",
  "attributes",
] as const;
const deadlineKey = (d: Deadline): string => `deadline:${d.kind}:${d.roundKey}`;
const deadlineFacts = (
  d: Deadline,
): Value => [d.kind, d.roundKey, d.dueAt, d.dueDate, d.timezone, d.precision, d.basis];
function exactCandidate(a: Opportunity, b: NormalizedOpportunity): boolean {
  return a.fields.organizationKey !== null && a.fields.cycleKey !== null &&
    a.fields.trackKey !== null &&
    a.fields.type === b.fields.type &&
    stable(identityComponents(a.fields)) === stable(identityComponents(b.fields));
}
export async function reconcile(
  incoming: NormalizedOpportunity,
  candidates: CandidateSet,
  origin: Origin,
  authority: Readonly<Record<string, number>> = {},
): Promise<Reconciliation> {
  const forField = (field: string): Origin => ({
    ...origin,
    authority: authority[`${incoming.fields.type}.${field}`] ?? authority[field] ??
      origin.authority,
  });
  const identified = ordered([
    ...candidates.strongIds,
    ...(candidates.observationOpportunityId ? [candidates.observationOpportunityId] : []),
  ]);
  const exact = candidates.candidates.filter((c) => exactCandidate(c, incoming));
  let selected: Opportunity | undefined;
  if (identified.length === 1) selected = candidates.candidates.find((c) => c.id === identified[0]);
  else if (identified.length === 0 && !candidates.truncated && exact.length === 1) {
    selected = exact[0];
  }
  const incompatible = selected && (selected.fields.type !== incoming.fields.type ||
    selected.fields.cycleKey !== null && incoming.fields.cycleKey !== null &&
      selected.fields.cycleKey !== incoming.fields.cycleKey ||
    selected.fields.trackKey !== null && incoming.fields.trackKey !== null &&
      selected.fields.trackKey !== incoming.fields.trackKey);
  const conflict = identified.length > 1 || Boolean(incompatible);
  if (conflict || !selected) {
    const canonical = structuredClone(incoming);
    const ambiguous = !conflict && (candidates.truncated || candidates.candidates.length > 0);
    if (ambiguous || conflict) {
      canonical.fields.qualityFlags = ordered([
        ...canonical.fields.qualityFlags,
        "conflicting_identity_candidate",
      ]) as QualityFlag[];
    }
    return {
      canonical,
      provenance: Object.fromEntries(
        [...fieldNames, ...canonical.deadlines.map(deadlineKey)].map((f) => [f, forField(f)]),
      ),
      candidateIds: candidates.candidates.map((c) => c.id).slice(0, 5),
      anticipatedConflict: conflict,
    };
  }
  const fields = structuredClone(selected.fields);
  const provenance = structuredClone(selected.provenance);
  for (const name of fieldNames) {
    const next = incoming.fields[name];
    const originName = name === "titleKey"
      ? "title"
      : name === "organizationKey"
      ? "organization"
      : name;
    if (
      known(next) &&
      (!known(fields[name]) || originWins(forField(originName), provenance[originName]))
    ) {
      if (name === "attributes") {
        fields.attributes = {
          ...fields.attributes,
          ...Object.fromEntries(
            Object.entries(incoming.fields.attributes).filter(([, v]) => v !== null),
          ),
        };
      } else (fields as unknown as Record<string, unknown>)[name] = structuredClone(next);
      provenance[name] = forField(originName);
    }
  }
  const deadlines = new Map(selected.deadlines.map((d) => [deadlineKey(d), structuredClone(d)]));
  let deadlineConflict = false;
  for (const next of incoming.deadlines) {
    const k = deadlineKey(next), old = deadlines.get(k), prevOrigin = provenance[k];
    if (old && old.precision !== "unknown" && next.precision === "unknown") {
      // Contradictory evidence has unknown precision but is not an absent fact. Keep the
      // previous candidate/provenance for inspection, while blocking precise use unless
      // that fact has strictly stronger reviewed authority than this conflicting input.
      if (next.status === "conflicted" && forField(k).authority >= (prevOrigin?.authority ?? 0)) {
        old.status = "conflicted";
        deadlineConflict = true;
      }
      continue;
    }
    const wins = !old || originWins(forField(k), prevOrigin);
    const differs = old && stable(deadlineFacts(old)) !== stable(deadlineFacts(next));
    if (wins) {
      deadlines.set(k, structuredClone(next));
      provenance[k] = forField(k);
    }
    if (
      old && differs && old.precision !== "unknown" && next.precision !== "unknown" &&
      prevOrigin?.sourceId !== origin.sourceId &&
      forField(k).authority === (prevOrigin?.authority ?? 0)
    ) {
      deadlines.get(k)!.status = "conflicted";
      deadlineConflict = true;
    }
  }
  const flags = new Set<QualityFlag>([...fields.qualityFlags, ...incoming.fields.qualityFlags]);
  if (fields.organization) flags.delete("missing_organization");
  if (fields.publishedAt) flags.delete("missing_publication_time");
  if (fields.workMode !== "unknown") flags.delete("unknown_work_mode");
  if (fields.countryCodes.length || fields.locationText || fields.workMode === "remote") {
    flags.delete("incomplete_location");
  }
  if (deadlineConflict || [...deadlines.values()].some((d) => d.status === "conflicted")) {
    flags.add("conflicting_deadline");
  } else flags.delete("conflicting_deadline");
  fields.qualityFlags = [...flags].sort();
  return {
    canonical: {
      ...incoming,
      fields,
      deadlines: [...deadlines.values()].sort((a, b) => compare(deadlineKey(a), deadlineKey(b))),
      fingerprint: await digest(identityComponents(fields)),
    },
    provenance,
    targetId: selected.id,
    expectedRevision: selected.revision,
    expectedEvidenceVersion: selected.evidenceVersion,
    candidateIds: [],
    anticipatedConflict: false,
  };
}
