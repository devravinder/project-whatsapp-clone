import { Injectable } from "@nestjs/common";
import type { ServerEvent } from "@wa/protocol";
import type { WebSocket } from "ws";

// Sockets held by this process. A user may have several (tabs, devices).
@Injectable()
export class LocalConnections {
  private readonly byUser = new Map<string, Set<WebSocket>>();

  // True when this is the user's first socket here.
  add(username: string, socket: WebSocket): boolean {
    let sockets = this.byUser.get(username);
    const first = !sockets;
    if (!sockets) this.byUser.set(username, (sockets = new Set()));
    sockets.add(socket);
    return first;
  }

  // True when the user has no socket left here.
  remove(username: string, socket: WebSocket): boolean {
    const sockets = this.byUser.get(username);
    if (!sockets?.delete(socket)) return false;
    if (sockets.size > 0) return false;
    this.byUser.delete(username);
    return true;
  }

  usernames(): string[] {
    return [...this.byUser.keys()];
  }

  sockets(username: string): WebSocket[] {
    return [...(this.byUser.get(username) ?? [])];
  }

  // Returns how many sockets got it.
  send(username: string, event: ServerEvent): number {
    const frame = JSON.stringify(event);
    let sent = 0;
    for (const socket of this.byUser.get(username) ?? []) {
      if (socket.readyState === socket.OPEN) {
        socket.send(frame);
        sent++;
      }
    }
    return sent;
  }
}
