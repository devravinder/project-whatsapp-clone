import { z } from "zod";

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, "3-20 characters: a-z, 0-9 or _");

// Both members derive the same id, so "start chat" is idempotent without a lookup.
export function directConversationId(a: string, b: string): string {
  const [first, second] = [a, b].sort();
  return `dm:${first}:${second}`;
}

export const conversationIdSchema = z
  .string()
  .regex(/^(dm:[a-z0-9_]{3,20}:[a-z0-9_]{3,20}|grp:[0-9a-f-]{36})$/, "not a conversation id");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const timeuuidSchema = z.string().regex(UUID, "not a uuid");

// Client-chosen id that makes a retried send idempotent.
export const clientMsgIdSchema = z.string().regex(UUID, "clientMsgId must be a uuid");

// A version-1 uuid's 60-bit timestamp; string order is not time order.
export function timeuuidTime(id: string): bigint {
  const hex = id.replace(/-/g, "");
  const low = BigInt(`0x${hex.slice(0, 8)}`);
  const mid = BigInt(`0x${hex.slice(8, 12)}`);
  const high = BigInt(`0x${hex.slice(12, 16)}`) & 0x0fffn;
  return (high << 48n) | (mid << 32n) | low;
}

export function compareTimeuuid(a: string, b: string): number {
  const diff = timeuuidTime(a) - timeuuidTime(b);
  if (diff !== 0n) return diff < 0n ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isAtOrAfter(watermark: string | null | undefined, messageId: string): boolean {
  return watermark != null && compareTimeuuid(watermark, messageId) >= 0;
}
