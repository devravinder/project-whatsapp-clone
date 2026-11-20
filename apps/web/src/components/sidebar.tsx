import { useState } from "react";
import type { ChatClient } from "../chat-client.js";
import { type Connection, useStore } from "../store.js";

export function Sidebar({ client, onLogout }: { client: ChatClient; onLogout: () => void }) {
  const store = useStore(client.store);
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function startChat(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const id = await client.startDirect(other);
      setOther("");
      await client.open(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <aside className="flex w-80 flex-col border-r bg-white">
      <header className="flex items-center justify-between bg-[#f0f2f5] px-4 py-3">
        <span>
          <span className="block font-semibold">{client.username}</span>
          <ConnectionBadge connection={store.connection} serverId={store.serverId} />
        </span>
        <button className="text-sm text-gray-600 hover:underline" onClick={onLogout}>
          Switch user
        </button>
      </header>

      <form className="border-b p-3" onSubmit={startChat}>
        <label className="sr-only" htmlFor="new-chat">
          Start a chat with
        </label>
        <div className="flex gap-2">
          <input
            id="new-chat"
            className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
            placeholder="Start chat with username"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            required
          />
          <button className="rounded bg-[#008069] px-3 text-sm text-white">Chat</button>
        </div>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </form>

      <ul className="flex-1 overflow-y-auto">
        {store.sortedConversations().map((c) => (
          <li key={c.conversationId}>
            <button
              className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-[#f5f6f6] ${
                store.activeId === c.conversationId ? "bg-[#f0f2f5]" : ""
              }`}
              onClick={() => void client.open(c.conversationId)}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] font-semibold uppercase text-gray-600">
                {c.title.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.title}</span>
                <span className="block truncate text-sm text-gray-600">
                  {c.lastMessage
                    ? `${c.lastMessage.sender === client.username ? "You" : c.lastMessage.sender}: ${c.lastMessage.preview}`
                    : "No messages yet"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ConnectionBadge({
  connection,
  serverId,
}: {
  connection: Connection;
  serverId: string | null;
}) {
  const label =
    connection === "online"
      ? `online via ${serverId}`
      : connection === "connecting"
        ? "connecting…"
        : "offline";
  const color = connection === "online" ? "text-green-700" : "text-amber-700";
  return (
    <span className={`block text-xs ${color}`} role="status">
      {label}
    </span>
  );
}
