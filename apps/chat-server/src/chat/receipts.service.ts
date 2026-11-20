import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Receipt } from "@wa/protocol";
import { KafkaService, TOPICS } from "../infra/kafka.js";
import { ChatRepository } from "./chat.repository.js";

@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(ChatRepository) private readonly repo: ChatRepository,
    @Inject(KafkaService) private readonly kafka: KafkaService,
  ) {}

  // Same key as the messages, so one conversation's receipts are also processed in order.
  async submit(receipt: Receipt): Promise<void> {
    if (!(await this.repo.isMember(receipt.conversationId, receipt.username))) {
      throw new ForbiddenException("not a member of this conversation");
    }
    await this.kafka.send(TOPICS.receipts, receipt.conversationId, receipt);
  }
}
