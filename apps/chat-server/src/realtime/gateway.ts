import type { Server } from "node:http";
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  CLOSE,
  type ClientEvent,
  clientEventSchema,
  type ServerEvent,
  WS_PATH,
} from "@wa/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import { MessagesService } from "../chat/messages.service.js";
import { UsersService } from "../chat/users.service.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { parseJson } from "../infra/kafka.js";
import { LocalConnections } from "./connections.js";
import { Directory } from "./directory.js";
import { HEARTBEAT_MS } from "./heartbeat.js";
import { RedisRouter } from "./router.js";

const HELLO_TIMEOUT_MS = 5_000;
const MAX_FRAME_BYTES = 64 * 1024;

// queue: one socket's events run in arrival order, so its sends keep their order.
type Session = { username: string | null; alive: boolean; queue: Promise<void> };

const retryable = (status: number) =>
  status === HttpStatus.CONFLICT || status >= HttpStatus.INTERNAL_SERVER_ERROR;

@Injectable()
export class ChatGateway implements OnModuleDestroy {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly sessions = new Map<WebSocket, Session>();
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LocalConnections) private readonly connections: LocalConnections,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(Directory) private readonly directory: Directory,
    @Inject(RedisRouter) private readonly router: RedisRouter,
  ) {}

  // Shares the HTTP port: the upgrade request arrives on the same server.
  async attach(server: Server): Promise<void> {
    await this.router.start();
    this.directory.start();
    this.wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: MAX_FRAME_BYTES });
    this.wss.on("connection", (socket) => this.onConnection(socket));
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  private onConnection(socket: WebSocket): void {
    const session: Session = { username: null, alive: true, queue: Promise.resolve() };
    this.sessions.set(socket, session);
    const helloTimer = setTimeout(() => {
      if (!session.username) socket.close(CLOSE.helloTimeout, "no hello");
    }, HELLO_TIMEOUT_MS);

    socket.on("pong", () => {
      session.alive = true;
    });
    socket.on("message", (data) => {
      const parsed = clientEventSchema.safeParse(parseJson(data.toString()));
      if (!parsed.success) {
        send(socket, { type: "error", reason: "unreadable frame" });
        return;
      }
      session.queue = session.queue
        .then(() => this.onEvent(socket, session, parsed.data))
        .catch((error: Error) => {
          this.logger.warn(`event ${parsed.data.type} failed: ${error.message}`);
        });
    });
    socket.on("close", () => {
      clearTimeout(helloTimer);
      this.sessions.delete(socket);
      if (session.username) this.onLeave(session.username, socket);
    });
  }

  private async onEvent(socket: WebSocket, session: Session, event: ClientEvent): Promise<void> {
    if (event.type === "hello") {
      if (session.username) return;
      if (!(await this.users.exists(event.username))) {
        socket.close(CLOSE.unknownUser, "unknown user");
        return;
      }
      session.username = event.username;
      // Registered in Redis before ready, so pushes from that moment on find this server.
      await this.onJoin(event.username, socket);
      send(socket, { type: "ready", username: event.username, serverId: this.config.SERVER_ID });
      return;
    }
    if (!session.username) {
      socket.close(CLOSE.badHello, "hello first");
      return;
    }
    if (event.type === "watch") {
      this.router.watch(socket, event.usernames);
      for (const username of event.usernames) {
        send(socket, { type: "presence", ...(await this.directory.presence(username)) });
      }
      return;
    }
    if (event.type === "send") {
      try {
        const ack = await this.messages.send({ sender: session.username, ...event });
        send(socket, { type: "ack", ...ack });
      } catch (error) {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        send(socket, {
          type: "nack",
          clientMsgId: event.clientMsgId,
          reason: (error as Error).message,
          retryable: retryable(status),
        });
      }
    }
  }

  private async onJoin(username: string, socket: WebSocket): Promise<void> {
    if (this.connections.add(username, socket)) {
      await this.directory.join(username).catch(warn(this.logger));
    }
  }

  private onLeave(username: string, socket: WebSocket): void {
    this.router.unwatch(socket);
    if (this.connections.remove(username, socket))
      void this.directory.leave(username).catch(warn(this.logger));
  }

  // A socket that missed one ping is gone (laptop lid closed, network dropped).
  private beat(): void {
    for (const [socket, session] of this.sessions) {
      if (!session.alive) {
        socket.terminate();
        continue;
      }
      session.alive = false;
      socket.ping();
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    // 1001 "going away": clients reconnect, through nginx to another server.
    for (const socket of this.sessions.keys()) socket.close(1001, "server shutting down");
    this.wss?.close();
  }
}

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}

const warn = (logger: Logger) => (error: Error) => logger.warn(error.message);
