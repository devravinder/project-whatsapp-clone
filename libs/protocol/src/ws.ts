import { z } from "zod";
import { clientMsgIdSchema, conversationIdSchema, timeuuidSchema, usernameSchema } from "./ids.js";
import {
  type ChatMessage,
  type Presence,
  type Receipt,
  receiptStatusSchema,
  type SendAck,
} from "./model.js";
import { messageBodySchema } from "./rest.js";

export const WS_PATH = "/ws";

// Close codes 4000-4999 are free for applications.
export const CLOSE = { badHello: 4000, unknownUser: 4001, helloTimeout: 4002 } as const;

// A "typing" frame at most this often per conversation; the indicator lasts a bit longer.
export const TYPING_THROTTLE_MS = 2000;
export const TYPING_SHOWN_MS = 4000;

export const clientEventSchema = z.discriminatedUnion("type", [
  // Must be the first frame: names the user on this socket (no login, ADR-007).
  z.object({ type: z.literal("hello"), username: usernameSchema }),
  z.object({
    type: z.literal("send"),
    conversationId: conversationIdSchema,
    clientMsgId: clientMsgIdSchema,
    body: messageBodySchema,
  }),
  // Replaces the set of users whose presence this socket follows.
  z.object({ type: z.literal("watch"), usernames: z.array(usernameSchema).max(500) }),
  // "I have received / read everything up to upTo."
  z.object({
    type: z.literal("receipt"),
    conversationId: conversationIdSchema,
    status: receiptStatusSchema,
    upTo: timeuuidSchema,
  }),
  z.object({ type: z.literal("typing"), conversationId: conversationIdSchema }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

export type ServerEvent =
  | { type: "ready"; username: string; serverId: string }
  | ({ type: "ack" } & SendAck)
  | { type: "nack"; clientMsgId: string; reason: string; retryable: boolean }
  | { type: "message"; message: ChatMessage }
  | ({ type: "presence" } & Presence)
  | ({ type: "receipt" } & Receipt)
  | { type: "typing"; conversationId: string; username: string }
  | { type: "error"; reason: string };
