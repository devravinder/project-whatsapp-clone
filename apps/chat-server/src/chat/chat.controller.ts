import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  addMemberSchema,
  conversationIdSchema,
  createGroupSchema,
  historyQuerySchema,
  registerUserSchema,
  sendMessageSchema,
  startDirectSchema,
  USERNAME_HEADER,
  usernameSchema,
} from "@wa/protocol";
import { Directory } from "../realtime/directory.js";
import { ConversationsService } from "./conversations.service.js";
import { GroupsService } from "./groups.service.js";
import { MessagesService } from "./messages.service.js";
import { parse } from "./parse.js";
import { UsersService } from "./users.service.js";

@Controller()
export class ChatController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(Directory) private readonly directory: Directory,
    @Inject(GroupsService) private readonly groups: GroupsService,
  ) {}

  // Registering an existing name just "logs in" as it.
  @Post("users")
  @HttpCode(200)
  register(@Body() body: unknown) {
    return this.users.register(parse(registerUserSchema, body).username);
  }

  @Get("users/:username")
  async user(@Param("username") username: string) {
    const name = parse(usernameSchema, username);
    await this.users.require(name);
    return { username: name };
  }

  @Get("users/:username/presence")
  async presence(@Param("username") username: string) {
    const name = parse(usernameSchema, username);
    await this.users.require(name);
    return this.directory.presence(name);
  }

  @Get("conversations")
  async list(@Headers(USERNAME_HEADER) header?: string) {
    return this.conversations.list(await this.users.caller(header));
  }

  @Post("conversations/direct")
  @HttpCode(200)
  async startDirect(@Body() body: unknown, @Headers(USERNAME_HEADER) header?: string) {
    const me = await this.users.caller(header);
    return this.conversations.startDirect(me, parse(startDirectSchema, body).with);
  }

  @Get("conversations/:id")
  async detail(@Param("id") id: string, @Headers(USERNAME_HEADER) header?: string) {
    const me = await this.users.caller(header);
    return this.conversations.detail(parse(conversationIdSchema, id), me);
  }

  @Get("conversations/:id/messages")
  async history(
    @Param("id") id: string,
    @Query() query: unknown,
    @Headers(USERNAME_HEADER) header?: string,
  ) {
    const me = await this.users.caller(header);
    return this.conversations.history(
      parse(conversationIdSchema, id),
      me,
      parse(historyQuerySchema, query),
    );
  }

  // Same path as the WebSocket send; handy from http/chat-server.http.
  @Post("conversations/:id/messages")
  @HttpCode(202)
  async send(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers(USERNAME_HEADER) header?: string,
  ) {
    const sender = await this.users.caller(header);
    const { clientMsgId, body: text } = parse(sendMessageSchema, body);
    return this.messages.send({
      sender,
      conversationId: parse(conversationIdSchema, id),
      clientMsgId,
      body: text,
    });
  }

  @Post("groups")
  @HttpCode(201)
  async createGroup(@Body() body: unknown, @Headers(USERNAME_HEADER) header?: string) {
    const me = await this.users.caller(header);
    const { title, members } = parse(createGroupSchema, body);
    return this.groups.create(me, title, members);
  }

  @Post("groups/:id/members")
  @HttpCode(204)
  async addMember(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers(USERNAME_HEADER) header?: string,
  ) {
    const me = await this.users.caller(header);
    await this.groups.addMember(
      me,
      parse(conversationIdSchema, id),
      parse(addMemberSchema, body).username,
    );
  }

  @Delete("groups/:id/members/:username")
  @HttpCode(204)
  async removeMember(
    @Param("id") id: string,
    @Param("username") username: string,
    @Headers(USERNAME_HEADER) header?: string,
  ) {
    const me = await this.users.caller(header);
    await this.groups.removeMember(
      me,
      parse(conversationIdSchema, id),
      parse(usernameSchema, username),
    );
  }
}
