import type { ConversationSummary } from "@wa/protocol";
import { Dexie, type EntityTable } from "dexie";
import { type LocalMessage, messageKey } from "./store.js";

export type StoredMessage = LocalMessage & { key: string };
// Newest message fetched with no gap before it: the next sync asks for everything after it.
export type Cursor = { conversationId: string; syncedUpTo: string };

// One database per user, so switching users in a tab never mixes histories.
export class LocalDb extends Dexie {
  messages!: EntityTable<StoredMessage, "key">;
  conversations!: EntityTable<ConversationSummary, "conversationId">;
  cursors!: EntityTable<Cursor, "conversationId">;

  constructor(username: string) {
    super(`wa-${username}`);
    this.version(1).stores({
      messages: "key, conversationId, status",
      conversations: "conversationId",
      cursors: "conversationId",
    });
  }

  saveMessages(messages: LocalMessage[]): Promise<unknown> {
    return this.messages.bulkPut(messages.map((m) => ({ ...m, key: messageKey(m) })));
  }

  // The extra key field is harmless in the store and rewritten on the next save.
  loadMessages(): Promise<LocalMessage[]> {
    return this.messages.toArray();
  }
}
