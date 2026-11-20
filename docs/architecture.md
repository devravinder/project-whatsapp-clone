# Architecture

Target design. Parts not built yet are marked with the task that adds them (see [TASKS.md](TASKS.md)).

## 1. Components

```mermaid
flowchart LR
  W1[Browser: Alice] <-->|WebSocket + REST| LB[nginx - Task 3]
  W2[Browser: Bob] <-->|WebSocket + REST| LB
  LB <--> S1[chat-server-1]
  LB <--> S2[chat-server-2 - Task 3]
  S1 -->|produce| K[[Kafka chat.messages]]
  S2 -->|produce| K
  K --> P[persister group]
  K --> D[delivery group]
  P --> C[(Cassandra)]
  D -->|lookup + publish| R[(Redis)]
  R -->|pub/sub per server| S1
  R -->|pub/sub per server| S2
  S1 -->|history, sync| C
```

| Part        | Owns                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| chat-server | WebSocket connections, REST API, producing to Kafka, both consumer groups |
| Kafka       | The message log: ordered per conversation, kept forever, replayable       |
| Cassandra   | Read model: history and conversation lists, one table per query           |
| Redis       | Ephemeral state: which server holds which user, presence, typing          |
| web         | UI, local history (IndexedDB, Task 5)                                     |

Both consumer groups run inside chat-server to keep the project small. In production they would be
separate deployments, scaled on their own.

## 2. Sending a message

```mermaid
sequenceDiagram
  participant A as Alice
  participant S1 as chat-server-1
  participant K as Kafka
  participant P as persister
  participant C as Cassandra
  participant D as delivery
  participant R as Redis
  participant S2 as chat-server-2
  participant B as Bob
  A->>S1: send clientMsgId, conversationId, text
  S1->>K: produce, key = conversationId, acks=all
  S1-->>A: ack with messageId = single tick
  K->>P: consume
  P->>C: upsert by primary key
  K->>D: consume
  D->>R: where is Bob? server-2
  D->>R: PUBLISH server:server-2
  R->>S2: message
  S2->>B: deliver
  B->>S2: delivered, later read
```

The sender gets its tick once Kafka has the message, before Cassandra does. Cassandra and live delivery
are both consumers of the log, so either can fall behind or crash without losing a message (ADR-002).

## 3. Data placement

| Data                    | Store                 | Why                                    |
| ----------------------- | --------------------- | -------------------------------------- |
| Messages (truth)        | Kafka `chat.messages` | Ordered, durable, replayable           |
| Messages (read model)   | Cassandra             | Paged history per conversation         |
| Conversation list       | Cassandra             | Per-user query, denormalised           |
| Receipts                | Kafka `chat.receipts` | Fan back to the sender (Task 4)        |
| User → server, presence | Redis with TTL        | Lost on restart, rebuilt by reconnects |
| Typing                  | Redis pub/sub only    | Worthless a few seconds later          |
