import { z } from "zod";
import { clientMsgIdSchema, timeuuidSchema, usernameSchema } from "./ids.js";
import { MAX_BODY_LENGTH, MAX_GROUP_MEMBERS } from "./model.js";

// No login: the caller names itself. Trusted only because this runs on your machine.
export const USERNAME_HEADER = "x-username";

export const registerUserSchema = z.object({ username: usernameSchema });

export const startDirectSchema = z.object({ with: usernameSchema });

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, "empty message")
  .max(MAX_BODY_LENGTH, `at most ${MAX_BODY_LENGTH} characters`);

export const sendMessageSchema = z.object({
  clientMsgId: clientMsgIdSchema,
  body: messageBodySchema,
});

export const historyQuerySchema = z
  .object({
    before: timeuuidSchema.optional(),
    after: timeuuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((q) => !(q.before && q.after), "use before or after, not both");

export const createGroupSchema = z.object({
  title: z.string().trim().min(1).max(60),
  // Creator is added automatically; the cap includes them.
  members: z.array(usernameSchema).max(MAX_GROUP_MEMBERS - 1),
});

export const addMemberSchema = z.object({ username: usernameSchema });
