import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "./config.js";
import { CassandraService } from "./infra/cassandra.js";
import { KafkaService } from "./infra/kafka.js";
import { RedisService } from "./infra/redis.js";

const CHECK_TIMEOUT_MS = 3000;

type Check = { ok: boolean; detail: string };

async function check(probe: () => Promise<string>): Promise<Check> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS);
  });
  try {
    return { ok: true, detail: await Promise.race([probe(), timeout]) };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

@Controller("health")
export class HealthController {
  // Explicit tokens: tsx (esbuild) emits no decorator metadata for Nest to read.
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CassandraService) private readonly cassandra: CassandraService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(KafkaService) private readonly kafka: KafkaService,
  ) {}

  @Get()
  async health() {
    const [cassandra, redis, kafka] = await Promise.all([
      check(() => this.cassandra.ping()),
      check(() => this.redis.ping()),
      check(() => this.kafka.ping()),
    ]);
    const body = { server: this.config.SERVER_ID, cassandra, redis, kafka };
    if (![cassandra, redis, kafka].every((c) => c.ok)) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
