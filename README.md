# Mini WhatsApp

A learning-oriented WhatsApp clone: person-to-person and group text chat, built to understand the
system design behind a messaging app. It runs only on your machine, with Docker for the infrastructure.

| Concept                    | Where it shows up                                             |
| -------------------------- | ------------------------------------------------------------- |
| Log as the source of truth | Every message goes to Kafka first; Cassandra is built from it |
| Ordering per conversation  | Kafka key = conversation id                                   |
| Query-first data modelling | One Cassandra table per query                                 |
| Stateful connections       | WebSocket servers, routed through Redis                       |
| Delivery while offline     | Sync "since cursor" on reconnect                              |
| Receipts and presence      | Single, double and blue ticks; online and last seen           |
| Group fan-out              | One message, one delivery per member                          |

Out of scope on purpose: login (you pick a username), media, end-to-end encryption, observability,
cloud deployment.

- [How to run](docs/HOW-TO-RUN.md)
- [Tasks](docs/TASKS.md)
- [Architecture](docs/architecture.md)
- [Decisions (ADRs)](docs/DECISIONS.md)
- [Interview questions](docs/INTERVIEW-QUESTIONS.md)
