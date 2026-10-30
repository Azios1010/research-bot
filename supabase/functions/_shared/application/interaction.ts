import { type ObjectValue, type OpportunityType, opportunityTypes } from "../domain/model.ts";
import { parseRules, type Rules } from "../domain/profile.ts";
import { validZone } from "../domain/temporal.ts";
import { type Clock, type Lease, ProcessingError } from "./ports.ts";

export const commands = [
  "start",
  "help",
  "today",
  "deadlines",
  "conferences",
  "jobs",
  "journals",
  "saved",
  "profile",
  "refresh",
  "status",
] as const;
export type Command = typeof commands[number];
export type ListView = "today" | "deadlines" | "conferences" | "jobs" | "journals" | "saved";
export const listViews: readonly string[] = [
  "today",
  "deadlines",
  "conferences",
  "jobs",
  "journals",
  "saved",
];
export type DesiredAction = "save" | "unsave" | "ignore" | "unignore" | "open_intent";
export interface BasicPatch {
  timezone?: string;
  topics?: string[];
  types?: OpportunityType[];
  enabled?: boolean;
  digestEnabled?: boolean;
  digestTime?: string;
  remindersEnabled?: boolean;
  preferences?: ObjectValue;
  rerank?: boolean;
}
export interface BasicProfile {
  enabled: boolean;
  timezone: string | null;
  topics: string[];
  types: OpportunityType[];
  digestEnabled: boolean;
  digestTime: string;
  revision: number;
  preferences?: Rules;
  remindersEnabled?: boolean;
}
export function validateBasicPatch(value: unknown): BasicPatch {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ProcessingError("profile_invalid");
  }
  // Leave room for the normalized action envelope and PostgreSQL JSON spacing.
  // An oversized multilingual patch must become setup guidance, never a retrying receipt.
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 3600) {
    throw new ProcessingError("profile_invalid");
  }
  const patch = value as Record<string, unknown>;
  if (
    !Object.keys(patch).length ||
    Object.keys(patch).some((k) =>
      ![
        "timezone",
        "topics",
        "types",
        "enabled",
        "digestEnabled",
        "digestTime",
        "remindersEnabled",
        "preferences",
        "rerank",
      ].includes(k)
    )
  ) throw new ProcessingError("profile_invalid");
  if (
    patch.timezone !== undefined &&
    (typeof patch.timezone !== "string" || !validZone(patch.timezone))
  ) throw new ProcessingError("profile_timezone_invalid");
  if (
    patch.topics !== undefined &&
    (!Array.isArray(patch.topics) || patch.topics.length > 20 ||
      patch.topics.some((s) => typeof s !== "string" || !s.trim() || s.length > 160))
  ) throw new ProcessingError("profile_topics_invalid");
  if (Array.isArray(patch.topics)) {
    const topics = [...new Set(patch.topics.map((s: string) => s.normalize("NFC").trim()))];
    try {
      parseRules({ positive_topics: topics });
    } catch {
      throw new ProcessingError("profile_topics_invalid");
    }
  }
  if (
    patch.types !== undefined &&
    (!Array.isArray(patch.types) || patch.types.length > 11 ||
      patch.types.some((s) => !opportunityTypes.includes(s)))
  ) throw new ProcessingError("profile_types_invalid");
  if (patch.preferences !== undefined) {
    try {
      parseRules(patch.preferences as ObjectValue);
    } catch {
      throw new ProcessingError("profile_preferences_invalid");
    }
  }
  for (const key of ["enabled", "digestEnabled", "remindersEnabled", "rerank"]) {
    if (patch[key] !== undefined && typeof patch[key] !== "boolean") {
      throw new ProcessingError("profile_invalid");
    }
  }
  if (
    patch.digestTime !== undefined &&
    (typeof patch.digestTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.digestTime))
  ) throw new ProcessingError("profile_schedule_invalid");
  return {
    ...patch,
    ...(Array.isArray(patch.topics)
      ? { topics: [...new Set(patch.topics.map((s: string) => s.normalize("NFC").trim()))] }
      : {}),
    ...(Array.isArray(patch.types) ? { types: [...new Set(patch.types)] } : {}),
  } as BasicPatch;
}
export function profileMissing(profile: BasicProfile): string[] {
  return [
    !profile.timezone || !validZone(profile.timezone) ? "timezone" : "",
    !profile.topics.length ? "topics" : "",
    !profile.types.length ? "types" : "",
  ].filter(Boolean);
}
export type InteractionAction =
  | { kind: "command"; command: Command | "unknown"; patch?: BasicPatch; invalid?: boolean }
  | { kind: "feedback"; desired: DesiredAction; opportunityId: string }
  | { kind: "details"; opportunityId: string }
  | { kind: "page"; view: Snapshot }
  | { kind: "expired" };
