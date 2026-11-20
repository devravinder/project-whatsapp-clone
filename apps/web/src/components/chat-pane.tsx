import type { ConversationDetail } from "@wa/protocol";
import { useEffect, useRef, useState } from "react";
import type { ChatClient } from "../chat-client.js";
import { lastSeenText, timeOf } from "../format.js";
import { type LocalMessage, messageKey, useStore } from "../store.js";
import { tickOf, tickTitle } from "../ticks.js";
import { GroupInfo } from "./group-info.js";

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
  const bottom = useRef<HTMLDivElement>(null);
  const newest = timeline.at(-1);
  const title = detail?.title ?? summary?.title ?? conversationId;
  const typing = store.typingIn(conversationId);
  const isGroup = (detail?.kind ?? summary?.kind) === "group";
  const left = store.left.has(conversationId);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [newest && messageKey(newest), newest?.status]);

  const subtitle =
    typing.length > 0
      ? isGroup
        ? `${typing.join(", ")} ${typing.length === 1 ? "is" : "are"} typing…`
        : "typing…"
      : isGroup
        ? (detail?.members.map((m) => m.username).join(", ") ?? "")
        : lastSeenText(store.presence.get(title));

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 bg-[#f0f2f5] px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            <p className="truncate text-xs text-gray-600" aria-live="polite">
              {subtitle}
            </p>
          </div>
          {isGroup && detail && !left && (
            <button
              className="shrink-0 text-sm text-[#008069] hover:underline"
              onClick={() => setShowInfo((v) => !v)}
            >
              Group info
            </button>
          )}
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
            <Bubble
              key={messageKey(m)}
              message={m}
              me={client.username}
              detail={detail}
              showSender={isGroup}
              onRetry={() => client.retry(m)}
            />
          ))}
          <div ref={bottom} />
        </div>

        {left ? (
          <p className="bg-[#f0f2f5] px-4 py-3 text-center text-sm text-gray-600">
            You are no longer a member of this group.
          </p>
        ) : (
          <Composer
            onTyping={() => client.typing(conversationId)}
            onSend={(body) => client.send(conversationId, body)}
          />
        )}
      </section>
      {showInfo && isGroup && detail && !left && (
        <GroupInfo client={client} detail={detail} onClose={() => setShowInfo(false)} />
      )}
    </div>
  );
}

function Bubble({
  message,
  me,
  detail,
  showSender,
  onRetry,
}: {
  message: LocalMessage;
  me: string;
  detail: ConversationDetail | undefined;
  showSender: boolean;
  onRetry: () => void;
}) {
  if (message.kind === "system") {
    return (
      <p className="my-2 text-center">
        <span className="rounded bg-[#ffeecd] px-2 py-1 text-xs text-gray-700">{message.body}</span>
      </p>
    );
  }
  const mine = message.sender === me;
  return (
    <div className={`my-1 flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[65%] rounded-lg px-3 py-1.5 shadow-sm ${mine ? "bg-[#d9fdd3]" : "bg-white"}`}
      >
        {!mine && showSender && (
          <p className="text-xs font-semibold text-[#008069]">{message.sender}</p>
        )}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className="mt-0.5 text-right text-[11px] text-gray-500">
          {timeOf(message.sentAt)}
          {mine && <Ticks message={message} detail={detail} me={me} />}
          {mine && message.status === "failed" && (
            <button className="ml-2 text-red-700 underline" onClick={onRetry}>
              Retry
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

const TICK_GLYPH = { pending: "🕓", failed: "!", sent: "✓", delivered: "✓✓", read: "✓✓" } as const;

function Ticks({
  message,
  detail,
  me,
}: {
  message: LocalMessage;
  detail: ConversationDetail | undefined;
  me: string;
}) {
  const info = tickOf(message, detail, me);
  const color =
    info.tick === "read"
      ? "text-[#53bdeb]"
      : info.tick === "failed"
        ? "font-bold text-red-700"
        : "text-gray-500";
  // The title doubles as the "message info" for groups: who read, who has it, who is waiting.
  return (
    <span className={`ml-1 ${color}`} title={tickTitle(info)} data-tick={info.tick}>
      {TICK_GLYPH[info.tick]}
    </span>
  );
}

function Composer({ onSend, onTyping }: { onSend: (body: string) => void; onTyping: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex gap-2 bg-[#f0f2f5] px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        const body = text.trim();
        if (!body) return;
        setText("");
        onSend(body);
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
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value) onTyping();
        }}
      />
      <button className="rounded-lg bg-[#008069] px-4 text-white">Send</button>
    </form>
  );
}
