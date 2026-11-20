import { z } from "zod";
import { clientMsgIdSchema, conversationIdSchema, usernameSchema } from "./ids.js";
import type { ChatMessage, Presence, SendAck } from "./model.js";
import { messageBodySchema } from "./rest.js";

export const WS_PATH = "/ws";

// Close codes 4000-4999 are free for applications.
export const CLOSE = { badHello: 4000, unknownUser: 4001, helloTimeout: 4002 } as const;

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
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

export type ServerEvent =
  | { type: "ready"; username: string; serverId: string }
  | ({ type: "ack" } & SendAck)
  | { type: "nack"; clientMsgId: string; reason: string; retryable: boolean }
  | { type: "message"; message: ChatMessage }
  | ({ type: "presence" } & Presence)
  | { type: "error"; reason: string };
