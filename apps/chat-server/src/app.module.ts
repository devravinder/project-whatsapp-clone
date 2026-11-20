import { Module } from "@nestjs/common";
import { ChatController } from "./chat/chat.controller.js";
import { ChatRepository } from "./chat/chat.repository.js";
import { ConversationsService } from "./chat/conversations.service.js";
import { MessagesService } from "./chat/messages.service.js";
import { UsersService } from "./chat/users.service.js";
import { APP_CONFIG, loadConfig } from "./config.js";
import { Persister } from "./consumers/persister.js";
import { HealthController } from "./health.controller.js";
import { CassandraService } from "./infra/cassandra.js";
import { KafkaService } from "./infra/kafka.js";
import { RedisService } from "./infra/redis.js";

@Module({
  controllers: [HealthController, ChatController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    CassandraService,
    RedisService,
    KafkaService,
    ChatRepository,
    UsersService,
    ConversationsService,
    MessagesService,
    Persister,
  ],
})
export class AppModule {}
