# Tasks

`[x]` done, `[~]` partly done, `[ ]` to do. One commit per task, after review.

## 0. Scaffold

- [x] pnpm monorepo, Prettier, oxlint, markdownlint, husky + commitlint
- [x] Docker Compose: Cassandra 3.11.9, Kafka 3.5.1 (KRaft), Redis 6.2.24
- [x] One-shot setup containers: Kafka topics, Cassandra schema (both re-runnable)
- [x] `apps/chat-server` (NestJS) with `GET /health` checking all three
- [x] `apps/web` (React + Vite + Tailwind) showing the health result
- [x] Image retag scripts for a private registry (Windows and Linux)
- [x] Docs, ADR-001 to ADR-004, `http/chat-server.http`, skills
- [x] Verified: infra healthy in 23 s, setup containers re-run cleanly, `/health` 200 direct and via the
      Vite proxy, 503 naming Redis while it is stopped, 200 again after restart

## 1. 1:1 chats over REST

- [ ] Users: pick a username (no password)
- [ ] Cassandra tables: `conversations_by_user`, `messages_by_conversation`
- [ ] Start a 1:1 conversation (deterministic id from the two usernames)
- [ ] Send: produce to `chat.messages` (acks=all), TIMEUUID message id, `clientMsgId` dedupe
- [ ] Persister consumer group writes Cassandra (upsert, replay-safe)
- [ ] History paging, newest first
- [ ] Web: username screen, conversation list, chat view

## 2. Realtime on one server

- [ ] WebSocket gateway, username sent as the first message
- [ ] Delivery consumer group pushes new messages to connected members
- [ ] Single tick on the Kafka ack

## 3. Two servers

- [ ] nginx in front of server-1 and server-2 (HTTP and WebSocket)
- [ ] Redis routing `user → server`, pub/sub channel per server
- [ ] Presence: online with heartbeat TTL, last seen

## 4. Receipts and typing

- [ ] `chat.receipts`: delivered (double tick) and read (blue tick)
- [ ] Typing indicator over Redis only (not stored)

## 5. Offline sync

- [ ] Reconnect with exponential backoff and jitter
- [ ] Sync "since cursor" per conversation
- [ ] Local history in IndexedDB (Dexie)

## 6. Group chat

- [ ] Create a group, add and remove members (max 256)
- [ ] Fan-out per member in the delivery consumer
- [ ] "Read by" receipts per member

## 7. Wrap-up

- [ ] Unread counts
- [ ] Replay `chat.messages` to rebuild Cassandra (demo)
- [ ] Linux (Ubuntu) check
- [ ] Interview questions doc
