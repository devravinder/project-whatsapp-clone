import { type ServerEvent, WS_PATH, type ClientEvent, type SendAck } from "@wa/protocol";
import { type Api, api } from "./api.js";
import { ChatStore } from "./store.js";

const HISTORY_PAGE = 50;
const RECONNECT_MS = 2000;

type Waiter = { resolve: (ack: SendAck) => void; reject: (error: Error) => void };

// Talks to the server and keeps the store up to date.
export class ChatClient {
  readonly store = new ChatStore();
  readonly api: Api;
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiting = new Map<string, Waiter>();

  constructor(readonly username: string) {
    this.api = api(username);
  }

  start(): void {
    this.stopped = false;
    void this.refreshConversations();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "logout");
  }

  private connect(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}${WS_PATH}`);
    this.socket = socket;
    this.store.setConnection("connecting");
    socket.onopen = () => this.emit({ type: "hello", username: this.username });
    socket.onmessage = (event) => this.onEvent(JSON.parse(event.data) as ServerEvent);
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.store.setConnection("offline");
      for (const [, waiter] of this.waiting) waiter.reject(new Error("connection lost"));
      this.waiting.clear();
      if (!this.stopped) this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  private emit(event: ClientEvent): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(event));
    return true;
  }

  private onEvent(event: ServerEvent): void {
    switch (event.type) {
      case "ready":
        this.store.setConnection("online", event.serverId);
        void this.catchUp();
        break;
      case "message": {
        this.store.addMessages([event.message]);
        if (!this.store.conversations.has(event.message.conversationId)) {
          void this.refreshConversations();
        }
        break;
      }
      case "ack": {
        this.store.acknowledge(this.username, event);
        this.waiting.get(event.clientMsgId)?.resolve(event);
        this.waiting.delete(event.clientMsgId);
        break;
      }
      case "nack": {
        this.waiting.get(event.clientMsgId)?.reject(new Error(event.reason));
        this.waiting.delete(event.clientMsgId);
        break;
      }
      case "error":
        console.warn("server:", event.reason);
        break;
    }
  }

  // Messages sent while this tab was disconnected are not pushed again; fetch them.
  private async catchUp(): Promise<void> {
    await this.refreshConversations();
    const active = this.store.activeId;
    if (!active) return;
    const after = this.store.newestId(active);
    const page = await this.api.history(
      active,
      after ? { after, limit: 100 } : { limit: HISTORY_PAGE },
    );
    this.store.addMessages(page.messages);
  }

  async refreshConversations(): Promise<void> {
    this.store.setConversations(await this.api.conversations());
  }

  async startDirect(other: string): Promise<string> {
    const summary = await this.api.startDirect(other.trim().toLowerCase());
    this.store.upsertConversation(summary);
    return summary.conversationId;
  }

  async open(conversationId: string): Promise<void> {
    this.store.setActive(conversationId);
    const [detail, page] = await Promise.all([
      this.api.detail(conversationId),
      this.api.history(conversationId, { limit: HISTORY_PAGE }),
    ]);
    this.store.setDetail(detail);
    this.store.addMessages(page.messages);
    if (!this.store.hasOlder.has(conversationId))
      this.store.hasOlder.set(conversationId, page.hasMore);
  }

  async loadOlder(conversationId: string): Promise<void> {
    const before = this.store.oldestId(conversationId);
    const page = await this.api.history(conversationId, { before, limit: HISTORY_PAGE });
    this.store.hasOlder.set(conversationId, page.hasMore);
    this.store.addMessages(page.messages);
  }

  async send(conversationId: string, body: string): Promise<void> {
    const clientMsgId = crypto.randomUUID();
    this.store.addPending({
      conversationId,
      clientMsgId,
      sender: this.username,
      kind: "text",
      body,
      sentAt: new Date().toISOString(),
      messageId: null,
      status: "pending",
    });
    try {
      const ack = await this.sendOnce(conversationId, clientMsgId, body);
      this.store.acknowledge(this.username, ack);
    } catch (error) {
      this.store.fail(this.username, conversationId, clientMsgId);
      throw error;
    }
  }

  // WebSocket when connected, REST otherwise; the server treats both the same.
  private sendOnce(conversationId: string, clientMsgId: string, body: string): Promise<SendAck> {
    const viaSocket = new Promise<SendAck>((resolve, reject) => {
      this.waiting.set(clientMsgId, { resolve, reject });
      if (!this.emit({ type: "send", conversationId, clientMsgId, body })) {
        this.waiting.delete(clientMsgId);
        reject(new Error("offline"));
      }
    });
    return viaSocket.catch((error: Error) => {
      if (error.message !== "offline") throw error;
      return this.api.send(conversationId, clientMsgId, body);
    });
  }
}
