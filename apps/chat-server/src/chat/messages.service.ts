import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { SendAck } from "@wa/protocol";
import { KafkaService, TOPICS } from "../infra/kafka.js";
import { RedisService } from "../infra/redis.js";
import { ChatRepository, newMessageId } from "./chat.repository.js";
import type { MessageRecord } from "./records.js";

// Long enough to cover a client retrying after a day offline.
const DEDUPE_TTL_S = 24 * 60 * 60;
const IN_FLIGHT = "in-flight";

export type SendRequest = {
  sender: string;
  conversationId: string;
  clientMsgId: string;
  body: string;
  kind?: MessageRecord["kind"];
  alsoNotify?: string[];
};

@Injectable()
export class MessagesService {
  constructor(
    @Inject(ChatRepository) private readonly repo: ChatRepository,
    @Inject(KafkaService) private readonly kafka: KafkaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async send(request: SendRequest): Promise<SendAck> {
    if (!(await this.repo.isMember(request.conversationId, request.sender))) {
      throw new ForbiddenException("not a member of this conversation");
    }
    const redis = await this.redis.connected();
    const dedupeKey = `dedupe:${request.sender}:${request.clientMsgId}`;

    // Claim the clientMsgId first; a retry finds the claim and gets the first ack back.
    const claimed = await redis.set(dedupeKey, IN_FLIGHT, { NX: true, EX: DEDUPE_TTL_S });
    if (!claimed) {
      const existing = await redis.get(dedupeKey);
      if (existing && existing !== IN_FLIGHT) return JSON.parse(existing) as SendAck;
      throw new ConflictException("the same message is still being sent; retry shortly");
    }

    const { messageId, sentAt } = newMessageId();
    const record: MessageRecord = {
      messageId,
      conversationId: request.conversationId,
      sender: request.sender,
      clientMsgId: request.clientMsgId,
      kind: request.kind ?? "text",
      body: request.body,
      sentAt,
      ...(request.alsoNotify?.length ? { alsoNotify: request.alsoNotify } : {}),
    };
    try {
      // Key = conversation: its messages share a partition, so they stay in order.
      await this.kafka.send(TOPICS.messages, request.conversationId, record);
    } catch (error) {
      await redis.del(dedupeKey).catch(() => undefined);
      throw new ServiceUnavailableException(`message not accepted: ${(error as Error).message}`);
    }
    const ack: SendAck = {
      clientMsgId: request.clientMsgId,
      conversationId: request.conversationId,
      messageId,
      sentAt,
    };
    await redis.set(dedupeKey, JSON.stringify(ack), { EX: DEDUPE_TTL_S }).catch(() => undefined);
    return ack;
  }
}
