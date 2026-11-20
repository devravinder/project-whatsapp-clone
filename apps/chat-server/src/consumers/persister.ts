import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ChatRepository } from "../chat/chat.repository.js";
import { messageRecordSchema } from "../chat/records.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { KafkaService, parseJson, type Record, TOPICS } from "../infra/kafka.js";

// Builds the Cassandra read model from the log. Every write is an upsert, so replays are safe.
@Injectable()
export class Persister implements OnApplicationBootstrap {
  private readonly logger = new Logger(Persister.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(KafkaService) private readonly kafka: KafkaService,
    @Inject(ChatRepository) private readonly repo: ChatRepository,
  ) {}

  onApplicationBootstrap(): void {
    // A new group starts at the beginning: nothing in the log is ever skipped.
    this.kafka.startConsumer({
      groupId: this.config.PERSISTER_GROUP,
      topic: TOPICS.messages,
      startAt: "earliest",
      handle: (record) => this.handle(record),
    });
  }

  async handle(record: Record): Promise<void> {
    const parsed = messageRecordSchema.safeParse(parseJson(record.value));
    if (!parsed.success) {
      // Retrying cannot fix a malformed record; log it and move on.
      this.logger.error(`skipping malformed record at ${record.partition}@${record.offset}`);
      return;
    }
    const message = parsed.data;
    await this.repo.saveMessage(message);
    const members = await this.repo.members(message.conversationId);
    await this.repo.updateLastMessage(
      message,
      members.map((m) => m.username),
    );
  }
}
