import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types.ts";
import type { AcceptedAction } from "../../adapters/telegram/protocol.ts";
import type { InboxPort } from "../../adapters/telegram/webhook.ts";
import type {
  BasicProfile,
  HealthView,
  InteractionAction,
  InteractionContext,
  InteractionRepository,
  ItemView,
  ReplyPart,
  SendOutcome,
  SendRepository,
  Snapshot,
} from "../../application/interaction.ts";
import { commands, validateBasicPatch } from "../../application/interaction.ts";
import { type Lease, ProcessingError } from "../../application/ports.ts";
import { type OpportunityType, opportunityTypes } from "../../domain/model.ts";
import { parseRules } from "../../domain/profile.ts";
import { explainAssessment } from "../../application/ranking.ts";

const json = (v: unknown): Json => JSON.parse(JSON.stringify(v));
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new ProcessingError("interaction_shape_invalid");
  }
  return v as Record<string, unknown>;
};
const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new ProcessingError("interaction_shape_invalid");
  return v;
};
const text = (v: unknown): string => {
  if (typeof v !== "string") throw new ProcessingError("interaction_shape_invalid");
  return v;
};
const nullable = (v: unknown): string | null => v === null || v === undefined ? null : text(v);
const count = (v: unknown): number => {
  if (!Number.isSafeInteger(v) || Number(v) < 0) {
    throw new ProcessingError("interaction_shape_invalid");
  }
  return Number(v);
};
const strings = (v: unknown): string[] => array(v).map(text);
const fence = (l: Lease) => ({ p_task: l.id, p_owner: l.owner, p_generation: l.generation });
function snapshot(v: unknown): Snapshot {
  const o = obj(v);
  if (!["today", "deadlines", "conferences", "jobs", "journals", "saved"].includes(text(o.kind))) {
    throw new ProcessingError("interaction_shape_invalid");
  }
  const ids = strings(o.ids);
  if (ids.length > 100) throw new ProcessingError("interaction_shape_invalid");
  return {
    kind: o.kind as Snapshot["kind"],
    ids,
    offset: count(o.offset),
    expiresAt: text(o.expiresAt),
    revision: count(o.revision),
    capped: o.capped === true,
  };
}
function action(v: unknown): InteractionAction {
  const o = obj(v);
  if (
    o.kind === "command" &&
    (commands.includes(o.command as typeof commands[number]) || o.command === "unknown")
  ) {
    let patch;
    try {
      if (o.patch) patch = validateBasicPatch(o.patch);
    } catch { /* SQL returns invalid_profile atomically. */ }
    return {
      kind: "command",
      command: o.command as typeof commands[number] | "unknown",
      ...(patch ? { patch } : {}),
      ...(o.invalid === true ? { invalid: true } : {}),
    };
  }
  if (o.kind === "details") return { kind: "details", opportunityId: text(o.opportunityId) };
  if (
    o.kind === "feedback" &&
    ["save", "unsave", "ignore", "unignore", "open_intent"].includes(text(o.desired))
  ) {
    return {
      kind: "feedback",
      desired: o.desired as "save" | "unsave" | "ignore" | "unignore" | "open_intent",
      opportunityId: text(o.opportunityId),
    };
  }
  if (o.kind === "page") return { kind: "page", view: snapshot(o.view) };
  return { kind: "expired" };
}
// Explicit projection/redaction: no raw errors, addresses or arbitrary server JSON flows to UI.
export function healthView(v: unknown): HealthView {
  const o = obj(v);
  return {
    staleSources: count(o.staleSources),
    queued: count(o.queued),
    running: count(o.running),
    replies: count(o.replies),
    uncertain: count(o.uncertain),
    sources: array(o.sources).slice(0, 20).map((v) => {
      const s = obj(v);
      return {
        name: text(s.name).slice(0, 120),
        lastSuccess: nullable(s.lastSuccess),
        stale: s.stale === true,
      };
    }),
  };
}
function profile(v: unknown): BasicProfile {
  const o = obj(v), types = strings(o.types);
  if (types.some((s) => !opportunityTypes.includes(s as OpportunityType))) {
    throw new ProcessingError("interaction_shape_invalid");
  }
  return {
    enabled: o.enabled === true,
    timezone: nullable(o.timezone),
    topics: strings(o.topics),
    types: types as OpportunityType[],
    digestEnabled: o.digestEnabled === true,
    digestTime: text(o.digestTime),
    revision: count(o.revision),
    ...(o.preferences ? { preferences: parseRules(obj(o.preferences) as never) } : {}),
    remindersEnabled: o.remindersEnabled === true,
  };
}
function item(v: unknown): ItemView {
  const o = obj(v);
  if (!opportunityTypes.includes(o.type as OpportunityType)) {
    throw new ProcessingError("interaction_shape_invalid");
  }
  return {
    id: text(o.id),
    type: o.type as OpportunityType,
    title: text(o.title),
    organization: nullable(o.organization),
    location: nullable(o.location),
    status: text(o.status),
    url: nullable(o.url),
    eventStart: nullable(o.eventStart),
    eventEnd: nullable(o.eventEnd),
    description: nullable(o.description),
    saved: o.saved === true,
    ignored: o.ignored === true,
    score: typeof o.score === "number" && Number.isFinite(o.score) ? o.score : null,
    reasons: strings(o.reasons),
    notes: strings(o.notes),
    explanation: explainAssessment(
      strings(o.reasons),
      o.components ? obj(o.components) as never : {},
    ),
    assessmentContext: o.assessmentContext ? obj(o.assessmentContext) as never : {},
    deadlines: array(o.deadlines).map((v) => {
      const d = obj(v);
      return {
        label: text(d.label),
        precision: text(d.precision),
        status: text(d.status),
        dueAt: nullable(d.dueAt),
        dueDate: nullable(d.dueDate),
        timezone: nullable(d.timezone),
      };
    }),
  };
}
export class SupabaseInteractions implements InboxPort, InteractionRepository, SendRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  private async rpc<K extends keyof Database["public"]["Functions"]>(
    name: K,
    args: Database["public"]["Functions"][K]["Args"],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const query = this.client.rpc(name, args);
    if (signal) query.abortSignal(signal);
    const { data, error } = await query;
    if (error) {
      if (error.code === "55000" && /lease/.test(error.message)) {
        throw new ProcessingError("lease_stale");
      }
      if (error.code === "42501") throw new ProcessingError("interaction_denied");
      throw new ProcessingError("interaction_unavailable", true);
    }
    return data;
  }
  async accept(input: AcceptedAction, botId: string, signal?: AbortSignal) {
    const r = obj(
      await this.rpc("rr_receive_telegram", {
        p_target: input.binding.targetId,
        p_bot: botId,
        p_user: input.binding.userId,
        p_chat: input.binding.chatId,
        p_update: input.updateId,
        p_action: json(input.action),
      }, signal),
    );
    return { duplicate: r.duplicate === true, status: text(r.status) };
  }
  async execute(lease: Lease, signal?: AbortSignal): Promise<InteractionContext> {
    const o = obj(await this.rpc("rr_execute_interaction", fence(lease), signal)),
      r = obj(o.result);
    return {
      profileId: text(o.profileId),
      targetId: text(o.targetId),
      profile: profile(o.profile),
      action: action(o.action),
      health: healthView(o.health),
      result: {
        status: text(r.status),
        ...(r.queued !== undefined ? { queued: count(r.queued) } : {}),
        ...(r.active !== undefined ? { active: count(r.active) } : {}),
      },
    };
  }
  async browse(lease: Lease, signal?: AbortSignal) {
    const o = obj(await this.rpc("rr_browse_interaction", fence(lease), signal));
    return {
      items: array(o.items).filter((v) => v !== null).map(item),
      ...(o.snapshot ? { snapshot: snapshot(o.snapshot) } : {}),
    };
  }
  async commitReply(lease: Lease, parts: ReplyPart[], signal?: AbortSignal) {
    await this.rpc(
      "rr_commit_interaction_reply",
      { ...fence(lease), p_parts: json(parts) },
      signal,
    );
  }
  async begin(lease: Lease, signal?: AbortSignal) {
    const o = obj(await this.rpc("rr_begin_interaction_send", fence(lease), signal));
    const disposition = text(o.disposition);
    if (disposition !== "sending") return { disposition };
    const d = obj(o.destination), p = obj(o.part);
    // Parts originate exclusively from the versioned renderer and were frozen by preparation.
    if (p.renderingVersion !== 1 || typeof p.text !== "string" || !Array.isArray(p.buttons)) {
      throw new ProcessingError("reply_plan_invalid");
    }
    return {
      disposition,
      attemptId: text(o.attempt_id),
      destination: { account: text(d.account), bot: text(d.bot) },
      part: p as unknown as ReplyPart,
    };
  }
  async finishSend(lease: Lease, attemptId: string, result: SendOutcome, signal?: AbortSignal) {
    await this.rpc("rr_finish_interaction_send", {
      ...fence(lease),
      p_attempt: attemptId,
      p_outcome: result.outcome,
      p_message: result.messageId,
      p_code: result.code,
      p_retry: result.retrySeconds ?? 60,
    }, signal);
  }
}
