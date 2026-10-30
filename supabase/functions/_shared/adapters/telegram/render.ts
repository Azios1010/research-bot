import type {
  ItemView,
  ReplyButton,
  ReplyModel,
  ReplyPart,
  ReplyRenderer,
} from "../../application/interaction.ts";
import { safeUrl } from "../../domain/primitives.ts";
import { callbackData } from "./protocol.ts";
import { ProcessingError } from "../../application/ports.ts";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(
    '"',
    "&quot;",
  ).replaceAll("'", "&#39;");
}
// Split plain text before escaping. No HTML entity, Unicode scalar or URL button is split.
export function splitText(value: string, maximum = 3000): string[] {
  if (!Number.isInteger(maximum) || maximum < 2 || maximum > 4000) {
    throw new ProcessingError("message_limit_invalid");
  }
  const result: string[] = [];
  let current = "";
  for (const character of value) {
    if (current.length + character.length > maximum) {
      result.push(current);
      current = "";
    }
    current += character;
  }
  if (current) result.push(current);
  return result;
}
export function deadlineText(d: ItemView["deadlines"][number]): string {
  if (d.status === "conflicted") return `${d.label}: conflicting evidence; confirm with source`;
  if (d.precision === "instant" && d.dueAt) {
    return `${d.label}: ${d.dueAt} (${d.timezone ?? "explicit offset"})`;
  }
  if (d.precision === "date" && d.dueDate) {
    return `${d.label}: ${d.dueDate} · date only; closing time unknown`;
  }
  return `${d.label}: ${/rolling/i.test(d.label) ? "rolling" : "date unknown"}`;
}
function itemText(item: ItemView, details: boolean): string {
  const clip = (value: string, maximum: number) =>
    [...value].length > maximum ? [...value].slice(0, maximum - 1).join("") + "…" : value;
  const rounds = details ? item.deadlines : item.deadlines.slice(0, 2);
  return [
    details ? item.title : clip(item.title, 180),
    item.organization ? clip(item.organization, details ? 512 : 120) : "Organization unknown",
    `${item.type.replaceAll("_", " ")} · ${item.status}${item.saved ? " · saved" : ""}${
      item.ignored ? " · ignored" : ""
    }`,
    item.location ?? "Location / remote status unknown",
    ...rounds.map(deadlineText),
    ...(!details && item.deadlines.length > 2 ? ["More rounds in Details."] : []),
    ...(item.deadlines.length ? [] : ["Deadline unknown"]),
    ...(item.eventStart
      ? [`Event: ${item.eventStart}${item.eventEnd ? ` – ${item.eventEnd}` : ""}`]
      : []),
    ...(item.score !== null
      ? [
        `Relevance: ${item.score}/100${
          item.reasons.length ? ` · ${item.reasons.join(", ").replaceAll("_", " ")}` : ""
        }`,
      ]
      : []),
    ...item.notes,
    ...(details && item.description ? [item.description] : []),
  ].join("\n");
}
export class TelegramRenderer implements ReplyRenderer {
  render(model: ReplyModel, key: string): ReplyPart[] {
    const ids = model.items.map((i) => i.id), parts: ReplyPart[] = [];
    const add = (plain: string, buttons: ReplyButton[][] = []) => {
      const chunks = splitText(plain);
      chunks.forEach((chunk, index) =>
        parts.push({
          text: escapeHtml(chunk),
          buttons: index === chunks.length - 1 ? buttons : [],
          itemIds: ids,
          renderingVersion: 1,
        })
      );
    };
    add([model.title, ...model.paragraphs].join("\n\n"));
    model.items.forEach((item, index) => {
      const action = (code: Parameters<typeof callbackData>[0]) => callbackData(code, key, index);
      const buttons: ReplyButton[][] = [
        [{ label: "Details", action: action("d") }, {
          label: item.saved ? "Unsave" : "Save",
          action: action(item.saved ? "u" : "s"),
        }],
        [{
          label: item.ignored ? "Undo Ignore" : "Ignore",
          action: action(item.ignored ? "r" : "i"),
        }, { label: "Track Open intent", action: action("o") }],
      ];
      if (item.url) {
        try {
          buttons.push([{ label: "Source link", url: safeUrl(item.url) }]);
        } catch { /* Invalid stored URL is never emitted. */ }
      }
      add(itemText(item, model.details), buttons);
    });
    if (model.snapshot) {
      parts[0].view = model.snapshot;
      const { offset, ids, capped } = model.snapshot;
      if (offset + 3 < ids.length) {
        parts[parts.length - 1].buttons.push([{
          label: "Next page →",
          action: callbackData("p", key, 0),
        }]);
      }
      if (ids.length) {
        parts[parts.length - 1].text += "\n\n" + escapeHtml(
          `Page ${Math.floor(offset / 3) + 1} · ${ids.length}${
            capped ? "+" : ""
          } items in this snapshot${capped ? "; start a new command for newer results" : ""}.`,
        );
      }
    }
    if (parts.length > 10 || new TextEncoder().encode(JSON.stringify(parts)).length > 62000) {
      throw new ProcessingError("reply_too_large");
    }
    return parts;
  }
}
