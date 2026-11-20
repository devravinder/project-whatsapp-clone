import { useEffect, useState } from "react";
import type { ChatClient } from "../chat-client.js";
import { useStore } from "../store.js";

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
          <ConnectionBadge client={client} />
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

      <NewGroup client={client} />

      <ul className="flex-1 overflow-y-auto">
        {store.sortedConversations().map((c) => (
          <li key={c.conversationId}>
            <button
              className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-[#f5f6f6] ${
                store.activeId === c.conversationId ? "bg-[#f0f2f5]" : ""
              }`}
              onClick={() => void client.open(c.conversationId)}
            >
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] font-semibold uppercase text-gray-600">
                {c.title.slice(0, 1)}
                {c.kind === "direct" && store.presence.get(c.title)?.online && (
                  <span
                    className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-green-500"
                    title="online"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.title}</span>
                <span className="block truncate text-sm text-gray-600">
                  {store.typingIn(c.conversationId).length > 0 ? (
                    <span className="text-[#008069]">typing…</span>
                  ) : c.lastMessage ? (
                    `${c.lastMessage.sender === client.username ? "You" : c.lastMessage.sender}: ${c.lastMessage.preview}`
                  ) : (
                    "No messages yet"
                  )}
                </span>
              </span>
              {c.unread > 0 && (
                <span
                  className="shrink-0 rounded-full bg-[#25d366] px-2 py-0.5 text-xs font-semibold text-white"
                  aria-label={`${c.unread} unread`}
                >
                  {c.unread >= 100 ? "99+" : c.unread}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ConnectionBadge({ client }: { client: ChatClient }) {
  const { connection, serverId, retryAt } = client.store;
  const [, tick] = useState(0);
  useEffect(() => {
    if (connection !== "offline") return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [connection]);

  if (connection === "online") {
    return (
      <span className="block text-xs text-green-700" role="status">
        online via {serverId}
      </span>
    );
  }
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0;
  return (
    <span className="block text-xs text-amber-700" role="status">
      {connection === "connecting" ? "connecting…" : `offline, retrying in ${seconds} s`}
      {connection === "offline" && (
        <button className="ml-2 underline" onClick={client.reconnectNow}>
          Retry now
        </button>
      )}
    </span>
  );
}

function NewGroup({ client }: { client: ChatClient }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        className="border-b px-3 py-2 text-left text-sm text-[#008069] hover:bg-[#f5f6f6]"
        onClick={() => setOpen(true)}
      >
        + New group
      </button>
    );
  }
  return (
    <form
      className="space-y-2 border-b p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        try {
          const usernames = members
            .split(/[\s,]+/)
            .map((u) => u.trim().toLowerCase())
            .filter(Boolean);
          const id = await client.createGroup(title.trim(), usernames);
          setTitle("");
          setMembers("");
          setOpen(false);
          await client.open(id);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <label className="block text-xs font-medium" htmlFor="group-title">
        Group name
      </label>
      <input
        id="group-title"
        className="w-full rounded border px-2 py-1 text-sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={60}
      />
      <label className="block text-xs font-medium" htmlFor="group-members">
        Members (comma separated)
      </label>
      <input
        id="group-members"
        className="w-full rounded border px-2 py-1 text-sm"
        value={members}
        onChange={(e) => setMembers(e.target.value)}
        placeholder="bob, carol"
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="rounded bg-[#008069] px-3 py-1 text-sm text-white">Create group</button>
        <button type="button" className="text-sm text-gray-600" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
