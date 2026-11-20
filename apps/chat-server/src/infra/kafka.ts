import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Admin } from "@platformatic/kafka";
import { APP_CONFIG, type AppConfig } from "../config.js";

export const TOPICS = { messages: "chat.messages", receipts: "chat.receipts" } as const;

@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly admin: Admin;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.admin = new Admin({ clientId: config.SERVER_ID, bootstrapBrokers: config.KAFKA_BROKERS });
  }

  async ping(): Promise<string> {
    const topics = await this.admin.listTopics();
    const missing = Object.values(TOPICS).filter((topic) => !topics.includes(topic));
    if (missing.length > 0) throw new Error(`missing topics: ${missing.join(", ")}`);
    return `kafka topics ${Object.values(TOPICS).join(", ")}`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.admin.close().catch(() => undefined);
  }
}
