import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  Admin,
  Consumer,
  type Message,
  type MessagesStream,
  Producer,
  stringDeserializers,
  stringSerializers,
} from "@platformatic/kafka";
import { APP_CONFIG, type AppConfig } from "../config.js";

export const TOPICS = { messages: "chat.messages", receipts: "chat.receipts" } as const;

// A paused broker makes send() hang instead of fail.
const SEND_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 10_000;

export const backoffMs = (attempt: number) => Math.min(250 * 2 ** attempt, MAX_BACKOFF_MS);
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Record = Message<string, string, string, string>;

export function parseJson(value: string | undefined | null): unknown {
  try {
    return JSON.parse(value ?? "null");
  } catch {
    return null;
  }
}

export type ConsumerOptions = {
  groupId: string;
  topic: string;
  // Where a brand-new group starts; afterwards it resumes from its committed offset.
  startAt: "earliest" | "latest";
  handle: (record: Record) => Promise<void>;
};

@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly logger = new Logger("Kafka");
  private readonly admin: Admin;
  private readonly producer: Producer<string, string, string, string>;
  private readonly loops: Promise<void>[] = [];
  private readonly streams = new Set<MessagesStream<string, string, string, string>>();
  private stopping = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.admin = new Admin({ clientId: config.SERVER_ID, bootstrapBrokers: config.KAFKA_BROKERS });
    // Idempotent: the client's own retries are stored once. acks -1: every in-sync replica has it.
    this.producer = new Producer({
      clientId: config.SERVER_ID,
      bootstrapBrokers: config.KAFKA_BROKERS,
      serializers: stringSerializers,
      idempotent: true,
      acks: -1,
    });
  }

  async ping(): Promise<string> {
    const topics = await this.admin.listTopics();
    const missing = Object.values(TOPICS).filter((topic) => !topics.includes(topic));
    if (missing.length > 0) throw new Error(`missing topics: ${missing.join(", ")}`);
    return `kafka topics ${Object.values(TOPICS).join(", ")}`;
  }

  async send(topic: string, key: string, value: unknown): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Kafka send timed out")), SEND_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        this.producer.send({ messages: [{ topic, key, value: JSON.stringify(value) }] }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Not awaited by callers: the HTTP API keeps serving while Kafka is down.
  startConsumer(options: ConsumerOptions): void {
    this.loops.push(this.runForever(options));
  }

  private async runForever(options: ConsumerOptions): Promise<void> {
    for (let attempt = 0; !this.stopping; attempt++) {
      const consumer = new Consumer({
        groupId: options.groupId,
        clientId: `${this.config.SERVER_ID}-${options.groupId}`,
        bootstrapBrokers: this.config.KAFKA_BROKERS,
        deserializers: stringDeserializers,
      });
      try {
        const stream = await consumer.consume({
          topics: [options.topic],
          mode: "committed",
          fallbackMode: options.startAt,
          autocommit: false,
          maxWaitTime: 500,
        });
        this.streams.add(stream);
        this.logger.log(`${options.groupId} consuming ${options.topic}`);
        attempt = 0;
        // One record at a time: keeps each partition in order.
        for await (const record of stream) {
          await this.handleUntilDone(options, record);
          await record.commit();
        }
      } catch (error) {
        if (this.stopping) break;
        const delay = backoffMs(attempt);
        this.logger.warn(
          `${options.groupId} failed, restarting in ${delay} ms: ${(error as Error).message}`,
        );
        await sleep(delay);
      } finally {
        await consumer.close(true).catch(() => undefined);
      }
    }
  }

  // Retries instead of skipping: the log is the truth, so a skipped record is a lost message.
  private async handleUntilDone(options: ConsumerOptions, record: Record): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await options.handle(record);
      } catch (error) {
        if (this.stopping) throw error;
        const delay = backoffMs(attempt);
        this.logger.warn(
          `${options.groupId} ${record.topic}/${record.partition}@${record.offset} failed, retry in ${delay} ms: ${(error as Error).message}`,
        );
        await sleep(delay);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.streams].map((stream) => stream.close().catch(() => undefined)));
    await Promise.all(this.loops);
    await this.producer.close().catch(() => undefined);
    await this.admin.close().catch(() => undefined);
  }
}
