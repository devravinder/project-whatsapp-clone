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

- [x] WebSocket gateway on `/ws` (same port as HTTP), username sent as the first frame
- [x] Delivery consumer group pushes new messages to connected members (and the sender's other tabs)
- [x] Single tick on the Kafka ack; REST fallback when the socket is down
- [x] Heartbeat ping every 15 s; a socket that misses one is terminated
- [x] Verified: 14 WebSocket checks (live delivery in about 20 ms, a 30-message burst in order, retry
      not delivered twice, close codes 4000/4001/4002), REST and WebSocket through the Vite proxy, and
      a two-browser UI run (headless Chrome)

## 3. Two servers

- [x] nginx (`infra/nginx/nginx.conf`, port 4000) round-robins HTTP and WebSocket over server-1 and server-2
- [x] Redis routing: `servers:<user>` sorted set (score = expiry), `deliver:<serverId>` channel per server
- [x] Presence: online while any server lists the user; `lastseen:<user>`; `watch` frame + `presence` pushes
- [x] Web: "online" / "last seen today at …" in the chat header, green dot in the list
- [x] Verified: 17 checks (cross-server delivery, presence with two tabs, hard kill of server-2: the
      client reconnects through nginx to server-1, and the stale entry ages out in 40 s); UI with alice on
      server-1 and bob on server-2

## 4. Receipts and typing

- [x] `chat.receipts` + `receipts` consumer group: per-member watermarks in `read_state` (`003_read_state.cql`)
- [x] Ticks derived from watermarks: ✓ sent, ✓✓ delivered to all, blue ✓✓ read by all; tooltip lists who
- [x] Client: delivered when a message reaches the device, read while the chat is open and visible
- [x] Typing indicator over Redis only (not stored), throttled to one frame per 2 s, shown for 4 s
- [x] Verified: 10 checks (an old receipt never moves a watermark back, read keeps delivered, the sender
      counts as having read their own message, typing throttle, non-member receipt rejected) and a UI run
      (blue ticks, typing appears and clears). Fixed on the way: typing right after sending was swallowed
      by the throttle.

## 5. Offline sync

- [x] Reconnect with exponential backoff and full jitter (0.5 s doubling to 30 s), `online`/`offline` events
- [x] Sync after every connect: conversation list, then `after=<cursor>` pages per conversation
- [x] Local history and outbox in IndexedDB (Dexie, one database per user); the app opens offline
- [x] Outbox: pending messages resent in order with the same `clientMsgId` after reconnect
- [x] Verified in the browser: offline bob catches up on 3 messages, his offline message reaches alice
      exactly once, history loads from IndexedDB with both servers down, a pending message survives a
      reload, 5 reconnect attempts in 15 s, the outbox is delivered once after the restart. Fixed on the
      way: Chrome's offline mode never closed the open socket, and an unhandled 502 from `open()`.

## 6. Group chat

- [x] `POST /groups`, `POST /groups/:id/members`, `DELETE /groups/:id/members/:username` (admin or self)
- [x] Max 256 members including the creator; the last admin leaving promotes another member
- [x] Membership changes are system messages in `chat.messages`: ordered with the chat, pushed to all,
      and to the removed member through `alsoNotify`
- [x] Fan-out per member in the delivery consumer (one Redis pipeline, one publish per server)
- [x] "Read by" per member: the tick tooltip lists readers, delivered and waiting
- [x] Web: new-group form, group info panel (add, remove, leave), sender names in bubbles,
      "no longer a member" state
- [x] Verified: 21 checks with 50 members over 2 servers (fan-out to all 50 in 16 ms; 256 members in
      20 ms; a 257th member rejected), admin rules, removal and promotion; UI run with three users

## 7. Wrap-up

- [x] Unread counts: messages after my read watermark, capped at 100 ("99+"); live increments between
      syncs; cleared when the chat is read
- [x] `pnpm db:rebuild`: truncate the message table, replay `chat.messages` with a new persister group
      (512 messages back in 12 s)
- [x] Linux check: clean copy in an Alpine container (Node 24) on the compose network: frozen install,
      oxlint, markdownlint, Prettier, typecheck, web build, `retag-images.sh`, chat-server against the
      compose services, Task 1 and Task 2 end-to-end checks
- [x] [Interview questions](INTERVIEW-QUESTIONS.md): 37 questions in 7 levels and 25 definitions
- [x] Verified: 6 unread checks (sender never counts, read clears, cap), UI badge run, regression of
      Tasks 1, 2 and 4
