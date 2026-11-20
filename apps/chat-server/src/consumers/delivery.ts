import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ChatRepository } from "../chat/chat.repository.js";
import { messageRecordSchema } from "../chat/records.js";
import { KafkaService, parseJson, type Record, TOPICS } from "../infra/kafka.js";
import { ROUTER, type Router } from "../realtime/router.js";

// Pushes new messages to members who are online. Offline members catch up by syncing (Task 5).
@Injectable()
export class Delivery implements OnApplicationBootstrap {
  private readonly logger = new Logger(Delivery.name);

  constructor(
    @Inject(KafkaService) private readonly kafka: KafkaService,
    @Inject(ChatRepository) private readonly repo: ChatRepository,
    @Inject(ROUTER) private readonly router: Router,
  ) {}

  onApplicationBootstrap(): void {
    // A new group starts at the end: pushing all history to whoever is online helps no one.
    this.kafka.startConsumer({
      groupId: "delivery",
      topic: TOPICS.messages,
      startAt: "latest",
      handle: (record) => this.handle(record),
    });
  }

  async handle(record: Record): Promise<void> {
    const parsed = messageRecordSchema.safeParse(parseJson(record.value));
    if (!parsed.success) {
      this.logger.error(`skipping malformed record at ${record.partition}@${record.offset}`);
      return;
    }
    const { alsoNotify = [], ...message } = parsed.data;
    // The sender is included: their other tabs show the message too.
    const members = await this.repo.members(message.conversationId);
    await this.router.deliver([...members.map((m) => m.username), ...alsoNotify], {
      type: "message",
      message,
    });
  }
}
