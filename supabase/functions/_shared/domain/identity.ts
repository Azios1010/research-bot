import {
  DomainError,
  family,
  type Fields,
  type IdentityEvidence,
  type StrongIdentity,
  type Value,
} from "./model.ts";
import { digest, safeUrl } from "./primitives.ts";

export const identityVersion = 1;
export const identityComponents = (fields: Fields): Value[] => [
  "research-radar-identity",
  identityVersion,
  family(fields.type),
  fields.titleKey,
  fields.organizationKey,
  fields.cycleKey,
  fields.trackKey,
];
export async function identitiesFor(fields: Fields, evidence: IdentityEvidence[]) {
  if (evidence.length > 20) throw new DomainError("too_many_identities");
  const fingerprint = await digest(identityComponents(fields));
  const identities: StrongIdentity[] = [];
  if (fields.organizationKey && fields.cycleKey !== null && fields.trackKey !== null) {
    identities.push({
      kind: "natural_key",
      version: identityVersion,
      value: fingerprint,
      evidence: { components: identityComponents(fields), normalization_version: 1 },
    });
  }
  for (const e of evidence) {
    if (e.kind !== "listing_url" || !e.reviewed || !e.listingSpecific) continue;
    if (
      ["event", "call", "funding"].includes(family(fields.type)) &&
      (fields.cycleKey === null || fields.trackKey === null)
    ) continue;
    const components: Value[] = [
      "listing-url",
      identityVersion,
      fields.type,
      safeUrl(e.value),
      fields.cycleKey,
      fields.trackKey,
    ];
    identities.push({
      kind: "listing_url",
      version: identityVersion,
      value: await digest(components),
      evidence: { components },
    });
  }
  const unique = new Map(identities.map((i) => [`${i.kind}:${i.value}`, i]));
  return {
    fingerprint,
    fingerprintVersion: identityVersion,
    identities: [...unique.values()].sort((a, b) =>
      `${a.kind}:${a.value}` < `${b.kind}:${b.value}` ? -1 : 1
    ),
  };
}
