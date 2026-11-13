import 'server-only'
import { getRedis } from './redis'
import { EVENTS_PATTERN, roomFromChannel } from './chat'
import type { ChatMessage } from './types'

// Fan-out inside one Next.js process.
//
// A Redis connection in subscribe mode can't run normal commands, so each
// process opens ONE extra subscriber connection, pattern-subscribes to every
// room's events channel, and hands each message to the open SSE streams for
// that room. 1,000 browsers connected to this instance still means one Redis
// subscription, not 1,000.

type Listener = (message: ChatMessage) => void

const g = globalThis as unknown as {
  __chatListeners?: Map<string, Set<Listener>>
  __chatSubscriber?: Promise<unknown>
}

const listeners = (g.__chatListeners ??= new Map())

function ensureSubscriber() {
  g.__chatSubscriber ??= (async () => {
    const sub = (await getRedis()).duplicate()
    sub.on('error', (err) => console.error('[redis:sub]', err.message))
    await sub.connect()
    await sub.pSubscribe(EVENTS_PATTERN, (json, channel) => {
      const set = listeners.get(roomFromChannel(channel))
      if (!set?.size) return
      const message = JSON.parse(json) as ChatMessage
      for (const listener of set) listener(message)
    })
    return sub
  })()
  return g.__chatSubscriber
}

/** Call `listener` for every new message in `room`. Returns an unsubscribe function. */
export async function listen(room: string, listener: Listener): Promise<() => void> {
  await ensureSubscriber()
  let set = listeners.get(room)
  if (!set) listeners.set(room, (set = new Set()))
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(room)
  }
}

/** How many SSE streams this process is currently serving (shown in the UI). */
export function openStreams(): number {
  let n = 0
  for (const set of listeners.values()) n += set.size
  return n
}
