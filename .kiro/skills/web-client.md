---
name: web-client
description: Structure and rules of apps/web (React + Vite + Tailwind, store, IndexedDB, WebSocket client). Use when changing anything in the web app.
---

# Web client

## Structure

| File                 | Role                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `src/chat-client.ts` | WebSocket, reconnect, sync, outbox, receipts, typing; the only I/O layer |
| `src/store.ts`       | In-memory state + `useStore` (re-render on change); writes through       |
| `src/local-db.ts`    | Dexie database `wa-<username>`: messages, conversations, cursors         |
| `src/api.ts`         | REST calls with the `x-username` header                                  |
| `src/ticks.ts`       | Ticks from member watermarks                                             |
| `src/components/`    | UI only; call `ChatClient` methods, read `store`                         |

## Rules

- **Messages are keyed by `sender:clientMsgId`,** never by `messageId` (unknown until the ack). Every
  path (send, ack, live push, sync, history) lands on the same key, so duplicates collapse.
- **Compare message ids with `compareTimeuuid`/`isAtOrAfter`** from `@wa/protocol`, not as strings.
- **Every UI-triggered promise handles its own errors.** An unhandled rejection is a test failure
  (the UI test fails on any `pageerror`).
- **Offline is normal:** REST calls during an outage must leave local state usable.
- The username lives in `sessionStorage`, so two tabs can be two users.

## Testing in a browser

`playwright-core` with the installed Chrome (`chromium.launch({ channel: "chrome" })`): two browser
contexts are two users. `context.setOffline(true)` fires the `offline` event but does not close
existing sockets by itself.
