import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { Presence } from "@wa/protocol";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { RedisService } from "../infra/redis.js";
import { HEARTBEAT_MS } from "./heartbeat.js";
import { LocalConnections } from "./connections.js";

// A server that stops refreshing (crashed) drops out after this.
const ENTRY_TTL_MS = HEARTBEAT_MS * 3;

export const PRESENCE_CHANNEL = "presence";
export const deliverChannel = (serverId: string) => `deliver:${serverId}`;
const serversKey = (username: string) => `servers:${username}`;
const lastSeenKey = (username: string) => `lastseen:${username}`;

// Which servers hold a socket for each user, in Redis: a sorted set scored by expiry time.
// A per-member expiry is why it is not a plain set: a crashed server's entry must age out alone.
@Injectable()
export class Directory implements OnModuleDestroy {
  private readonly logger = new Logger(Directory.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LocalConnections) private readonly connections: LocalConnections,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.refreshAll().catch(() => undefined), HEARTBEAT_MS);
  }

  private async online(username: string, now = Date.now()): Promise<boolean> {
    const redis = await this.redis.connected();
    return (await redis.zCount(serversKey(username), now, "+inf")) > 0;
  }

  // First socket of a user on this server.
  async join(username: string): Promise<void> {
    const wasOnline = await this.online(username);
    await this.register([username]);
    if (!wasOnline) await this.announce({ username, online: true, lastSeen: null });
  }

  // Last socket of a user on this server closed.
  async leave(username: string): Promise<void> {
    const redis = await this.redis.connected();
    await redis.zRem(serversKey(username), this.config.SERVER_ID);
    if (await this.online(username)) return;
    const lastSeen = new Date().toISOString();
    await redis.set(lastSeenKey(username), lastSeen);
    await this.announce({ username, online: false, lastSeen });
  }

  async serversOf(usernames: string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(usernames)];
    const redis = await this.redis.connected();
    const now = Date.now();
    const pipeline = redis.multi();
    for (const u of unique) pipeline.zRangeByScore(serversKey(u), now, "+inf");
    const results = (await pipeline.execAsPipeline()) as unknown as string[][];
    const byServer = new Map<string, string[]>();
    unique.forEach((username, i) => {
      for (const server of results[i] ?? []) {
        byServer.set(server, [...(byServer.get(server) ?? []), username]);
      }
    });
    return byServer;
  }

  async presence(username: string): Promise<Presence> {
    const redis = await this.redis.connected();
    const [online, lastSeen] = await Promise.all([
      this.online(username),
      redis.get(lastSeenKey(username)),
    ]);
    return { username, online, lastSeen: online ? null : lastSeen };
  }

  private async register(usernames: string[]): Promise<void> {
    if (usernames.length === 0) return;
    const redis = await this.redis.connected();
    const now = Date.now();
    const pipeline = redis.multi();
    for (const u of usernames) {
      pipeline.zAdd(serversKey(u), { score: now + ENTRY_TTL_MS, value: this.config.SERVER_ID });
      pipeline.zRemRangeByScore(serversKey(u), "-inf", now);
      // The key itself goes once every server has stopped refreshing it.
      pipeline.pExpire(serversKey(u), ENTRY_TTL_MS);
    }
    await pipeline.execAsPipeline();
  }

  private refreshAll(): Promise<void> {
    return this.register(this.connections.usernames());
  }

  private async announce(presence: Presence): Promise<void> {
    const redis = await this.redis.connected();
    await redis.publish(PRESENCE_CHANNEL, JSON.stringify(presence));
  }

  // Leaves Redis tidy on a clean stop, so peers see this server's users drop at once.
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const redis = this.redis.client;
    if (!redis.isReady) return;
    await Promise.all(
      this.connections
        .usernames()
        .map((u) => redis.zRem(serversKey(u), this.config.SERVER_ID).catch(() => undefined)),
    ).catch((error: Error) => this.logger.warn(error.message));
  }
}