export interface Snapshot {
  kind: ListView;
  ids: string[];
  offset: number;
  expiresAt: string;
  revision: number;
  capped: boolean;
}
export interface ItemView {
  id: string;
  type: OpportunityType;
  title: string;
  organization: string | null;
  location: string | null;
  status: string;
  url: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  description: string | null;
  deadlines: {
    label: string;
    precision: string;
    status: string;
    dueAt: string | null;
    dueDate: string | null;
    timezone: string | null;
  }[];
  score: number | null;
  reasons: string[];
  saved: boolean;
  ignored: boolean;
  notes: string[];
  explanation?: string[];
  assessmentContext?: ObjectValue;
}
export interface HealthView {
  staleSources: number;
  queued: number;
  running: number;
  replies: number;
  uncertain: number;
  sources: { name: string; lastSuccess: string | null; stale: boolean }[];
}
export interface InteractionContext {
  profileId: string;
  targetId: string;
  profile: BasicProfile;
  action: InteractionAction;
  result: { status: string; queued?: number; active?: number };
  health: HealthView;
}
// Message plans are channel neutral. Adapters own encoding, parse modes and keyboards.
export interface ReplyButton {
  label: string;
  action?: string;
  url?: string;
}
export interface ReplyPart {
  text: string;
  buttons: ReplyButton[][];
  view?: Snapshot;
  itemIds: string[];
  renderingVersion: number;
  assessments?: Record<string, ObjectValue>;
}
export interface ReplyModel {
  title: string;
  paragraphs: string[];
  items: ItemView[];
  details: boolean;
  snapshot?: Snapshot;
  context: InteractionContext;
}
export interface InteractionRepository {
  execute(lease: Lease, signal?: AbortSignal): Promise<InteractionContext>;
  browse(lease: Lease, signal?: AbortSignal): Promise<{ items: ItemView[]; snapshot?: Snapshot }>;
  commitReply(lease: Lease, parts: ReplyPart[], signal?: AbortSignal): Promise<void>;
}
export interface ReplyRenderer {
  render(model: ReplyModel, replyKey: string): ReplyPart[];
}
const help =
  "/start · /help · /today · /deadlines · /conferences · /jobs · /journals · /saved · /profile · /refresh · /status";
