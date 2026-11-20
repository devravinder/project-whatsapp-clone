import {
  type ChatMessage,
  compareTimeuuid,
  type ConversationDetail,
  type ConversationSummary,
  isAtOrAfter,
  type Presence,
  type Receipt,
  type SendAck,
  TYPING_SHOWN_MS,
} from "@wa/protocol";
import { useSyncExternalStore } from "react";

export type LocalMessage = Omit<ChatMessage, "messageId"> & {
  // Null until the server acknowledged it (the clock icon).
  messageId: string | null;
  status: "pending" | "sent" | "failed";
};

export type Connection = "connecting" | "online" | "offline";

// Sender + clientMsgId is unique and known before the server assigns messageId.
export const messageKey = (m: { sender: string; clientMsgId: string }) =>
  `${m.sender}:${m.clientMsgId}`;

function byTime(a: LocalMessage, b: LocalMessage): number {
  if (a.messageId && b.messageId) return compareTimeuuid(a.messageId, b.messageId);
  if (a.messageId) return -1;
  if (b.messageId) return 1;
  return a.sentAt.localeCompare(b.sentAt);
}

export class ChatStore {
  readonly conversations = new Map<string, ConversationSummary>();
  readonly details = new Map<string, ConversationDetail>();
  readonly messages = new Map<string, Map<string, LocalMessage>>();
  readonly hasOlder = new Map<string, boolean>();
  readonly presence = new Map<string, Presence>();
  // conversationId -> username -> when the indicator stops.
  readonly typing = new Map<string, Map<string, number>>();
  activeId: string | null = null;
  connection: Connection = "connecting";
  serverId: string | null = null;

  private version = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  protected changed(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  setActive(id: string | null): void {
    this.activeId = id;
    this.changed();
  }

  setPresence(presence: Presence): void {
    this.presence.set(presence.username, presence);
    this.changed();
  }

  // The other person in each 1:1 chat: whose presence is shown.
  directPartners(): string[] {
    return [...this.conversations.values()].filter((c) => c.kind === "direct").map((c) => c.title);
  }

  // Watermarks only move forward: a late or replayed receipt changes nothing.
  applyReceipt(receipt: Receipt): void {
    const detail = this.details.get(receipt.conversationId);
    const member = detail?.members.find((m) => m.username === receipt.username);
    if (!detail || !member) return;
    const later = (current: string | null) =>
      isAtOrAfter(current, receipt.upTo) ? current : receipt.upTo;
    const updated = {
      ...member,
      deliveredUpTo: later(member.deliveredUpTo),
      readUpTo: receipt.status === "read" ? later(member.readUpTo) : member.readUpTo,
    };
    this.details.set(receipt.conversationId, {
      ...detail,
      members: detail.members.map((m) => (m.username === receipt.username ? updated : m)),
    });
    this.changed();
  }

  setTyping(conversationId: string, username: string, typing = true): void {
    let users = this.typing.get(conversationId);
    if (!users) this.typing.set(conversationId, (users = new Map()));
    if (typing) {
      users.set(username, Date.now() + TYPING_SHOWN_MS);
      setTimeout(() => this.changed(), TYPING_SHOWN_MS + 50);
    } else if (!users.delete(username)) {
      return;
    }
    this.changed();
  }

  typingIn(conversationId: string): string[] {
    const now = Date.now();
    return [...(this.typing.get(conversationId) ?? [])]
      .filter(([, until]) => until > now)
      .map(([u]) => u);
  }

  // Newest message in the conversation written by someone else.
  newestFromOthers(conversationId: string, me: string): string | undefined {
    return (
      this.timeline(conversationId)
        .filter((m) => m.messageId && m.sender !== me)
        .at(-1)?.messageId ?? undefined
    );
  }

  setConnection(connection: Connection, serverId: string | null = null): void {
    this.connection = connection;
    this.serverId = serverId;
    this.changed();
  }

  fail(sender: string, conversationId: string, clientMsgId: string): void {
    const bucket = this.bucket(conversationId);
    const key = messageKey({ sender, clientMsgId });
    const message = bucket.get(key);
    if (message?.status !== "pending") return;
    bucket.set(key, { ...message, status: "failed" });
    this.changed();
  }

  setConversations(list: ConversationSummary[]): void {
    this.conversations.clear();
    for (const c of list) this.conversations.set(c.conversationId, c);
    this.changed();
  }

  upsertConversation(summary: ConversationSummary): void {
    this.conversations.set(summary.conversationId, summary);
    this.changed();
  }

  setDetail(detail: ConversationDetail): void {
    this.details.set(detail.conversationId, detail);
    this.changed();
  }

  sortedConversations(): ConversationSummary[] {
    return [...this.conversations.values()].sort((a, b) => {
      if (!a.lastMessage || !b.lastMessage) return a.lastMessage ? -1 : b.lastMessage ? 1 : 0;
      return compareTimeuuid(b.lastMessage.messageId, a.lastMessage.messageId);
    });
  }

  private bucket(conversationId: string): Map<string, LocalMessage> {
    let bucket = this.messages.get(conversationId);
    if (!bucket) this.messages.set(conversationId, (bucket = new Map()));
    return bucket;
  }

  // Idempotent: the same message from history, live delivery or a retry lands on one key.
  addMessages(messages: ChatMessage[]): LocalMessage[] {
    const added: LocalMessage[] = [];
    for (const m of messages) {
      const bucket = this.bucket(m.conversationId);
      const key = messageKey(m);
      if (bucket.get(key)?.status !== "sent") {
        this.typing.get(m.conversationId)?.delete(m.sender);
        const local: LocalMessage = { ...m, status: "sent" };
        bucket.set(key, local);
        added.push(local);
      }
      this.bumpLastMessage(m);
    }
    if (messages.length > 0) this.changed();
    return added;
  }

  addPending(message: LocalMessage): void {
    this.bucket(message.conversationId).set(messageKey(message), message);
    this.changed();
  }

  acknowledge(sender: string, ack: SendAck): void {
    const bucket = this.bucket(ack.conversationId);
    const key = messageKey({ sender, clientMsgId: ack.clientMsgId });
    const pending = bucket.get(key);
    if (!pending) return;
    const sent: LocalMessage = {
      ...pending,
      messageId: ack.messageId,
      sentAt: ack.sentAt,
      status: "sent",
    };
    bucket.set(key, sent);
    this.bumpLastMessage(sent as ChatMessage);
    this.changed();
  }

  private bumpLastMessage(m: ChatMessage): void {
    const summary = this.conversations.get(m.conversationId);
    if (!summary) return;
    const last = summary.lastMessage;
    if (last && compareTimeuuid(last.messageId, m.messageId) >= 0) return;
    this.conversations.set(m.conversationId, {
      ...summary,
      lastMessage: { messageId: m.messageId, sender: m.sender, preview: m.body.slice(0, 80) },
    });
  }

  timeline(conversationId: string): LocalMessage[] {
    return [...(this.messages.get(conversationId)?.values() ?? [])].sort(byTime);
  }

  oldestId(conversationId: string): string | undefined {
    return this.timeline(conversationId).find((m) => m.messageId)?.messageId ?? undefined;
  }

  newestId(conversationId: string): string | undefined {
    return (
      this.timeline(conversationId)
        .filter((m) => m.messageId)
        .at(-1)?.messageId ?? undefined
    );
  }
}

// Re-renders on any store change; fine for an app this size.
export function useStore<T extends ChatStore>(store: T): T {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
