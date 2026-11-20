# Decisions (ADRs)

Each record says what was chosen, why, and what was rejected.

## ADR-001 - Stack

Date: 2026-11-06 - Status: Accepted

- **Server:** NestJS 12 on Node 22+, run with `tsx` (no build step). One app, `apps/chat-server`, serves
  REST and (from Task 2) WebSocket and runs the Kafka consumers.
- **Web:** React 19 + Vite 8 + Tailwind 4. No router or state library until a task needs one.
- **Infrastructure:** Cassandra 3.11.9, Kafka 3.5.1 (KRaft), Redis 6.2.24, nginx from Task 3. Everything
  runs from Docker Compose; there is no cloud or Kubernetes target.
- **Clients:** `cassandra-driver` 4.10.0, `@platformatic/kafka` 2.15.0 (pure TypeScript, maintained),
  `redis` 6.3.0.
- **Out of scope:** login, media, end-to-end encryption, observability.

Cassandra 3.11 is the image available here. It has what the design needs: partition and clustering
keys, `TIMEUUID`, TTLs, lightweight transactions and batches. Nothing 4.x/5.x-only is used.

Rejected:

- Socket.IO: it would hide rooms and reconnects, which are what the project is meant to teach.
- Elixir/Phoenix or Go for the gateway: closer to real chat servers, but a new language on top of the
  concepts.
- Postgres for messages: simpler, but Cassandra shows partition-per-conversation modelling directly.
- kafkajs: unmaintained. Confluent's client: native binary.

## ADR-002 - Kafka is the source of truth for messages

Date: 2026-11-06 - Status: Accepted

A send is produced to `chat.messages` with `acks=all` and acknowledged to the sender only then. Two
consumer groups read the topic independently: `persister` writes Cassandra, `delivery` pushes to
connected recipients.

- **No dual write:** Cassandra has no transaction that could include a Kafka publish, so "write the DB,
  then publish" can lose or invent messages. Writing to one place (the log) and deriving the rest avoids it.
- **Ordering:** key = conversation id, so one conversation's messages share a partition and stay in order.
- **Ids:** the server assigns a `TIMEUUID` before producing; Cassandra uses it as the clustering key, so a
  replayed message overwrites the same row.
- **Retention:** `chat.messages` keeps everything (`retention.ms=-1`), so Cassandra can be rebuilt by
  replaying the topic. `chat.receipts` keeps 7 days.
- **Partitions:** 6, enough to show several consumers sharing the work.

Trade-off: history can lag the sender's tick by the persister's delay (milliseconds locally). A client
that reloads at once may miss its own newest message; the client keeps unconfirmed and recent messages
locally (Task 5).

Rejected:

- Write Cassandra first, then Kafka: a crash between the two drops the live delivery.
- Transactional outbox in Cassandra: a logged batch could write the message and an outbox row together,
  but polling and deleting rows makes a queue-shaped table full of tombstones, a known anti-pattern.
- Redis Streams instead of Kafka: fine at this size, but no consumer groups with replay from offset zero
  at Kafka's retention.

## ADR-003 - Local infrastructure and ports

Date: 2026-11-06 - Status: Accepted

- One Compose file, project name `whatsapp-clone`, containers `wa-*`.
- Host ports Kafka 9095 and Redis 6380, so the project runs next to others using the defaults.
- Topics and the keyspace are created by one-shot containers (`kafka-setup`, `cassandra-schema`) that
  are safe to re-run. Kafka auto-creation is off, so a typo in a topic name fails loudly.
- Schema files `infra/cassandra/schema/NNN_*.cql` are applied in name order and use `IF NOT EXISTS`.
  Cassandra has no migration history table; changes are additive (new tables, new columns).
- Redis runs with persistence off: everything in it is rebuilt by clients reconnecting.
- Cassandra heap capped at 512 MB; the image default sizes it from host RAM.
- `stop:pods` keeps volumes; only `reset:pods` deletes data.
- Images are referenced by plain names. A private registry is handled by `infra/retag-images.*`, with
  registry-specific paths in a git-ignored `infra/retag-images.local.json`.

## ADR-004 - Explicit Nest injection tokens

Date: 2026-11-06 - Status: Accepted

`tsx` compiles with esbuild, which does not emit `design:paramtypes` metadata. Nest then injects
`undefined` for class-typed constructor parameters (found when every health check failed with
"Cannot read properties of undefined"). Every constructor parameter uses `@Inject(Token)`.

Rejected: building with `tsc` or SWC for metadata - a build step for no other benefit.