export async function handleInteraction(
  lease: Lease,
  deps: { repository: InteractionRepository; renderer: ReplyRenderer; clock: Clock },
  signal?: AbortSignal,
): Promise<void> {
  const context = await deps.repository.execute(lease, signal),
    { action, profile, health } = context;
  const model: ReplyModel = {
    title: "Research Radar",
    paragraphs: [],
    items: [],
    details: false,
    context,
  };
  const missing = profileMissing(profile);
  const setup = missing.length
    ? `Setup incomplete: ${
      missing.join(", ")
    }. Use /profile for setup instructions. Browsing is unpersonalized.`
    : profile.enabled
    ? "Profile ready."
    : "Profile disabled. Use /profile enabled true when ready.";
  if (action.kind === "expired") {
    model.paragraphs.push(
      "This button has expired or the message is no longer available. Run the command again.",
    );
  } else if (action.kind === "feedback") {
    model.title = ({
      save: "Saved",
      unsave: "Removed from saved",
      ignore: "Ignored",
      unignore: "Ignore undone",
      open_intent: "Open intent recorded",
    })[action.desired];
    if (action.desired === "open_intent") {
      model.paragraphs.push(
        "Use the source link below. This records your intent, not a confirmed visit.",
      );
    }
    model.details = true;
  } else if (action.kind === "details") model.details = true;
  else if (action.kind === "command") {
    const cmd = action.command;
    if (cmd === "start") {
      model.paragraphs.push(
        setup,
        "Browse persisted opportunities, save useful items, or inspect /status. No schedules are active in this phase.",
        help,
      );
    } else if (cmd === "help" || cmd === "unknown") {
      model.paragraphs.push(
        cmd === "unknown" ? "Unknown command. Supported commands:" : "Commands",
        help,
      );
    } else if (cmd === "profile") {
      model.title = "Research profile";
      if (action.patch && context.result.status === "ok") {
        model.paragraphs.push("Settings saved. Changed configuration queues bounded re-ranking.");
      }
      model.paragraphs.push(
        setup,
        `Profile revision: ${profile.revision}\nTimezone: ${
          profile.timezone ?? "not set"
        }\nTopics: ${[...profile.topics.join(", ")].slice(0, 600).join("") || "not set"}\nTypes: ${
          profile.types.join(", ") || "not set"
        }\nMatching: ${profile.enabled ? "enabled" : "disabled"}\nDigest: ${
          profile.digestEnabled ? "enabled" : "disabled"
        }, ${profile.digestTime} local time (schedules inactive).`,
        ...profilePreferenceText(profile),
        "Edit one field: /profile <field> <value>\nTopics: /profile topics phrase^weight|alias; phrase\nTypes: /profile types phd,conference\nWeights: /profile weights phd=1,conference=0.5\nGeography: /profile countries DE,VN\nInstitutions: /profile institutions Example Institute\nTimezone: /profile timezone Area/City\nDigest time: /profile time 08:00\nOffsets: /profile offsets 30d,7d,1d\nReminders: /profile reminders false\nOther fields: blocked, ignored, excluded-countries, hard-countries, work-modes, blocked-institutions, qualifications, conflicts, student, nationalities, unknown, threshold, digest, enabled.\nUse clear to empty a list/map. Each command replaces that setting. /profile rerank queues a bounded pass. No schedules are active.",
      );
      if (context.result.status === "invalid_profile" || action.invalid) {
        model.paragraphs.unshift("Those settings are invalid or incomplete; no settings changed.");
      }
    } else if (cmd === "refresh") {
      model.title = "Refresh";
      model.paragraphs.push(
        ({
          queued: `Queued ${context.result.queued ?? 0} source refreshes. Check /status later.`,
          active: "Refresh already queued or running.",
          throttled: "Refresh is limited to once every five minutes. Check /status.",
          unavailable: "Collection is temporarily unavailable or paused. Check /status.",
        })[context.result.status] ?? "Refresh is temporarily unavailable.",
      );
    } else if (cmd === "status") {
      model.title = "Status";
      model.paragraphs.push(
        setup,
        `Sources stale: ${health.staleSources}\nWork queued: ${health.queued}; running: ${health.running}\nReply backlog: ${health.replies}\nUncertain deliveries: ${health.uncertain}`,
        ...health.sources.map((s) =>
          `${s.name}: ${s.lastSuccess ?? "no successful collection"}${s.stale ? " · stale" : ""}`
        ),
      );
    } else if (cmd === "today" && (missing.length || !profile.enabled)) {
      model.paragraphs.push(setup, "Use category commands to browse without personalized ranking.");
    }
  }
  const browsing = action.kind === "page" || action.kind === "details" ||
    action.kind === "feedback" ||
    action.kind === "command" && listViews.includes(action.command) &&
      !(action.command === "today" && (missing.length || !profile.enabled));
  if (browsing) {
    let result: Awaited<ReturnType<InteractionRepository["browse"]>>;
    try {
      result = await deps.repository.browse(lease, signal);
    } catch (error) {
      if (signal?.aborted || error instanceof ProcessingError && error.code === "lease_stale") {
        throw error;
      }
      model.paragraphs.push(
        "Opportunities are temporarily unavailable. Please try the command again later.",
      );
      await deps.repository.commitReply(lease, deps.renderer.render(model, lease.id), signal);
      return;
    }
    model.items = result.items;
    model.snapshot = result.snapshot;
    if (result.snapshot) {
      model.title = `${result.snapshot.kind[0].toUpperCase()}${result.snapshot.kind.slice(1)}`;
      if (result.snapshot.kind !== "today" && missing.length) {
        model.paragraphs.push(
          "Unpersonalized browsing; finish /profile to enable relevance matching.",
        );
      }
      if (!model.items.length) {
        model.paragraphs.push(
          result.snapshot.kind === "saved"
            ? "No saved items on this page."
            : "No current opportunities on this page.",
        );
      }
      if (result.snapshot.kind === "deadlines") {
        model.paragraphs.push(
          "Next 30 days; unknown, rolling and conflicted deadlines are labeled separately.",
        );
      }
    } else if (!model.items.length) {
      model.paragraphs.push(
        action.kind === "page"
          ? "This page has expired. Run the list command again."
          : "This opportunity is no longer available. Run the list command again.",
      );
    }
    if (health.staleSources) {
      model.paragraphs.push("Some source coverage is stale. See /status for freshness.");
    }
  }
  await deps.repository.commitReply(lease, deps.renderer.render(model, lease.id), signal);
}

