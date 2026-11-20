import {
  type ClientEvent,
  isAtOrAfter,
  type ReceiptStatus,
  type SendAck,
  type ServerEvent,
  TYPING_THROTTLE_MS,
  WS_PATH,
} from "@wa/protocol";
import { type Api, ApiError, api } from "./api.js";
import { LocalDb } from "./local-db.js";
import { ChatStore, type LocalMessage, messageKey } from "./store.js";

const HISTORY_PAGE = 50;
const SYNC_PAGE = 100;
const SYNC_PARALLEL = 4;
// Batches receipts for messages arriving in a burst.
const RECEIPT_DELAY_MS = 200;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;
// A retryable failure while online (e.g. 409 still in flight) is tried again after this.
const RETRY_MS = 3000;

// Full jitter: a random wait up to an exponentially growing cap, so clients do not reconnect in step.
export const backoffDelay = (attempt: number, random = Math.random) =>
  Math.round(random() * Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt));

class SendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function asSendError(error: unknown): SendError {
  if (error instanceof SendError) return error;
  if (error instanceof ApiError) {
    return new SendError(error.message, error.status === 409 || error.status >= 500);
  }
  // fetch() throws TypeError when the network is down.
  return new SendError((error as Error).message, true);
}

type Waiter = { resolve: (ack: SendAck) => void; reject: (error: Error) => void };

// Talks to the server and keeps the store (and IndexedDB behind it) up to date.
export class ChatClient {
  readonly store = new ChatStore();
  readonly api: Api;
  private readonly db: LocalDb;
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly waiting = new Map<string, Waiter>();
  private watched = "";
  // Highest watermark already sent, per conversation and status.
  private readonly reported = new Map<string, string>();
  private readonly receiptQueue = new Set<string>();
  private receiptTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastTyping = new Map<string, number>();
  // One send at a time, in the order typed; inFlight stops the same message being queued twice.
  private outbox: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<string>();
  private syncing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // StrictMode mounts twice; only the latest start() may connect.
  private generation = 0;

  constructor(readonly username: string) {
    this.api = api(username);
    this.db = new LocalDb(username);
    this.store.persist = {
      messages: (messages) => void this.db.saveMessages(messages),
      conversations: (list, replaceAll) =>
        void this.db.transaction("rw", this.db.conversations, async () => {
          if (replaceAll) await this.db.conversations.clear();
          await this.db.conversations.bulkPut(list);
        }),
    };
  }

