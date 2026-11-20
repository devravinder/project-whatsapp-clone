import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { Presence, ServerEvent } from "@wa/protocol";
import type { RedisClientType } from "redis";
import type { WebSocket } from "ws";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { parseJson } from "../infra/kafka.js";
import { RedisService } from "../infra/redis.js";
import { LocalConnections } from "./connections.js";
import { deliverChannel, Directory, PRESENCE_CHANNEL } from "./directory.js";

export const ROUTER = Symbol("ROUTER");

// Gets an event to whichever server holds each user's sockets.
export interface Router {
  deliver(usernames: string[], event: ServerEvent): Promise<void>;
}

type Envelope = { usernames: string[]; event: ServerEvent };

// Redis pub/sub, one channel per server. Fire-and-forget: a missed push is recovered by sync.
@Injectable()
export class RedisRouter implements Router, OnModuleDestroy {
  private readonly logger = new Logger(RedisRouter.name);
  private subscriber: RedisClientType | null = null;
  // Sockets that asked for presence updates about a user.
  private readonly watchers = new Map<string, Set<WebSocket>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LocalConnections) private readonly connections: LocalConnections,
    @Inject(Directory) private readonly directory: Directory,
  ) {}

  // A subscribed connection can do nothing else, so it is a second client.
  async start(): Promise<void> {
    const subscriber = (await this.redis.connected()).duplicate();
    subscriber.on("error", () => undefined);
    await subscriber.connect();
    await subscriber.subscribe(deliverChannel(this.config.SERVER_ID), (raw) => {
      const envelope = parseJson(raw) as Envelope | null;
      if (!envelope) return;
      for (const username of envelope.usernames) this.connections.send(username, envelope.event);
    });
    await subscriber.subscribe(PRESENCE_CHANNEL, (raw) => {
      const presence = parseJson(raw) as Presence | null;
      if (presence) this.notifyWatchers(presence);
    });
    this.subscriber = subscriber as RedisClientType;
    this.logger.log(
      `subscribed to ${deliverChannel(this.config.SERVER_ID)} and ${PRESENCE_CHANNEL}`,
    );
  }

  async deliver(usernames: string[], event: ServerEvent): Promise<void> {
    const byServer = await this.directory.serversOf(usernames);
    const redis = await this.redis.connected();
    await Promise.all(
      [...byServer].map(([server, users]) =>
        redis.publish(deliverChannel(server), JSON.stringify({ usernames: users, event })),
      ),
    );
  }

  watch(socket: WebSocket, usernames: string[]): void {
    this.unwatch(socket);
    for (const u of usernames) {
      let sockets = this.watchers.get(u);
      if (!sockets) this.watchers.set(u, (sockets = new Set()));
      sockets.add(socket);
    }
  }

  unwatch(socket: WebSocket): void {
    for (const [u, sockets] of this.watchers) {
      sockets.delete(socket);
      if (sockets.size === 0) this.watchers.delete(u);
    }
  }

  private notifyWatchers(presence: Presence): void {
    const frame = JSON.stringify({ type: "presence", ...presence } satisfies ServerEvent);
    for (const socket of this.watchers.get(presence.username) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(frame);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.close().catch(() => undefined);
  }
}
