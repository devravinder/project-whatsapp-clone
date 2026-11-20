# How to run

Works the same on Windows (PowerShell) and Linux (Ubuntu, bash).

## Prerequisites

- Node.js 22 or newer, pnpm 12 (`corepack enable`)
- Docker with Compose v2, about 2 GB of free RAM (Cassandra ~1 GB, Kafka ~400 MB, Redis ~10 MB)
- Images: `cassandra:3.11.9`, `bitnami/kafka:3.5.1`, `redis:6.2.24`

If the images come from a private registry under different names, tag them with plain names once:

```powershell
$env:IMAGE_REGISTRY = "<registry-host:port>"; pwsh -File infra/retag-images.ps1
```

```bash
IMAGE_REGISTRY="<registry-host:port>" ./infra/retag-images.sh
```

A path that differs in your registry goes in `infra/retag-images.local.json` (git-ignored), for example
`{ "team/cassandra:latest": "cassandra:3.11.9" }`.

## Quick start

```bash
pnpm install
pnpm start:pods      # Cassandra, Kafka, Redis, nginx; creates topics and the keyspace
pnpm start:server    # chat-server-1 on http://localhost:4001   (terminal 1)
pnpm start:server2   # chat-server-2 on http://localhost:4002   (terminal 2, optional)
pnpm start:web       # http://localhost:5180                    (terminal 3)
```

Cassandra takes 20-60 s to become healthy on first start; `start:pods` returns before that, and the
setup containers wait for it. The web page shows OK for Cassandra, Redis and Kafka once everything is up.

The web app talks to nginx on port 4000, which spreads requests and WebSockets over both servers.
With only server-1 running, nginx skips the missing one.

Check from a terminal: `curl http://localhost:4000/health` (repeat it: the `server` field alternates;
503 lists what is down).

## Try it

1. Open <http://localhost:5180> in two tabs. The username lives in the tab (`sessionStorage`), so each
   tab can be a different user: `alice` in one, `bob` in the other.
2. In alice's tab, start a chat with `bob` and send a message.
3. Bob's tab shows it at once over the WebSocket. The sidebar shows which server each tab is on; with
   two servers running, the tabs usually land on different ones and messages still arrive (Redis routes
   them, ADR-010).
4. Watch the ticks on alice's message: ✓ (server has it), ✓✓ (bob's device has it), blue ✓✓ (bob has
   the chat open). Hover them for who has read it. Type in bob's tab: alice sees `typing…`.
5. Close alice's tab: bob's header changes from `online` to `last seen today at …`.
6. Stop one server (Ctrl+C): its tabs reconnect through nginx to the other one.
7. Go offline in bob's tab (DevTools → Network → Offline), send from both sides, go back online: bob
   catches up, and his clock-marked message goes out once. Stop both servers and reload a tab: the
   history still shows, from IndexedDB (DevTools → Application → IndexedDB → `wa-<username>`).

The REST API can be driven without the UI: `http/chat-server.http` (VS Code REST Client or IntelliJ
HTTP client). Every call except `POST /users` needs the `x-username` header; there is no login.

## Ports

| What          | Port |
| ------------- | ---- |
| nginx         | 4000 |
| chat-server-1 | 4001 |
| chat-server-2 | 4002 |
| web (Vite)    | 5180 |
| Cassandra     | 9042 |
| Kafka         | 9095 |
| Redis         | 6380 |

Kafka and Redis use non-default host ports so this can run next to other projects.

## Scripts

| Script               | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `pnpm start:pods`    | Start the infrastructure in the background               |
| `pnpm stop:pods`     | Stop it, **keeping** the data                            |
| `pnpm reset:pods`    | Stop it and **delete** all data (volumes)                |
| `pnpm logs:pods`     | Follow the infrastructure logs                           |
| `pnpm db:schema`     | Re-apply `infra/cassandra/schema/*.cql` (safe to repeat) |
| `pnpm start:server`  | Run chat-server-1 with watch mode                        |
| `pnpm start:server2` | Run chat-server-2 (`.env.server-2`)                      |
| `pnpm start:web`     | Run the web app with Vite                                |
| `pnpm typecheck`     | Type-check every package                                 |

## Poking at the data

```bash
docker exec -it wa-cassandra cqlsh -k chat
docker exec -it wa-redis redis-cli
docker exec -it wa-kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic chat.messages --from-beginning --property print.key=true
```

## Troubleshooting

- **Health shows Cassandra timeout:** it is still starting; `docker logs wa-cassandra` ends with
  `Starting listening for CQL clients` when ready.
- **Health shows missing topics:** `kafka-setup` has not run; `docker compose -f infra/docker-compose.yaml up kafka-setup`.
- **Port in use:** another project holds the port; stop it or change the host port in `infra/docker-compose.yaml`.
