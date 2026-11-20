import { Module } from "@nestjs/common";
import { APP_CONFIG, loadConfig } from "./config.js";
import { HealthController } from "./health.controller.js";
import { CassandraService } from "./infra/cassandra.js";
import { KafkaService } from "./infra/kafka.js";
import { RedisService } from "./infra/redis.js";

@Module({
  controllers: [HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    CassandraService,
    RedisService,
    KafkaService,
  ],
})
export class AppModule {}
