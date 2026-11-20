import { useEffect, useRef, useState } from "react";
import type { ChatClient } from "../chat-client.js";
import { type LocalMessage, messageKey, useStore } from "../store.js";

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ChatPane({
  client,
  conversationId,
}: {
  client: ChatClient;
  conversationId: string;
}) {
  const store = useStore(client.store);
  const detail = store.details.get(conversationId);
  const summary = store.conversations.get(conversationId);
  const timeline = store.timeline(conversationId);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const newest = timeline.at(-1);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [newest && messageKey(newest), newest?.status]);

  return (
    <section className="flex flex-1 flex-col">
      <header className="bg-[#f0f2f5] px-4 py-3">
        <h2 className="font-semibold">{detail?.title ?? summary?.title ?? conversationId}</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        {store.hasOlder.get(conversationId) && (
          <div className="mb-3 text-center">
            <button
              className="rounded bg-white px-3 py-1 text-sm shadow"
              onClick={() => void client.loadOlder(conversationId)}
            >
              Load older messages
            </button>
          </div>
        )}
        {timeline.map((m) => (
          <Bubble key={messageKey(m)} message={m} mine={m.sender === client.username} />
        ))}
        <div ref={bottom} />
      </div>

      <Composer
        onSend={async (body) => {
          setError(null);
          try {
            await client.send(conversationId, body);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {error && <p className="bg-red-50 px-4 py-1 text-sm text-red-700">{error}</p>}
    </section>
  );
}

function Bubble({ message, mine }: { message: LocalMessage; mine: boolean }) {
  if (message.kind === "system") {
    return (
      <p className="my-2 text-center">
        <span className="rounded bg-[#ffeecd] px-2 py-1 text-xs text-gray-700">{message.body}</span>
      </p>
    );
  }
  return (
    <div className={`my-1 flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[65%] rounded-lg px-3 py-1.5 shadow-sm ${mine ? "bg-[#d9fdd3]" : "bg-white"}`}
      >
        {!mine && <p className="text-xs font-semibold text-[#008069]">{message.sender}</p>}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className="mt-0.5 text-right text-[11px] text-gray-500">
          {timeOf(message.sentAt)}
          {mine && <span className="ml-1">{message.status === "pending" ? "🕓" : "✓"}</span>}
        </p>
      </div>
    </div>
  );
}

function Composer({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex gap-2 bg-[#f0f2f5] px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        const body = text.trim();
        if (!body) return;
        setText("");
        void onSend(body);
      }}
    >
      <label className="sr-only" htmlFor="composer">
        Message
      </label>
      <input
        id="composer"
        autoComplete="off"
        className="flex-1 rounded-lg px-3 py-2"
        placeholder="Type a message"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="rounded-lg bg-[#008069] px-4 text-white">Send</button>
    </form>
  );
}
