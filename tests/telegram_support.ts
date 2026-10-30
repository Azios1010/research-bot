import type { TelegramConfig } from "../supabase/functions/_shared/adapters/telegram/protocol.ts";
import type {
  InteractionContext,
  ItemView,
  ReplyModel,
} from "../supabase/functions/_shared/application/interaction.ts";
export const syntheticUser = "10000000000000001",
  syntheticBot = "999000111",
  syntheticTarget = "10000000-0000-4000-8000-000000000001",
  replyKey = "20000000-0000-4000-8000-000000000002";
export const config: TelegramConfig = {
  secret: "s".repeat(40),
  botId: syntheticBot,
  botUsername: "synthetic_bot",
  allowedUsers: [syntheticUser],
  bindings: [{ userId: syntheticUser, chatId: syntheticUser, targetId: syntheticTarget }],
};
export async function messageFixture(command = "start", id = "9007199254740995") {
  const body = await Deno.readTextFile("tests/fixtures/telegram/message.json");
  return body.replace('"/start"', JSON.stringify(`/${command}`)).replace("9007199254740995", id);
}
export function callbackFixture(
  token: string,
  options: { updateId?: string; messageId?: string; sender?: string; bot?: string } = {},
) {
  return `{"update_id":${
    options.updateId ?? "1001"
  },"callback_query":{"id":"synthetic_callback_1","from":{"id":${
    options.sender ?? syntheticUser
  },"is_bot":false},"message":{"message_id":${options.messageId ?? "100"},"from":{"id":${
    options.bot ?? syntheticBot
  },"is_bot":true},"chat":{"id":${syntheticUser},"type":"private"}},"data":${
    JSON.stringify(token)
  }}}`;
}
export function sampleContext(): InteractionContext {
  return {
    profileId: "profile-opaque",
    targetId: syntheticTarget,
    action: { kind: "command", command: "start" },
    profile: {
      enabled: false,
      timezone: null,
      topics: [],
      types: [],
      digestEnabled: false,
      digestTime: "08:00",
      revision: 1,
    },
    result: { status: "ok" },
    health: {
      staleSources: 1,
      queued: 2,
      running: 1,
      replies: 0,
      uncertain: 1,
      sources: [{ name: "Synthetic source", lastSuccess: null, stale: true }],
    },
  };
}
export function sampleItem(): ItemView {
  return {
    id: "30000000-0000-4000-8000-000000000003",
    type: "journal_special_issue",
    title: 'Nghiên cứu & dữ liệu <an toàn> _đặc biệt_ "quotes" 😀',
    organization: "Université de Montréal · 東京大学",
    location: null,
    status: "open",
    url: "https://example.invalid/official?a=1&b=2",
    eventStart: null,
    eventEnd: null,
    description: "Synthetic description",
    saved: false,
    ignored: false,
    score: 65,
    reasons: ["topic_match"],
    notes: ["Manuscript submission requires the earlier abstract stage."],
    deadlines: [{
      label: "Submission",
      precision: "date",
      status: "current",
      dueAt: null,
      dueDate: "2027-02-28",
      timezone: null,
    }],
  };
}
export function sampleModel(): ReplyModel {
  return {
    title: "Journals",
    paragraphs: ["Synthetic narrow-screen review"],
    items: [sampleItem()],
    details: true,
    context: sampleContext(),
  };
}
