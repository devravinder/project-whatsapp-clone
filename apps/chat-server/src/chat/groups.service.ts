import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type ConversationSummary, MAX_GROUP_MEMBERS } from "@wa/protocol";
import { ChatRepository, type Conversation } from "./chat.repository.js";
import { MessagesService } from "./messages.service.js";
import { UsersService } from "./users.service.js";

@Injectable()
export class GroupsService {
  constructor(
    @Inject(ChatRepository) private readonly repo: ChatRepository,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(MessagesService) private readonly messages: MessagesService,
  ) {}

  async create(me: string, title: string, invited: string[]): Promise<ConversationSummary> {
    const others = [...new Set(invited)].filter((u) => u !== me);
    if (others.length + 1 > MAX_GROUP_MEMBERS) {
      throw new BadRequestException(`a group has at most ${MAX_GROUP_MEMBERS} members`);
    }
    const missing = await this.users.missing(others);
    if (missing.length > 0) throw new NotFoundException(`no such users: ${missing.join(", ")}`);
    const conversation: Conversation = {
      conversationId: `grp:${randomUUID()}`,
      kind: "group",
      title,
      createdBy: me,
    };
    await this.repo.createConversation(
      conversation,
      [
        { username: me, role: "admin" },
        ...others.map((u) => ({ username: u, role: "member" as const })),
      ],
      () => title,
    );
    await this.announce(conversation.conversationId, me, `${me} created the group "${title}"`);
    return {
      conversationId: conversation.conversationId,
      kind: "group",
      title,
      lastMessage: null,
      unread: 0,
    };
  }

  async addMember(me: string, groupId: string, username: string): Promise<void> {
    const { conversation, members } = await this.load(groupId);
    this.requireAdmin(members, me);
    if (members.some((m) => m.username === username))
      throw new ConflictException(`${username} is already a member`);
    if (members.length >= MAX_GROUP_MEMBERS) {
      throw new BadRequestException(`a group has at most ${MAX_GROUP_MEMBERS} members`);
    }
    await this.users.require(username);
    await this.repo.addMember(conversation, { username, role: "member" }, conversation.title);
    await this.announce(groupId, me, `${me} added ${username}`);
  }

  // Admins remove anyone; everyone can remove themselves (leave).
  async removeMember(me: string, groupId: string, username: string): Promise<void> {
    const { members } = await this.load(groupId);
    if (username !== me) this.requireAdmin(members, me);
    const target = members.find((m) => m.username === username);
    if (!target) throw new NotFoundException(`${username} is not a member`);
    await this.repo.removeMember(groupId, username);

    const remaining = members.filter((m) => m.username !== username);
    let note = "";
    // A group must keep an admin; promote someone when the last one leaves.
    if (
      target.role === "admin" &&
      remaining.length > 0 &&
      !remaining.some((m) => m.role === "admin")
    ) {
      const heir = remaining.map((m) => m.username).sort()[0]!;
      await this.repo.setRole(groupId, heir, "admin");
      note = `; ${heir} is now an admin`;
    }
    const text = username === me ? `${me} left` : `${me} removed ${username}`;
    // The removed member is no longer in the fan-out list, so name them explicitly.
    await this.announce(groupId, me, text + note, [username]);
  }

  private async load(groupId: string) {
    const conversation = await this.repo.getConversation(groupId);
    if (!conversation || conversation.kind !== "group")
      throw new NotFoundException("no such group");
    return { conversation, members: await this.repo.members(groupId) };
  }

  private requireAdmin(members: { username: string; role: string }[], me: string): void {
    const mine = members.find((m) => m.username === me);
    if (!mine) throw new ForbiddenException("not a member of this group");
    if (mine.role !== "admin") throw new ForbiddenException("only admins can do that");
  }

  // Membership changes travel as system messages: ordered with the chat and pushed to everyone.
  private announce(groupId: string, actor: string, body: string, alsoNotify: string[] = []) {
    return this.messages.send({
      sender: actor,
      conversationId: groupId,
      clientMsgId: randomUUID(),
      body,
      kind: "system",
      alsoNotify,
    });
  }
}
