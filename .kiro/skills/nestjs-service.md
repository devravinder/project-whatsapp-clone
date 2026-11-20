---
name: nestjs-service
description: Patterns for apps/chat-server (NestJS 12 run by tsx). Use when adding controllers, providers, gateways or consumers.
---

# NestJS service patterns

## Injection

`tsx` (esbuild) emits no decorator metadata, so Nest cannot see constructor parameter types.
**Every constructor parameter needs `@Inject(Token)`**, including classes:

```ts
constructor(
  @Inject(APP_CONFIG) private readonly config: AppConfig,
  @Inject(CassandraService) private readonly cassandra: CassandraService,
) {}
```

Symptom when missing: `Cannot read properties of undefined` on the first use (ADR-004).

## Config

- One Zod schema in `src/config.ts`, parsed once and provided as `APP_CONFIG`.
- Defaults live in `.env.sample` (tracked, no secrets), loaded by `tsx --env-file`.
- A second instance overrides per shell: `PORT=4002 SERVER_ID=server-2`.

## Infrastructure clients

- One `@Injectable()` wrapper per store in `src/infra/`, with `ping()` for `/health` and cleanup in
  `onModuleDestroy`.
- Connect lazily, so the server starts while a container is still booting.
- Redis: attach an `error` listener, or a dropped connection crashes the process.
- Health checks run in parallel, each with a timeout; 503 carries the per-dependency body.
