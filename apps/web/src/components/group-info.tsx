import type { ConversationDetail } from "@wa/protocol";
import { useState } from "react";
import type { ChatClient } from "../chat-client.js";

export function GroupInfo({
  client,
  detail,
  onClose,
}: {
  client: ChatClient;
  detail: ConversationDetail;
  onClose: () => void;
}) {
  const [newMember, setNewMember] = useState("");
  const [error, setError] = useState<string | null>(null);
  const me = detail.members.find((m) => m.username === client.username);
  const isAdmin = me?.role === "admin";

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <aside className="flex w-72 flex-col border-l bg-white" aria-label="Group info">
      <header className="flex items-center justify-between bg-[#f0f2f5] px-4 py-3">
        <h3 className="font-semibold">Group info</h3>
        <button className="text-sm text-gray-600 hover:underline" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="px-4 pt-3 text-sm text-gray-600">
        {detail.members.length} members · created by {detail.createdBy}
      </p>
      <ul className="flex-1 overflow-y-auto px-4 py-2">
        {[...detail.members]
          .sort((a, b) => a.username.localeCompare(b.username))
          .map((m) => (
            <li key={m.username} className="flex items-center justify-between py-1 text-sm">
              <span>
                {m.username === client.username ? "You" : m.username}
                {m.role === "admin" && (
                  <span className="ml-2 rounded bg-[#d9fdd3] px-1 text-xs text-[#008069]">
                    admin
                  </span>
                )}
              </span>
              {isAdmin && m.username !== client.username && (
                <button
                  className="text-xs text-red-700 hover:underline"
                  onClick={() =>
                    void run(() => client.removeMember(detail.conversationId, m.username))
                  }
                >
                  Remove {m.username}
                </button>
              )}
            </li>
          ))}
      </ul>
      {isAdmin && (
        <form
          className="flex gap-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await client.addMember(detail.conversationId, newMember);
              setNewMember("");
            });
          }}
        >
          <label className="sr-only" htmlFor="add-member">
            Add member
          </label>
          <input
            id="add-member"
            className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
            placeholder="username"
            value={newMember}
            onChange={(e) => setNewMember(e.target.value)}
            required
          />
          <button className="rounded bg-[#008069] px-3 text-sm text-white">Add</button>
        </form>
      )}
      {error && <p className="px-3 pb-2 text-xs text-red-700">{error}</p>}
      <button
        className="m-3 rounded border border-red-700 py-1 text-sm text-red-700"
        onClick={() => void run(() => client.removeMember(detail.conversationId, client.username))}
      >
        Leave group
      </button>
    </aside>
  );
}