function profilePreferenceText(profile: BasicProfile): string[] {
  const r = profile.preferences;
  if (!r) return [];
  const show = (xs: string[]) => xs.join(", ") || "none supplied";
  return [
    `Topic weights/aliases: ${
      r.positiveTopics.map((t) =>
        `${t.phrase} (${t.weight})${t.aliases.length ? `: ${t.aliases.join(", ")}` : ""}`
      ).join("; ") || "none supplied"
    }`,
    `Blocked topics: ${show(r.blockedTopics)}\nIgnored topics: ${
      show(r.ignoredTopics)
    }\nType weights: ${
      Object.entries(r.typeWeights).map(([t, w]) => `${t}=${w}`).join(", ") || "none supplied"
    }`,
    `Preferred countries: ${show(r.preferredCountries)}\nExcluded countries: ${
      show(r.excludedCountries)
    }\nRequire preferred country: ${r.hardCountries}\nWork modes: ${
      show(r.preferredWorkModes)
    }\nInstitutions: ${show(r.preferredInstitutions)}\nBlocked institutions: ${
      show(r.blockedInstitutions)
    }`,
    `Compatible qualification requirements: ${
      show(r.compatibleQualifications)
    }\nConflicting requirements: ${show(r.incompatibleQualifications)}\nFull-time student: ${
      r.eligibilityFacts.studentFullTime ?? "unknown"
    }\nNationalities: ${
      show(r.eligibilityFacts.nationalities)
    }\nUnknown data: ${r.unknownPolicy}\nRelevance threshold: ${r.threshold}/100 (provisional until calibration)`,
    `Reminders: ${profile.remindersEnabled ? "enabled" : "disabled"}; offsets ${
      r.reminderOffsets.map((n) => `${n}d`).join(", ") || "not set"
    }. Scheduling inactive.`,
  ].map((s) => [...s].length > 1000 ? [...s].slice(0, 999).join("") + "… (view excerpt)" : s);
}

export type SendOutcome = {
  outcome: "sent" | "retryable_failure" | "permanent_failure" | "uncertain";
  messageId?: string;
  code?: string;
  retrySeconds?: number;
};
export interface ReplyDelivery {
  send(
    destination: { account: string; bot: string },
    part: ReplyPart,
    signal?: AbortSignal,
  ): Promise<SendOutcome>;
}
export interface SendRepository {
  begin(
    lease: Lease,
    signal?: AbortSignal,
  ): Promise<
    {
      disposition: string;
      attemptId?: string;
      destination?: { account: string; bot: string };
      part?: ReplyPart;
    }
  >;
  finishSend(
    lease: Lease,
    attemptId: string,
    outcome: SendOutcome,
    signal?: AbortSignal,
  ): Promise<void>;
}
export async function deliverReply(
  lease: Lease,
  deps: { repository: SendRepository; delivery: ReplyDelivery },
  signal?: AbortSignal,
): Promise<void> {
  const attempt = await deps.repository.begin(lease, signal);
  if (attempt.disposition !== "sending") return;
  if (!attempt.attemptId || !attempt.part || !attempt.destination) {
    throw new ProcessingError("send_context_invalid");
  }
  // A crash anywhere after begin leaves a durable sending marker. Never retry IO here.
  let outcome: SendOutcome;
  try {
    outcome = await deps.delivery.send(attempt.destination, attempt.part, signal);
  } catch {
    outcome = { outcome: "uncertain", code: "send_transport_unknown" };
  }
  // A failed outcome write must leave the marker unresolved for conservative recovery.
  await deps.repository.finishSend(lease, attempt.attemptId, outcome, signal);
}
