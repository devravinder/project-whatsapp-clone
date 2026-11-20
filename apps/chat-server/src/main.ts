import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { APP_CONFIG, type AppConfig } from "./config.js";
import { ChatGateway } from "./realtime/gateway.js";

const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
const config = app.get<AppConfig>(APP_CONFIG);
await app.get(ChatGateway).attach(app.getHttpServer());
await app.listen(config.PORT);
console.log(`${config.SERVER_ID} listening on http://localhost:${config.PORT} (WebSocket /ws)`);
