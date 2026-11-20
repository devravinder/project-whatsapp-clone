import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  compareTimeuuid,
  type ConversationDetail,
  type ConversationSummary,
  directConversationId,
  type MessagePage,
} from "@wa/protocol";
import { ChatRepository } from "./chat.repository.js";
import { UsersService } from "./users.service.js";

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(ChatRepository) private readonly repo: ChatRepository,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  async startDirect(me: string, other: string): Promise<ConversationSummary> {
    if (me === other) throw new BadRequestException("cannot start a chat with yourself");
    await this.users.require(other);
    const conversationId = directConversationId(me, other);
    // Each side sees the other's name as the title.
    await this.repo.createConversation(
      { conversationId, kind: "direct", title: "", createdBy: me },
      [
        { username: me, role: "member" },
        { username: other, role: "member" },
      ],
      (username) => (username === me ? other : me),
    );
    const mine = (await this.list(me)).find((c) => c.conversationId === conversationId);
    return mine!;
  }

  // Sorted here, not by Cassandra: a clustering key cannot change when a new message arrives.
  async list(me: string): Promise<ConversationSummary[]> {
    const rows = await this.repo.conversationsOf(me);
    const summaries = rows.map((row) => ({ ...row, unread: 0 }));
    return summaries.sort((a, b) => {
      if (!a.lastMessage || !b.lastMessage) return a.lastMessage ? -1 : b.lastMessage ? 1 : 0;
      return compareTimeuuid(b.lastMessage.messageId, a.lastMessage.messageId);
    });
  }

  async requireMember(conversationId: string, me: string): Promise<void> {
    if (!(await this.repo.isMember(conversationId, me))) {
      throw new ForbiddenException("not a member of this conversation");
    }
  }

  async detail(conversationId: string, me: string): Promise<ConversationDetail> {
    await this.requireMember(conversationId, me);
    const [conversation, members] = await Promise.all([
      this.repo.getConversation(conversationId),
      this.repo.members(conversationId),
    ]);
    const title =
      conversation!.kind === "direct"
        ? (members.find((m) => m.username !== me)?.username ?? conversation!.title)
        : conversation!.title;
    return {
      conversationId,
      kind: conversation!.kind,
      title,
      createdBy: conversation!.createdBy,
      members: members.map((m) => ({ ...m, deliveredUpTo: null, readUpTo: null })),
    };
  }

  async history(
    conversationId: string,
    me: string,
    query: { before?: string; after?: string; limit: number },
  ): Promise<MessagePage> {
    await this.requireMember(conversationId, me);
    return this.repo.history(conversationId, query);
  }
}
