# CERN student positions — Phase 05 Checkpoint B

Access reviewed 2026-10-29 after A closed. Nonpersonal technical scope; researcher eligibility is unknown.

## Selection and permission

The official [job index](https://careers.cern/jobs/) HTML explicitly advertises `https://careers.cern/jobs/feed/` as Job offers Feed. This employer-published RSS is selected. [Robots](https://careers.cern/robots.txt) permits feed/job paths. Narrow personal reading of factual vacancy information and one linked official article matches the offered syndication use; no open-content redistribution license is claimed. Fixtures contain rewritten factual summaries/structural transcriptions, no advert prose, contacts, logo or imagery. Preserve CERN attribution and original links. Commercial/multi-user redistribution requires fresh rights review.

The documented SmartRecruiters Posting API was **not selected**. Its [platform policy](https://developers.smartrecruiters.com/docs/the-smartrecruiters-platform) incorporates [SAP API Policy v4.2026a](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf), restricting systematic extraction and autonomous integrations outside approved pathways. No ATS API/payload fetch, candidate portal, private API, login or bypass. CERN's WordPress API index returned 401 and is excluded. This adapter reads independently published CERN RSS.

Other B alternatives: Inria search has explicit PhD/research-internship categories but [terms](https://jobs.inria.fr/public/en/mentions-legales) require prior written permission for protected content use; no advertised RSS/read API found. Not selected. Max Planck's advertised jobs RSS is small (26,902 bytes / 30 items) and has PhDs but lacks current internships and employer/deadline details; adding it duplicates the doctoral path. TUM returned 403; ETH had no advertised RSS in inspected HTML; Oulu's ATS was unreadable. Openlab advertises RSS but its feed returned 404, so it is not enabled. These are fallbacks, not verified collectors.

## Interface and limits

Final inspected CERN RSS: four pages, 10/10/10/2 items; 5,684 / 5,729 / 5,666 / 2,091 decoded bytes. Fifth page returned 404 during evaluation; stop on a short valid page, never interpret transport failure as empty. Search-filter variants returned empty despite a live internship and are rejected. RSS contains title/link/GUID/pubDate, with empty description/content. GUID identifies a CMS post, not a hiring cycle; STAG reuses a page across cycles.

One page/fenced task, six RSS pages/run maximum, ten items/page, 64 KiB feed; one 256 KiB detail request maximum per page for the fixed internship page, shared 15-second transport deadline. No arbitrary detail URLs, redirects or ATS navigation. Full sixth page fails visibly for review. Conservative maximum is twelve requests/run if the internship shifts across every page; current four-page runs use five requests. Daily cadence proposed; no schedule. Unversioned paginated RSS has no immutable revision: run source_revision stays null; per-page payload digest retained in metadata. Publication during collection may shift pages; no withdrawal/completeness inference. No conditional/304 shortcut for this interface.

## Classification and identity

Doctoral programme is a paid, time-bounded research placement contributing to an enrolled doctorate, not generic degree information or a project grant. Explicit programme title + edition required; feed-only eligibility/location/deadline remain unknown. The [official 2027-1 posting](https://jobs.smartrecruiters.com/CERN/744000141910971-doctoral-student-programme-2027-1), manually inspected, closed 16 October 2026 at 23:59 Geneva. Absent from all current pages; fixture is historical, no live PhD fabricated.

STAG [Short-Term Internship](https://careers.cern/jobs/short-term-internship/) is explicitly listed under applied physics, data science and IT as well as administration. One programme record represents this mixed scientific/technical training call; a research assignment is not guaranteed. Preserve that scope and restrictions; do not classify every CERN role/internship as research. The fixed detail supplies STAG 2026, closing 1 November 2026 23:59 Geneva, Geneva/Switzerland, Fully Onsite and eligibility. Evidence is scoped before FAQs. No duplication per field.

Cycle identity comes from STAG reference or explicit doctoral edition, independent of deadline/pubDate/GUID timestamp. Later STAG cycle stays separate despite homepage reuse; core listing identity is edition-scoped. Failed fixed-detail fetch quarantines that item while siblings survive; RSS/document failure aborts page commit. Checkpoint B closed after fixture persistence and real four-page ingestion, replay and cleanup; final regression/input-bound evidence is in the [Phase 05 report](../verification/phase05-research-sources.md). No current doctoral record was fabricated to replace the seasonal absence.
