import { z } from "zod";
import { clientMsgIdSchema, conversationIdSchema, timeuuidSchema, usernameSchema } from "./ids.js";

export const MAX_BODY_LENGTH = 4096;
export const MAX_GROUP_MEMBERS = 256;
export const PREVIEW_LENGTH = 80;

export const messageKindSchema = z.enum(["text", "system"]);

export const chatMessageSchema = z.object({
  messageId: timeuuidSchema,
  conversationId: conversationIdSchema,
  sender: usernameSchema,
  clientMsgId: clientMsgIdSchema,
  kind: messageKindSchema,
  body: z.string(),
  sentAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const receiptStatusSchema = z.enum(["delivered", "read"]);
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

export const receiptSchema = z.object({
  conversationId: conversationIdSchema,
  username: usernameSchema,
  status: receiptStatusSchema,
  // Watermark: everything up to and including this message.
  upTo: timeuuidSchema,
});
export type Receipt = z.infer<typeof receiptSchema>;

export type ConversationKind = "direct" | "group";

export type LastMessage = {
  messageId: string;
  sender: string;
  preview: string;
};

export type ConversationSummary = {
  conversationId: string;
  kind: ConversationKind;
  title: string;
  lastMessage: LastMessage | null;
  unread: number;
};

export type MemberState = {
  username: string;
  role: "admin" | "member";
  deliveredUpTo: string | null;
  readUpTo: string | null;
};

export type ConversationDetail = {
  conversationId: string;
  kind: ConversationKind;
  title: string;
  createdBy: string;
  members: MemberState[];
};

export type MessagePage = { messages: ChatMessage[]; hasMore: boolean };

export type SendAck = {
  clientMsgId: string;
  conversationId: string;
  messageId: string;
  sentAt: string;
};

export type Presence = { username: string; online: boolean; lastSeen: string | null };
