---
name: realtime-routing
description: How WebSocket sockets, Redis routing, presence and pub/sub fit together across chat servers. Use when changing the gateway, delivery, presence or anything pushed to clients.
---

# Realtime routing

## Pieces

| Piece              | File                          | Holds                                          |
| ------------------ | ----------------------------- | ---------------------------------------------- |
| `LocalConnections` | `src/realtime/connections.ts` | Sockets on this process, by username           |
| `Directory`        | `src/realtime/directory.ts`   | `servers:<user>` (sorted set), presence        |
| `RedisRouter`      | `src/realtime/router.ts`      | `deliver(usernames, event)`, presence watchers |
| `ChatGateway`      | `src/realtime/gateway.ts`     | Socket lifecycle, frames, heartbeat            |

## Rules

- **Push through `ROUTER.deliver`,** never `LocalConnections.send` directly: the user may be on
  another server.
- **Pushes are best effort.** Anything that must not be lost goes to Kafka first; the push is only a
  shortcut, and the client syncs from Cassandra after a reconnect.
- **New frame types** go in `libs/protocol/src/ws.ts` (Zod for client frames, a union type for server
  frames), so server and web share them.
- **Per-socket order:** the gateway chains a socket's frames; keep handlers awaited inside that chain.
- **Redis keys:** `servers:<user>` (score = expiry ms), `lastseen:<user>`, `dedupe:<sender>:<clientMsgId>`;
  channels `deliver:<serverId>` and `presence`. Redis has no persistence here; every key is rebuilt by
  heartbeats or is safe to lose.

## Try it

```bash
docker exec -it wa-redis redis-cli ZRANGE servers:alice 0 -1 WITHSCORES
docker exec -it wa-redis redis-cli PSUBSCRIBE 'deliver:*'
```
