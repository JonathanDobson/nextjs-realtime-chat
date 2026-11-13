# Glossary

Plain-language meanings of the terms used in this project. Project-specific
terms first, then the wider technology. Linked from [README.md](README.md) and
[CLAUDE.md](CLAUDE.md).

## This project

**Room**: a named chat channel, such as `general`. Its name appears in the URL
(`/rooms/general`) and in the Redis key names. Names are lowercase letters, digits
and dashes, at most 32 characters ([lib/chat.ts](lib/chat.ts)).

**Instance / replica (app1, app2)**: one running copy of the app server.
Compose runs two from the same image to show that a message sent through one
reaches browsers connected to the other. The UI shows which instance rendered
the page and which one is streaming to you.

**Sequence number (`seq`)**: a counter per room that gives every message a
position (1, 2, 3…). It orders messages, and it doubles as the SSE event id so a
reconnecting browser can say "I've seen up to 41".

**Live feed / stream**: the long-lived HTTP response from
`/api/rooms/<room>/events` that sends new messages to the browser as they
happen ([route.ts](app/api/rooms/%5Broom%5D/events/route.ts)).

**Replay**: when a browser reconnects, the server first sends the messages it
missed (read from the Redis history list) and then carries on with live ones.

**Fan-out**: delivering one incoming message to many receivers. Here each app
process receives a message from Redis once and writes it to every open stream
for that room ([lib/realtime.ts](lib/realtime.ts)).

**Pending (optimistic) message**: your own message shown faded before the
server has confirmed it. It is swapped for the confirmed copy, matched by `id`.

**Smoke test**: a quick end-to-end check that the main path works at all.
[e2e/smoke.mjs](e2e/smoke.mjs) drives two real browsers through it.

## Realtime and networking

**Real-time / event-driven updates**: the screen changes because the server
*pushed* news to it, not because the user reloaded or the page polled.

**Polling**: asking the server "anything new?" on a timer. It's simple, but
there's always a delay and it wastes requests. This app doesn't poll.

**WebSocket**: a two-way connection that stays open between browser and
server. Either side can send at any time. socket.io is built on it.

**socket.io**: a popular JavaScript library for WebSocket-style realtime apps.
It is what the original SPA used and what this project replaces.

**SSE (Server-Sent Events)**: a web standard for a one-way live feed from
server to browser over an ordinary HTTP response that stays open. The response
type is `text/event-stream`, and each event is a few `field: value` text lines
followed by a blank line.

**EventSource**: the browser's built-in API for receiving SSE. It reconnects
automatically if the connection drops.

**`Last-Event-ID`**: a header EventSource sends when it reconnects, carrying
the id of the last event it received, so the server can resend what was missed.

**Heartbeat**: a tiny message sent every 15 seconds (`: ping`) so proxies and load
balancers don't close a quiet connection as idle.

**Buffering**: a proxy or compressor collecting a response before passing it
on. It breaks live streams. `X-Accel-Buffering: no` and
`Cache-Control: no-transform` ask the layers in between not to do it.

**HTTP/1.1 vs HTTP/2**: versions of the web protocol. Browsers allow only about 6
simultaneous HTTP/1.1 connections per site, and every open SSE stream uses
one. HTTP/2 shares one connection, so the limit stops mattering.

**Serverless / lambda functions**: hosting where each request runs in a
short-lived function that is stopped after a timeout. That doesn't suit
connections meant to stay open for hours.

## Redis

**Redis**: a fast in-memory database server, run here in its own container. It
stores the recent messages and relays live events between app instances.

**Pub/sub (publish/subscribe)**: a messaging pattern. Publishers send to a
named *channel*; every current subscriber gets a copy. Nothing is stored, so a
subscriber that is offline misses it (hence the replay).

**Pattern subscription (`PSUBSCRIBE`)**: subscribing to every channel whose
name matches a wildcard, here `chat:room:*:events`, so one subscription covers
all rooms.

**List (`RPUSH`, `LRANGE`, `LTRIM`)**: an ordered Redis value. Messages are
appended, read back by position, and trimmed to the latest 200.

**`INCR`**: increments a counter by one and returns the new value as a single
indivisible step, so two instances never get the same sequence number.

**`MULTI` / transaction**: sends several Redis commands as one batch that runs
together.

**AOF (append-only file)**: Redis's option to log every write to disk so data
survives a restart (`--appendonly yes` in compose.yaml).

## Next.js and React

**Next.js**: a React framework that runs code on both the server and in the
browser. This project uses version 16.4.5.

**App Router**: Next.js's folder-based routing. `app/rooms/[room]/page.tsx`
serves `/rooms/<anything>`, and `[room]` is a *dynamic segment* passed in as `params`.

**SPA (Single-Page Application)**: an app that loads one HTML page and does
everything else in browser JavaScript, as the old socket.io chat did.

**Server Component**: a React component that runs only on the server. It can
read cookies and query Redis directly, and only its HTML/output goes to the browser.
Components are Server Components by default.

**Client Component**: a component that also runs in the browser, needed for
state, effects and browser APIs like EventSource. A file opts in with `'use client'`.

**Server Function / Server Action**: an `async` function in a `'use server'`
file that browser code can call like a normal function. Next.js sends the call
to the server as a POST. Here it is the write path (`sendMessage`).

**Route Handler**: a `route.ts` file that answers HTTP requests with a plain
web `Response`, used here for the SSE stream.

**`refresh()`**: a Next.js function, callable only inside a Server Function,
that tells the browser to re-render the current page with fresh server data.
It's used after setting the name cookie, not per chat message.

**Hydration**: React in the browser taking over the HTML the server sent, and
attaching state and event handlers. The browser's first render must match the
server's HTML, which is why local times are filled in after hydration.

**Transition**: React's way of marking an update as non-urgent. Form actions
run inside one automatically.

**`useOptimistic`**: a React hook that shows a temporary "assume it worked"
version of state while an action runs, then falls back to the real state.

**`useEffect`**: a React hook for code that talks to the outside world after
rendering (opening the EventSource, scrolling). It may return a *cleanup*
function, which runs when the component goes away.

**`useSyncExternalStore`**: a React hook for reading a value from outside React.
Here it is used only to tell "server render" apart from "in the browser".

**`PageProps` / typegen**: types that Next.js generates from the `app/` folder
(`next typegen`), so `params` in a page is typed from the route.

**Standalone output**: a build mode (`output: 'standalone'`) that produces a
self-contained `server.js` with only the files it needs. It keeps the Docker
image small.

**`server-only`**: a package that makes the build fail if a server file is
accidentally imported into browser code.

**HMR (Hot Module Replacement)**: `next dev` swapping changed code into a
running app without a restart. Shared connections are kept on `globalThis` so
HMR doesn't open a new Redis connection on every save.

## Containers and tooling

**Docker / container / image**: a container is an isolated process with its
own filesystem. An image is the packaged template it starts from (built by the
[Dockerfile](Dockerfile)).

**Multi-stage build**: a Dockerfile with several stages (install, build, run),
where only the last, small stage becomes the image.

**Docker Compose**: runs several containers together from one file
([compose.yaml](compose.yaml)): Redis, app1 and app2.

**Healthcheck**: a command Compose runs to know a container is ready. The
apps start only once `redis-cli ping` succeeds.

**Playwright**: a library that drives a real browser from a script. The smoke
test uses `playwright-core` with your installed Chrome.
