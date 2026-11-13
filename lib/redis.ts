import 'server-only'
import { createClient } from 'redis'

// One Redis connection per Next.js process, used for normal commands
// (reading history, saving and publishing messages).
//
// It is kept on `globalThis` so `next dev` hot reloads reuse it instead of
// opening a new connection on every file save.

const makeClient = () => createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' })
type Redis = ReturnType<typeof makeClient>

const g = globalThis as unknown as { __redis?: Promise<Redis> }

export function getRedis(): Promise<Redis> {
  g.__redis ??= (async () => {
    const client = makeClient()
    client.on('error', (err) => console.error('[redis]', err.message))
    await client.connect()
    return client
  })()
  return g.__redis
}
