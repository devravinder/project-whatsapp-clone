import { useEffect, useMemo } from "react";
import { ChatClient } from "../chat-client.js";
import { useStore } from "../store.js";
import { ChatPane } from "./chat-pane.js";
import { Sidebar } from "./sidebar.js";

export function ChatApp({ username, onLogout }: { username: string; onLogout: () => void }) {
  const client = useMemo(() => new ChatClient(username), [username]);
  const store = useStore(client.store);

  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);

  return (
    <div className="flex h-screen bg-[#eae6df] text-[#111b21]">
      <Sidebar client={client} onLogout={onLogout} />
      {store.activeId ? (
        <ChatPane key={store.activeId} client={client} conversationId={store.activeId} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-gray-500">
          Pick a conversation, or start a new chat.
        </div>
      )}
    </div>
  );
}
