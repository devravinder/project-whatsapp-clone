import type { Presence } from "@wa/protocol";

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function lastSeenText(presence: Presence | undefined): string {
  if (!presence) return "";
  if (presence.online) return "online";
  if (!presence.lastSeen) return "offline";
  const seen = new Date(presence.lastSeen);
  const sameDay = seen.toDateString() === new Date().toDateString();
  return sameDay
    ? `last seen today at ${timeOf(presence.lastSeen)}`
    : `last seen ${seen.toLocaleDateString()} at ${timeOf(presence.lastSeen)}`;
}