  async start(): Promise<void> {
    const generation = ++this.generation;
    this.stopped = false;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("online", this.reconnectNow);
    window.addEventListener("offline", this.dropSocket);
    const [messages, conversations] = await Promise.all([
      this.db.loadMessages(),
      this.db.conversations.toArray(),
    ]);
    if (generation !== this.generation || this.stopped) return;
    this.store.hydrate(messages, conversations);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("online", this.reconnectNow);
    window.removeEventListener("offline", this.dropSocket);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "logout");
  }

  // The browser says the network is back: skip the rest of the wait.
  reconnectNow = () => {
    if (this.stopped || this.socket || !this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connect();
  };

  private connect(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}${WS_PATH}`);
    this.socket = socket;
    this.store.setConnection("connecting");
    socket.onopen = () => this.emit({ type: "hello", username: this.username });
    socket.onmessage = (event) => this.onEvent(JSON.parse(event.data) as ServerEvent);
    socket.onclose = () => this.closed(socket);
  }

  // A dead network does not close a socket for minutes, and pings are invisible to page code.
  private dropSocket = () => {
    const socket = this.socket;
    if (!socket) return;
    socket.close();
    this.closed(socket);
  };

  private closed(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.watched = "";
    this.reported.clear();
    for (const [, waiter] of this.waiting) waiter.reject(new SendError("connection lost", true));
    this.waiting.clear();
    if (this.stopped) return;
    const delay = backoffDelay(this.attempt++);
    this.store.setConnection("offline", null, Date.now() + delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private emit(event: ClientEvent): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(event));
    return true;
  }

  private onEvent(event: ServerEvent): void {
    switch (event.type) {
      case "ready":
        this.attempt = 0;
        this.store.setConnection("online", event.serverId);
        void this.sync().catch((error: Error) => console.warn("sync failed:", error.message));
        break;
      case "message": {
        this.store.addMessages([event.message]);
        this.queueReceipts([event.message.conversationId]);
        if (event.message.kind === "system") {
          void this.membershipChanged(event.message.conversationId);
        } else if (!this.store.conversations.has(event.message.conversationId)) {
          void this.refreshConversations().catch(() => undefined);
        }
        break;
      }
      case "ack": {
        this.waiting.get(event.clientMsgId)?.resolve(event);
        this.waiting.delete(event.clientMsgId);
        break;
      }
      case "nack": {
        this.waiting.get(event.clientMsgId)?.reject(new SendError(event.reason, event.retryable));
        this.waiting.delete(event.clientMsgId);
        break;
      }
      case "receipt":
        this.store.applyReceipt(event);
        break;
      case "typing":
        this.store.setTyping(event.conversationId, event.username);
        break;
      case "presence":
        this.store.setPresence(event);
        break;
      case "error":
        console.warn("server:", event.reason);
        break;
    }
  }

  // Pushes are best effort: after every (re)connect, fetch whatever was missed, then flush the outbox.
  sync(): Promise<void> {
    this.syncing ??= this.syncAll().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async syncAll(): Promise<void> {
    await this.refreshConversations();
    const todo = this.store.sortedConversations().filter((c) => c.lastMessage);
    for (let i = 0; i < todo.length; i += SYNC_PARALLEL) {
      await Promise.all(
        todo
          .slice(i, i + SYNC_PARALLEL)
          .map((c) => this.syncConversation(c.conversationId, c.lastMessage!.messageId)),
      );
    }
    this.queueReceipts(todo.map((c) => c.conversationId));
    if (this.store.activeId) await this.loadDetail(this.store.activeId);
    this.flushOutbox();
  }

  // The cursor only moves over a gap-free run fetched from the server, never on a live push.
  private async syncConversation(conversationId: string, lastId: string): Promise<void> {
    const cursor = (await this.db.cursors.get(conversationId))?.syncedUpTo;
    if (cursor && isAtOrAfter(cursor, lastId)) return;
    let syncedUpTo = cursor;
    if (!syncedUpTo) {
      // First time on this device: the newest page now, older pages on demand.
      const page = await this.api.history(conversationId, { limit: HISTORY_PAGE });
      this.store.addMessages(page.messages);
      this.store.hasOlder.set(conversationId, page.hasMore);
      syncedUpTo = page.messages.at(-1)?.messageId;
    } else {
      for (let more = true; more;) {
        const page = await this.api.history(conversationId, {
          after: syncedUpTo,
          limit: SYNC_PAGE,
        });
        this.store.addMessages(page.messages);
        syncedUpTo = page.messages.at(-1)?.messageId ?? syncedUpTo;
        more = page.hasMore;
      }
    }
    if (syncedUpTo) await this.db.cursors.put({ conversationId, syncedUpTo });
  }

  async refreshConversations(): Promise<void> {
    this.store.setConversations(await this.api.conversations());
    this.updateWatch();
  }

  // Follow the presence of everyone we have a 1:1 chat with; resent only when the set changes.
  private updateWatch(): void {
    const usernames = [...new Set(this.store.directPartners())].sort();
    const key = usernames.join(",");
    if (key === this.watched) return;
    if (this.emit({ type: "watch", usernames })) this.watched = key;
  }

  async startDirect(other: string): Promise<string> {
    const summary = await this.api.startDirect(other.trim().toLowerCase());
    this.store.upsertConversation(summary);
    this.updateWatch();
    return summary.conversationId;
  }

  async open(conversationId: string): Promise<void> {
    this.store.setActive(conversationId);
    if (this.store.timeline(conversationId).length === 0) {
      const page = await this.api
        .history(conversationId, { limit: HISTORY_PAGE })
        .catch(() => null);
      if (!page) return;
      this.store.addMessages(page.messages);
      this.store.hasOlder.set(conversationId, page.hasMore);
    } else if (!this.store.hasOlder.has(conversationId)) {
      // Loaded from IndexedDB: older pages may exist on the server.
      this.store.hasOlder.set(conversationId, true);
    }
    this.queueReceipts([conversationId]);
    await this.loadDetail(conversationId);
  }

  // Offline: the local history is shown; the detail (members, ticks) arrives with the next sync.
  private async loadDetail(conversationId: string): Promise<void> {
    try {
      this.store.setDetail(await this.api.detail(conversationId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) this.store.markLeft(conversationId);
    }
  }

  // A system message means members changed: refresh the list and the members (maybe it was us).
  private async membershipChanged(conversationId: string): Promise<void> {
    await this.refreshConversations().catch(() => undefined);
    if (this.store.details.has(conversationId) || this.store.activeId === conversationId) {
      await this.loadDetail(conversationId);
    }
  }

  async createGroup(title: string, members: string[]): Promise<string> {
    const summary = await this.api.createGroup(title, members);
    this.store.upsertConversation(summary);
    return summary.conversationId;
  }

  addMember(conversationId: string, username: string): Promise<unknown> {
    return this.api.addMember(conversationId, username.trim().toLowerCase());
  }

  removeMember(conversationId: string, username: string): Promise<unknown> {
    return this.api.removeMember(conversationId, username);
  }

  async loadOlder(conversationId: string): Promise<void> {
    const before = this.store.oldestId(conversationId);
    const page = await this.api
      .history(conversationId, { before, limit: HISTORY_PAGE })
      .catch(() => null);
    if (!page) return;
    this.store.hasOlder.set(conversationId, page.hasMore);
    this.store.addMessages(page.messages);
  }

  // Shown at once with a clock; IndexedDB keeps it across reloads until the server acknowledges.
  send(conversationId: string, body: string): void {
    // The recipient drops the indicator when the message lands; typing again must show at once.
    this.lastTyping.delete(conversationId);
    const message: LocalMessage = {
      conversationId,
      clientMsgId: crypto.randomUUID(),
      sender: this.username,
      kind: "text",
      body,
      sentAt: new Date().toISOString(),
      messageId: null,
      status: "pending",
    };
    this.store.addPending(message);
    this.enqueue(message);
  }

  retry(message: LocalMessage): void {
    this.store.setStatus(this.username, message.conversationId, message.clientMsgId, "pending");
    this.enqueue(message);
  }

  private flushOutbox(): void {
    for (const message of this.store.pending()) this.enqueue(message);
  }

  private enqueue(message: LocalMessage): void {
    const key = messageKey(message);
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    this.outbox = this.outbox
      .then(() => this.deliver(message))
      .finally(() => this.inFlight.delete(key));
  }

  // Same clientMsgId on every attempt: the server turns repeats into the first ack (ADR-006).
  private async deliver(message: LocalMessage): Promise<void> {
    const { conversationId, clientMsgId, body } = message;
    try {
      const ack = await this.sendOnce(conversationId, clientMsgId, body);
      this.store.acknowledge(this.username, ack);
    } catch (error) {
      const failure = asSendError(error);
      // Retryable ones stay pending; the next sync (after reconnect) sends them again.
      if (!failure.retryable) {
        this.store.setStatus(this.username, conversationId, clientMsgId, "failed");
      } else if (this.store.connection === "online") {
        this.retryTimer ??= setTimeout(() => {
          this.retryTimer = null;
          this.flushOutbox();
        }, RETRY_MS);
      }
    }
  }

  // WebSocket when connected, REST otherwise; the server treats both the same.
  private sendOnce(conversationId: string, clientMsgId: string, body: string): Promise<SendAck> {
    if (this.store.connection !== "online") {
      return this.api.send(conversationId, clientMsgId, body);
    }
    return new Promise<SendAck>((resolve, reject) => {
      this.waiting.set(clientMsgId, { resolve, reject });
      if (!this.emit({ type: "send", conversationId, clientMsgId, body })) {
        this.waiting.delete(clientMsgId);
        reject(new SendError("offline", true));
      }
    });
  }

  typing(conversationId: string): void {
    const now = Date.now();
    if (now - (this.lastTyping.get(conversationId) ?? 0) < TYPING_THROTTLE_MS) return;
    if (this.emit({ type: "typing", conversationId })) this.lastTyping.set(conversationId, now);
  }

  private onVisibility = () => {
    if (this.store.activeId) this.queueReceipts([this.store.activeId]);
  };

  private queueReceipts(conversationIds: string[]): void {
    for (const id of conversationIds) this.receiptQueue.add(id);
    this.receiptTimer ??= setTimeout(() => {
      this.receiptTimer = null;
      for (const id of this.receiptQueue) this.sendReceipts(id);
      this.receiptQueue.clear();
    }, RECEIPT_DELAY_MS);
  }

  // Delivered as soon as it is on this device; read only while the chat is open and visible.
  private sendReceipts(conversationId: string): void {
    const newest = this.store.newestFromOthers(conversationId, this.username);
    if (!newest) return;
    this.report(conversationId, "delivered", newest);
    const reading =
      this.store.activeId === conversationId && document.visibilityState === "visible";
    if (reading) this.report(conversationId, "read", newest);
  }

  private report(conversationId: string, status: ReceiptStatus, upTo: string): void {
    const key = `${conversationId}|${status}`;
    if (isAtOrAfter(this.reported.get(key), upTo)) return;
    if (this.emit({ type: "receipt", conversationId, status, upTo })) this.reported.set(key, upTo);
  }
}
