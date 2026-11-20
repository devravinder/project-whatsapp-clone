---
name: project-conventions
description: How this repo is organised, what every task must update, and cross-platform rules. Use at the start of any task in this project.
---

# Project conventions

## Layout

- `apps/chat-server` - NestJS: REST, WebSocket, Kafka consumers. Package `@wa/chat-server`.
- `apps/web` - React + Vite + Tailwind. Package `@wa/web`.
- `libs/*` - shared code once two apps need it (e.g. WebSocket message schemas).
- `infra/` - Compose file, Cassandra schema, retag scripts.
- `docs/` - TASKS, HOW-TO-RUN, DECISIONS (ADRs), architecture. `http/` - REST Client requests.

## Every task updates

1. `docs/TASKS.md` - mark `[x]`, or `[~]` with what is missing.
2. `docs/HOW-TO-RUN.md` - when commands, ports or env vars change.
3. `docs/DECISIONS.md` - an ADR for each choice with a rejected alternative, and for anything learned
   the hard way.
4. `http/*.http` - when an endpoint is added or changed.
5. `.kiro/skills` - when a new pattern or gotcha appears.

## Rules

- Pin exact dependency versions; pick the latest that your registry resolves.
- Comments: one line, at most 15 words, the why (see `code-comments`).
- Windows (PowerShell) and Ubuntu (bash) both work: scripts are pnpm or Node, never shell-specific;
  shell scripts get a `.ps1` and a `.sh` twin, and `.sh`/husky hooks are committed as mode 100755.
- No organisation names, registry hosts or internal paths in tracked files. Before committing:
  `git grep --cached -i -n -w -E "<org terms>"` must find nothing.
- Commits: Conventional, lowercase subject, under 10 words, one commit at the end of each task.

## Ports

chat-server-1 4001, chat-server-2 4002 (Task 3), nginx 4000 (Task 3), web 5180, Cassandra 9042,
Kafka 9095, Redis 6380.
