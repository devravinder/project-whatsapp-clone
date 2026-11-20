import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { APP_CONFIG, type AppConfig } from "../config.js";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: RedisClientType;
  private connecting?: Promise<unknown>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = createClient({ url: config.REDIS_URL });
    // Without a listener, a lost connection is an unhandled error that kills the process.
    this.client.on("error", () => undefined);
  }

  async ping(): Promise<string> {
    this.connecting ??= this.client.connect();
    await this.connecting;
    return `redis ${await this.client.ping()}`;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
  }
}
