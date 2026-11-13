# Next.js 16 realtime chat (Server-Sent Events + Redis)

A working replacement for a socket.io single-page chat app, built the way the
Next.js 16 docs point you: **Server Functions for writes, a streaming Route
Handler for the live feed, and Redis pub/sub to connect the app instances.**
Two copies of the app run side by side to prove that messages cross instances.

New to any of the terms here? See **[GLOSSARY.md](GLOSSARY.md)**.

## Run it

```bash
docker compose up -d --build
```

Open **http://localhost:3001** (instance `app1`) and **http://localhost:3002**
(instance `app2`) in two windows, using a private window for one so the name cookies differ.
A message sent in one window appears in the other almost at once (about 50 ms locally),
even though each window talks to a different server.

Things to try:

- `docker compose stop app2`: that window's badge turns **reconnecting**. Send
  from the other window, then `docker compose start app2`. The missed
  messages appear as soon as it reconnects.
- Reload: history is rendered on the server from Redis, so it is in the first paint.
- `curl -N http://localhost:3002/api/rooms/general/events` shows the raw stream.

Automated check (needs Chrome or Chromium installed; stack running):

```bash
npm install && npm run smoke
```

Stop everything: `docker compose down` (add `-v` to wipe the Redis data).

## How it maps from socket.io

| socket.io SPA | This app | File |
|---|---|---|
| `io()` connect, `socket.on('message')` | `new EventSource('/api/rooms/<room>/events')` | [components/ChatRoom.tsx](components/ChatRoom.tsx) |
| socket.io server holding the open sockets | Route Handler that streams `text/event-stream` | [app/api/rooms/[room]/events/route.ts](app/api/rooms/%5Broom%5D/events/route.ts) |
| `socket.emit('message', …)` | `sendMessage()` Server Function | [app/actions.ts](app/actions.ts) |
| socket.io Redis adapter (multi-server) | Redis `PUBLISH`, plus one pattern subscription per process with in-process fan-out | [lib/chat.ts](lib/chat.ts), [lib/realtime.ts](lib/realtime.ts) |
| Fetch history after mount | Server Component reads history before render | [app/rooms/[room]/page.tsx](app/rooms/%5Broom%5D/page.tsx) |
| Local "sending…" state | `useOptimistic` | [components/ChatRoom.tsx](components/ChatRoom.tsx) |
| Reconnect logic and missed-message sync | EventSource auto-reconnect + `Last-Event-ID` replay from the Redis history | route handler above |

### The flow of one message

1. Ana presses Send. `useOptimistic` shows her message straight away, faded.
2. The browser calls the `sendMessage` Server Function on **app1**. It checks the
   input, gets the next sequence number (`INCR`), appends the message to the
   room's Redis list, and `PUBLISH`es it, all in one round trip.
3. Every app process has one Redis connection subscribed to
   `chat:room:*:events`. **app1** and **app2** both receive the message and write it
   to each open SSE stream for that room.
4. Ben's browser (on **app2**) receives `event: message` and appends it. Ana's
   browser gets it too and merges it by `id`, so there is no duplicate.

### Redis layout (per room)

| Key | Type | Purpose |
|---|---|---|
| `chat:room:<room>:seq` | counter | next sequence number; also the SSE event id |
| `chat:room:<room>:messages` | list | last 200 messages, JSON |
| `chat:room:<room>:events` | pub/sub channel | live fan-out to every instance |

## What the Next.js docs say (and where this demo follows them)

From the local-docs copy, Next.js **16.4.5** (`v16.4.5 @4e5335a`):

- Route Handlers can stream with `ReadableStream`, "useful for Server-Sent
  Events": `content/01-app/02-guides/streaming.mdx:482`.
- Proxies buffer streams unless told otherwise (`X-Accel-Buffering: no`):
  same file, "Reverse proxies".
- On hosts that run Route Handlers as lambda functions, long-lived connections
  get cut and "WebSockets won't work": `content/01-app/02-guides/backend-for-frontend.mdx` ("Deployment environment").
- Server Function + `refresh()` / `useOptimistic` patterns:
  `content/01-app/02-guides/interactive-apps.mdx`, `content/01-app/api-reference/04-functions/refresh.mdx`.
- `output: 'standalone'` for the Docker image:
  `content/01-app/api-reference/05-config/01-next-config-js/output.mdx`.

The Redis client code (`redis` npm package v6) is **not** in local-docs. It was
written from memory and checked against the package's type definitions and by the
smoke test.

## Limits and when to choose differently

- **Needs a long-running Node server** (Docker, VM, Kubernetes). On serverless
  hosts the stream is cut at the function timeout. EventSource reconnects and
  replays, so it limps along, but use a hosted realtime service there instead.
- **SSE is one-way (server to browser).** That's enough for chat because sends
  go through Server Functions. For high-frequency browser-to-server traffic
  (typing indicators every keystroke, cursors, games), use a WebSocket service
  running beside Next.js.
- **HTTP/1.1 allows about 6 connections per host**, and each SSE stream takes one.
  Put the app behind HTTP/2 (any modern reverse proxy) for real use.
- **Redis pub/sub is fire-and-forget.** A message published while an instance
  is down isn't queued for it. The `Last-Event-ID` replay from the Redis list
  covers that gap, up to the last 200 messages.
- **No real login.** The display name is an unsigned cookie. Replace it with
  your auth before using this for anything real.
- **Several instances, one image.** Server Function IDs are tied to the build.
  Both replicas here share one image. If you ever run different builds side by
  side, set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (see the Next.js self-hosting guide).

## Local development without Docker for the app

```bash
docker compose up -d redis
```

```bash
npm install && npm run dev
```

Then open http://localhost:3000. Redis is published on `127.0.0.1:6379` for this.

## Layout

```
app/
  page.tsx                          redirects to /rooms/general
  rooms/[room]/page.tsx             Server Component: name form or chat + history
  api/rooms/[room]/events/route.ts  SSE stream (live feed + replay)
  actions.ts                        Server Functions: sendMessage, setName, clearName
components/ChatRoom.tsx             Client Component: EventSource, useOptimistic, UI
lib/
  redis.ts                          one shared Redis connection per process
  chat.ts                           Redis keys, history, appendMessage
  realtime.ts                       one subscriber per process, fan-out to streams
  types.ts                          ChatMessage type (shared by server and client)
e2e/smoke.mjs                       two-browser end-to-end check
Dockerfile, compose.yaml            image + Redis + app1/app2
```
