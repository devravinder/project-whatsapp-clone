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

- [x] Users: pick a username (no password); `POST /users` uses `IF NOT EXISTS`
- [x] Cassandra tables (`002_chat.cql`): `users`, `conversations`, `members_by_conversation`,
      `conversations_by_user`, `messages_by_conversation`
- [x] Start a 1:1 conversation (deterministic id `dm:<a>:<b>` from the sorted usernames)
- [x] Send: produce to `chat.messages` (acks=all), TIMEUUID message id, `clientMsgId` dedupe in Redis
- [x] Persister consumer group writes Cassandra (upsert, replay-safe, `USING TIMESTAMP` for previews)
- [x] History paging: newest page, `before` and `after` cursors
- [x] Web: username screen, conversation list, chat view (polls every 3 s until Task 2)
- [x] Verified: 21 end-to-end checks (dedupe, paging, 401/403/404/400); all 61 records of one
      conversation on one partition; persister lag 0

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
