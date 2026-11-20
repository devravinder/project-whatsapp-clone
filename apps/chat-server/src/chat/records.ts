import { chatMessageSchema, receiptSchema, usernameSchema } from "@wa/protocol";
import { z } from "zod";

// Value of a chat.messages record.
export const messageRecordSchema = chatMessageSchema.extend({
  // Not members any more, but must still hear about it (e.g. "alice removed bob").
  alsoNotify: z.array(usernameSchema).optional(),
});
export type MessageRecord = z.infer<typeof messageRecordSchema>;

// Value of a chat.receipts record.
export const receiptRecordSchema = receiptSchema;
