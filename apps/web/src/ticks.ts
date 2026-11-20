import { type ConversationDetail, isAtOrAfter } from "@wa/protocol";
import type { LocalMessage } from "./store.js";

export type Tick = "pending" | "failed" | "sent" | "delivered" | "read";

export type TickInfo = { tick: Tick; readBy: string[]; deliveredTo: string[]; waiting: string[] };

// Derived from per-member watermarks: no per-message receipt is stored anywhere.
export function tickOf(
  message: LocalMessage,
  detail: ConversationDetail | undefined,
  me: string,
): TickInfo {
  const empty = { readBy: [], deliveredTo: [], waiting: [] };
  if (message.status !== "sent" || !message.messageId) return { tick: message.status, ...empty };
  const others = detail?.members.filter((m) => m.username !== me) ?? [];
  if (others.length === 0) return { tick: "sent", ...empty };
  const id = message.messageId;
  const readBy = others.filter((m) => isAtOrAfter(m.readUpTo, id)).map((m) => m.username);
  const deliveredTo = others
    .filter((m) => !readBy.includes(m.username) && isAtOrAfter(m.deliveredUpTo, id))
    .map((m) => m.username);
  const waiting = others
    .map((m) => m.username)
    .filter((u) => !readBy.includes(u) && !deliveredTo.includes(u));
  const tick: Tick =
    readBy.length === others.length ? "read" : waiting.length === 0 ? "delivered" : "sent";
  return { tick, readBy, deliveredTo, waiting };
}

export function tickTitle(info: TickInfo): string {
  if (info.tick === "pending") return "Sending";
  if (info.tick === "failed") return "Not sent";
  const parts = [
    info.readBy.length ? `Read by ${info.readBy.join(", ")}` : "",
    info.deliveredTo.length ? `Delivered to ${info.deliveredTo.join(", ")}` : "",
    info.waiting.length ? `Waiting for ${info.waiting.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Sent";
}
