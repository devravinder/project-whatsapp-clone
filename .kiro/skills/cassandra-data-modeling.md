---
name: cassandra-data-modeling
description: Query-first Cassandra modelling and schema files for this project. Use when adding or changing tables or queries.
---

# Cassandra data modelling

## Rules

- **Start from the query, not the entity.** One table per query; duplicating data across tables is
  normal (`conversations_by_user`, `messages_by_conversation`).
- **Partition key** = what the query filters on with `=`. Keep partitions bounded (well under 100 MB /
  100k rows); split by time bucket if one could grow without limit.
- **Clustering key** = sort order inside the partition. Messages use a `TIMEUUID` with
  `CLUSTERING ORDER BY (message_id DESC)`, so "newest 50" is one slice read.
- **Writes are upserts.** Inserting the same primary key overwrites; that is what makes Kafka replays safe.
- No joins, no `ALLOW FILTERING`, no secondary indexes on high-cardinality columns.
- Lightweight transactions (`IF NOT EXISTS`) cost a Paxos round; use only where uniqueness matters.
- Use prepared statements (`{ prepare: true }`) for every query with parameters.

## Schema files

- `infra/cassandra/schema/NNN_name.cql`, applied in name order by the `cassandra-schema` container
  (`pnpm db:schema`).
- Every statement is re-runnable: `IF NOT EXISTS`. Changes are additive; there is no migration table.
- Version: Cassandra 3.11.9. Avoid 4.x/5.x-only features (SAI indexes, virtual tables).

## Inspect

```bash
docker exec -it wa-cassandra cqlsh -k chat
```
