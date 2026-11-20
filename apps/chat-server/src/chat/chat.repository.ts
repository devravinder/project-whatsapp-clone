import { Inject, Injectable } from "@nestjs/common";
import {
  type ChatMessage,
  type ConversationKind,
  type ConversationSummary,
  PREVIEW_LENGTH,
} from "@wa/protocol";
import cassandra from "cassandra-driver";
import { CassandraService } from "../infra/cassandra.js";

const { TimeUuid, Long } = cassandra.types;
const PREPARED = { prepare: true };

export type Member = { username: string; role: "admin" | "member" };
export type Conversation = {
  conversationId: string;
  kind: ConversationKind;
  title: string;
  createdBy: string;
};

// Write time in microseconds taken from the message id: later message = later timestamp.
export function writeTimeOf(messageId: string): cassandra.types.Long {
  const { date, ticks } = TimeUuid.fromString(messageId).getDatePrecision();
  return Long.fromNumber(date.getTime() * 1000 + Math.floor(ticks / 10));
}

export function newMessageId(): { messageId: string; sentAt: string } {
  const id = TimeUuid.now();
  return { messageId: id.toString(), sentAt: id.getDate().toISOString() };
}

const preview = (body: string) =>
  body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH - 1)}…` : body;

function toMessage(conversationId: string, row: cassandra.types.Row): ChatMessage {
  const id = row.get("message_id") as cassandra.types.TimeUuid;
  return {
    messageId: id.toString(),
    conversationId,
    sender: row.get("sender"),
    clientMsgId: row.get("client_msg_id"),
    kind: row.get("kind"),
    body: row.get("body"),
    sentAt: id.getDate().toISOString(),
  };
}

@Injectable()
export class ChatRepository {
  constructor(@Inject(CassandraService) private readonly cassandra: CassandraService) {}

  private get db() {
    return this.cassandra.client;
  }

  // Lightweight transaction: a Paxos round, so two tabs registering "bob" cannot both win.
  async registerUser(username: string): Promise<boolean> {
    const result = await this.db.execute(
      "INSERT INTO users (username, created_at) VALUES (?, toTimestamp(now())) IF NOT EXISTS",
      [username],
      PREPARED,
    );
    return result.wasApplied();
  }

  async usersExist(usernames: string[]): Promise<Set<string>> {
    if (usernames.length === 0) return new Set();
    const result = await this.db.execute(
      "SELECT username FROM users WHERE username IN ?",
      [usernames],
      PREPARED,
    );
    return new Set(result.rows.map((row) => row.get("username") as string));
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const row = (
      await this.db.execute(
        "SELECT kind, title, created_by FROM conversations WHERE conversation_id = ?",
        [conversationId],
        PREPARED,
      )
    ).first();
    if (!row) return null;
    return {
      conversationId,
      kind: row.get("kind"),
      title: row.get("title"),
      createdBy: row.get("created_by"),
    };
  }

  async members(conversationId: string): Promise<Member[]> {
    const result = await this.db.execute(
      "SELECT username, role FROM members_by_conversation WHERE conversation_id = ?",
      [conversationId],
      PREPARED,
    );
    return result.rows.map((row) => ({ username: row.get("username"), role: row.get("role") }));
  }

  async isMember(conversationId: string, username: string): Promise<boolean> {
    const result = await this.db.execute(
      "SELECT username FROM members_by_conversation WHERE conversation_id = ? AND username = ?",
      [conversationId, username],
      PREPARED,
    );
    return result.rowLength > 0;
  }

  // Each statement is an idempotent upsert, so a retried or repeated create is harmless.
  async createConversation(
    conversation: Conversation,
    members: Member[],
    titleFor: (username: string) => string,
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO conversations (conversation_id, kind, title, created_by, created_at) VALUES (?, ?, ?, ?, toTimestamp(now())) IF NOT EXISTS",
      [conversation.conversationId, conversation.kind, conversation.title, conversation.createdBy],
      PREPARED,
    );
    for (const member of members) {
      await this.addMember(conversation, member, titleFor(member.username));
    }
  }

  async addMember(conversation: Conversation, member: Member, title: string): Promise<void> {
    await this.db.batch(
      [
        {
          query:
            "INSERT INTO members_by_conversation (conversation_id, username, role, joined_at) VALUES (?, ?, ?, toTimestamp(now()))",
          params: [conversation.conversationId, member.username, member.role],
        },
        {
          query:
            "INSERT INTO conversations_by_user (username, conversation_id, kind, title) VALUES (?, ?, ?, ?)",
          params: [member.username, conversation.conversationId, conversation.kind, title],
        },
      ],
      PREPARED,
    );
  }

  async setRole(conversationId: string, username: string, role: Member["role"]): Promise<void> {
    await this.db.execute(
      "UPDATE members_by_conversation SET role = ? WHERE conversation_id = ? AND username = ?",
      [role, conversationId, username],
      PREPARED,
    );
  }

  // Logged batch: both rows go, or neither does, even across two partitions.
  async removeMember(conversationId: string, username: string): Promise<void> {
    await this.db.batch(
      [
        {
          query: "DELETE FROM members_by_conversation WHERE conversation_id = ? AND username = ?",
          params: [conversationId, username],
        },
        {
          query: "DELETE FROM conversations_by_user WHERE username = ? AND conversation_id = ?",
          params: [username, conversationId],
        },
      ],
      PREPARED,
    );
  }

  async conversationsOf(username: string): Promise<Omit<ConversationSummary, "unread">[]> {
    const result = await this.db.execute(
      "SELECT conversation_id, kind, title, last_message_id, last_sender, last_preview FROM conversations_by_user WHERE username = ?",
      [username],
      PREPARED,
    );
    return result.rows.map((row) => {
      const last = row.get("last_message_id") as cassandra.types.TimeUuid | null;
      return {
        conversationId: row.get("conversation_id"),
        kind: row.get("kind"),
        title: row.get("title"),
        lastMessage: last
          ? {
              messageId: last.toString(),
              sender: row.get("last_sender"),
              preview: row.get("last_preview"),
            }
          : null,
      };
    });
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    await this.db.execute(
      "INSERT INTO messages_by_conversation (conversation_id, message_id, sender, client_msg_id, kind, body) VALUES (?, ?, ?, ?, ?, ?)",
      [
        message.conversationId,
        message.messageId,
        message.sender,
        message.clientMsgId,
        message.kind,
        message.body,
      ],
      PREPARED,
    );
  }

  // Fan-out on write: one cell update per member, so listing conversations is one partition read.
  async updateLastMessage(message: ChatMessage, usernames: string[]): Promise<void> {
    const writeTime = writeTimeOf(message.messageId);
    await Promise.all(
      usernames.map((username) =>
        this.db.execute(
          "UPDATE conversations_by_user USING TIMESTAMP ? SET last_message_id = ?, last_sender = ?, last_preview = ? WHERE username = ? AND conversation_id = ?",
          [
            writeTime,
            message.messageId,
            message.sender,
            preview(message.body),
            username,
            message.conversationId,
          ],
          PREPARED,
        ),
      ),
    );
  }

  async history(
    conversationId: string,
    query: { before?: string; after?: string; limit: number },
  ): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
    // One extra row tells whether another page exists.
    const fetch = query.limit + 1;
    const result = query.after
      ? await this.db.execute(
          "SELECT * FROM messages_by_conversation WHERE conversation_id = ? AND message_id > ? ORDER BY message_id ASC LIMIT ?",
          [conversationId, query.after, fetch],
          PREPARED,
        )
      : query.before
        ? await this.db.execute(
            "SELECT * FROM messages_by_conversation WHERE conversation_id = ? AND message_id < ? LIMIT ?",
            [conversationId, query.before, fetch],
            PREPARED,
          )
        : await this.db.execute(
            "SELECT * FROM messages_by_conversation WHERE conversation_id = ? LIMIT ?",
            [conversationId, fetch],
            PREPARED,
          );
    const rows = result.rows.slice(0, query.limit);
    const messages = rows.map((row) => toMessage(conversationId, row));
    // Always oldest first for the client.
    if (!query.after) messages.reverse();
    return { messages, hasMore: result.rowLength > query.limit };
  }
}
