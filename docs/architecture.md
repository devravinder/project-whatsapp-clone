# Architecture

How the parts fit together. The reasons and rejected options are in [DECISIONS.md](DECISIONS.md).

## 1. Components

```mermaid
flowchart LR
  W1[Browser: Alice] <-->|WebSocket + REST| LB[nginx :4000]
  W2[Browser: Bob] <-->|WebSocket + REST| LB
  LB <--> S1[chat-server-1]
  LB <--> S2[chat-server-2]
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
| web         | UI, local history and outbox (IndexedDB)                                  |

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
| Receipts                | Kafka `chat.receipts` | Watermarks, pushed to all members      |
| User → server, presence | Redis with TTL        | Lost on restart, rebuilt by reconnects |
| Typing                  | Redis pub/sub only    | Worthless a few seconds later          |

## 4. Cassandra tables

```mermaid
erDiagram
  USERS ||--o{ MEMBERS_BY_CONVERSATION : "is member"
  CONVERSATIONS ||--o{ MEMBERS_BY_CONVERSATION : has
  CONVERSATIONS ||--o{ MESSAGES_BY_CONVERSATION : holds
  USERS ||--o{ CONVERSATIONS_BY_USER : lists
  USERS {
    text username PK
  }
  CONVERSATIONS {
    text conversation_id PK
    text kind
    text title
  }
  MEMBERS_BY_CONVERSATION {
    text conversation_id PK
    text username "clustering"
    text role
  }
  CONVERSATIONS_BY_USER {
    text username PK
    text conversation_id "clustering"
    timeuuid last_message_id
    text last_preview
  }
  MESSAGES_BY_CONVERSATION {
    text conversation_id PK
    timeuuid message_id "clustering DESC"
    text sender
    text body
  }
```

Lines show where data is duplicated, not joins: Cassandra has none. Each table answers one query
(ADR-005).
