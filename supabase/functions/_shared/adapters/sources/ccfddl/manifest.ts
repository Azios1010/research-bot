// Reviewed endpoint configuration is code, never a URL taken from a source row.
export const ccfddlManifest = {
  slug: "ccfddl",
  parserVersion: "ccfddl-yaml-v1",
  series: "SIGMOD",
  category: "DB",
  upstreamPath: "conference/DB/sigmod.yml",
  endpoint: "https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/conference/DB/sigmod.yml",
  type: "conference",
  officialHost: "sigmod.org",
  // The joint homepage is not listing-specific. Never synthesize unreviewed call paths.
  reviewedListings: [{
    id: "sigmod27",
    canonicalUrl: "https://2027.sigmod.org/",
    identityUrl: "https://2027.sigmod.org/calls_papers_sigmod_research.shtml",
  }],
  maxBytes: 16384,
  maxRecords: 32,
  maxRounds: 12,
  timeoutMs: 15000,
  requestsPerRun: 1,
  proposedCadenceMinutes: 1440,
  permissionReviewedAt: "2026-10-29",
  upstreamRevision: "2e5a397ce3639e7464b7e7f5222c6d011517ad29",
  license: "MIT (c) 2021 CCFDDL",
  evidence: "docs/sources/ccfddl.md",
  fixtures: "tests/fixtures/ccfddl/",
} as const;
export type ConferenceManifest =
  & Omit<
    typeof ccfddlManifest,
    | "slug"
    | "series"
    | "category"
    | "upstreamPath"
    | "endpoint"
    | "type"
    | "officialHost"
    | "reviewedListings"
  >
  & {
    readonly slug: string;
    readonly series: string;
    readonly category: string;
    readonly upstreamPath: string;
    readonly endpoint: string;
    readonly type: "conference" | "workshop";
    readonly officialHost: string;
    readonly reviewedListings: readonly {
      readonly id: string;
      readonly canonicalUrl: string;
      readonly identityUrl: string;
    }[];
  };

// Same provider/parser; an independently bounded series path closes workshop coverage.
export const hotosManifest: ConferenceManifest = {
  ...ccfddlManifest,
  slug: "ccfddl-hotos",
  series: "HotOS",
  category: "SE",
  type: "workshop",
  upstreamPath: "conference/SE/hotos.yml",
  endpoint: "https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/conference/SE/hotos.yml",
  officialHost: "sigops.org",
  reviewedListings: [{
    id: "hotos27",
    canonicalUrl: "https://sigops.org/s/conferences/hotos/2027/",
    identityUrl: "https://sigops.org/s/conferences/hotos/2027/cfp.html",
  }],
};
