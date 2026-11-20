---
name: kafka-messaging
description: Kafka topics, keys, consumer groups and delivery guarantees in this project. Use when producing or consuming chat.messages or chat.receipts.
---

# Kafka messaging

## Topics

| Topic           | Key            | Partitions | Retention | Consumers               |
| --------------- | -------------- | ---------- | --------- | ----------------------- |
| `chat.messages` | conversationId | 6          | forever   | `persister`, `delivery` |
| `chat.receipts` | conversationId | 6          | 7 days    | `delivery` (Task 4)     |

Topics are created by `kafka-setup` in `infra/docker-compose.yaml`; auto-creation is off.

## Rules

- **Key = conversationId** so a conversation stays in order. Never key by sender.
- **Produce with `idempotent: true, acks: -1`** and ack the client only after the send resolves.
- **At-least-once:** commit offsets after the work is done. Every consumer is idempotent - Cassandra
  upserts by primary key, the client drops a `messageId` it already has.
- **Each group reads everything.** A new group can start from the earliest offset to rebuild state.
- **Short session timeouts** (10 s) on every consumer: with the 60 s default, a killed server's dead
  member blocks its group's partitions for up to a minute after restart (ADR-009).
- **Retry a failing handler, do not skip it** (the log is the truth); only a record that cannot be
  parsed is logged and skipped.
- Client: `@platformatic/kafka` (`Producer`, `Consumer`, `Admin`), string serializers, JSON values.
- Brokers from the host: `localhost:9095`; from containers: `kafka:9092`.

## Inspect

```bash
docker exec -it wa-kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic chat.messages --from-beginning --property print.key=true
docker exec -it wa-kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --all-groups
```
