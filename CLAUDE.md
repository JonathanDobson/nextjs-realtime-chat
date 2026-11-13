# nextjs-realtime-chat: instructions for agents

Demo of realtime chat on Next.js 16 (App Router) with Server-Sent Events and
Redis pub/sub, replacing a socket.io SPA. Overview and architecture:
[README.md](README.md). Every term used here, in plain language:
**[GLOSSARY.md](GLOSSARY.md)**. Add new terms to it in the same change.

- Next.js behaviour questions: use the `local-docs` skill, Next.js 16.4.5
  (`~/local-docs/libraries/nextjs/16.4.5/`), and cite the file.
- Run: `docker compose up -d --build`, then app1 on :3001 and app2 on :3002.
- Verify a change: `npm run typecheck` and `npm run smoke` (with the stack up).
  The smoke test drives two real browsers across both instances, including a
  restart of app2.
- `app/actions.ts` is a `'use server'` file: export only async functions from
  it; constants live in `lib/chat.ts`.
- Effects must return a cleanup function or nothing; never return the result
  of a call like `scrollIntoView()`, which returns a Promise in newer browsers.
- Times are formatted in the browser only (`LocalTime`). The containers run in
  UTC and the user reads GMT+8.
