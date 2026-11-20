import { type Api, api } from "./api.js";
import { ChatStore } from "./store.js";

const HISTORY_PAGE = 50;
const POLL_MS = 3000;

// Talks to the server and keeps the store up to date.
export class ChatClient {
  readonly store = new ChatStore();
  readonly api: Api;
  private poller: ReturnType<typeof setInterval> | null = null;

  constructor(readonly username: string) {
    this.api = api(username);
  }

  start(): void {
    void this.refreshConversations();
    // Task 1 only: polling stands in for the WebSocket.
    this.poller = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.poller) clearInterval(this.poller);
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
    const ack = await this.api.send(conversationId, clientMsgId, body);
    this.store.acknowledge(this.username, ack);
  }

  private async poll(): Promise<void> {
    await this.refreshConversations().catch(() => undefined);
    const active = this.store.activeId;
    if (!active) return;
    const after = this.store.newestId(active);
    const page = await this.api.history(
      active,
      after ? { after, limit: 100 } : { limit: HISTORY_PAGE },
    );
    this.store.addMessages(page.messages);
  }
}
