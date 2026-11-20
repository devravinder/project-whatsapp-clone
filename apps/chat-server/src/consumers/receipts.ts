import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ChatRepository } from "../chat/chat.repository.js";
import { receiptRecordSchema } from "../chat/records.js";
import { KafkaService, parseJson, type Record, TOPICS } from "../infra/kafka.js";
import { ROUTER, type Router } from "../realtime/router.js";

// Stores each watermark, then tells the members (the sender's ticks turn grey-double or blue).
@Injectable()
export class Receipts implements OnApplicationBootstrap {
  private readonly logger = new Logger(Receipts.name);

  constructor(
    @Inject(KafkaService) private readonly kafka: KafkaService,
    @Inject(ChatRepository) private readonly repo: ChatRepository,
    @Inject(ROUTER) private readonly router: Router,
  ) {}

  onApplicationBootstrap(): void {
    this.kafka.startConsumer({
      groupId: "receipts",
      topic: TOPICS.receipts,
      startAt: "earliest",
      handle: (record) => this.handle(record),
    });
  }

  async handle(record: Record): Promise<void> {
    const parsed = receiptRecordSchema.safeParse(parseJson(record.value));
    if (!parsed.success) {
      this.logger.error(`skipping malformed receipt at ${record.partition}@${record.offset}`);
      return;
    }
    const receipt = parsed.data;
    await this.repo.advance(receipt.conversationId, receipt.username, receipt.status, receipt.upTo);
    const members = await this.repo.members(receipt.conversationId);
    // Clients ignore a watermark older than the one they hold, so a late push is harmless.
    await this.router.deliver(
      members.map((m) => m.username),
      { type: "receipt", ...receipt },
    );
  }
}
