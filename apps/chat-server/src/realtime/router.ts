import { Inject, Injectable } from "@nestjs/common";
import type { ServerEvent } from "@wa/protocol";
import { LocalConnections } from "./connections.js";

export const ROUTER = Symbol("ROUTER");

// Gets an event to whichever server holds each user's sockets.
export interface Router {
  deliver(usernames: string[], event: ServerEvent): Promise<void>;
}

// One server: every connected user is local.
@Injectable()
export class LocalRouter implements Router {
  constructor(@Inject(LocalConnections) private readonly connections: LocalConnections) {}

  async deliver(usernames: string[], event: ServerEvent): Promise<void> {
    for (const username of new Set(usernames)) this.connections.send(username, event);
  }
}
