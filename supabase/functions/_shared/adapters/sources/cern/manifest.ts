const feed = "https://careers.cern/jobs/feed/";
export const cernManifest = {
  slug: "cern-students",
  parserVersion: "cern-rss-v1",
  supportedTypes: ["phd", "research_internship"],
  feeds: [feed, ...Array.from({ length: 5 }, (_, i) => `${feed}?paged=${i + 2}`)],
  internshipUrl: "https://careers.cern/jobs/short-term-internship/",
  approvedHosts: ["careers.cern"],
  approvedPaths: ["/jobs/feed/", "/jobs/short-term-internship/"],
  // Exact query URLs are in feeds; no caller-supplied filters/pagination URL.
  maxPages: 6,
  maxRecords: 10,
  maxFeedBytes: 65536,
  maxDetailBytes: 262144,
  maxBytes: 786432,
  timeoutMs: 15000,
  requestsPerTask: 2,
  detailRequestsPerTask: 1,
  maxRequestsPerRun: 12,
  proposedCadenceMinutes: 1440,
  conditional: false,
  permissionReviewedAt: "2026-10-29",
  rightsUrl: "https://careers.cern/jobs/",
  permission:
    "Official HTML explicitly advertises Job offers RSS; personal factual feed use only; no full advert redistribution; no SmartRecruiters/private API calls",
  evidence: "docs/sources/cern-students.md",
  fixtures: "tests/fixtures/cern/",
  classificationPolicy:
    "Reviewed doctoral research placement with explicit edition; STAG reviewed in official scientific/technical fields, also administrative placements; assignment and personal eligibility unknown",
} as const;
