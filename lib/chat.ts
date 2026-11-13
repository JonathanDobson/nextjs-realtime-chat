import 'server-only'
import { getRedis } from './redis'
import type { ChatMessage } from './types'

// Storage layout in Redis, per room:
//   chat:room:<room>:seq       counter; INCR gives each message its sequence number
//   chat:room:<room>:messages  list of the last HISTORY_LIMIT messages, as JSON
//   chat:room:<room>:events    pub/sub channel; every new message is published here

const HISTORY_LIMIT = 200
const ROOM_RE = /^[a-z0-9-]{1,32}$/

export const MAX_TEXT = 500
export const MAX_NAME = 24
export const NAME_COOKIE = 'chat-name'

export function isValidRoom(room: string): boolean {
  return ROOM_RE.test(room)
}

const key = (room: string, part: 'seq' | 'messages' | 'events') => `chat:room:${room}:${part}`
export const EVENTS_PATTERN = 'chat:room:*:events'
export const roomFromChannel = (channel: string) => channel.split(':')[2]

export const instanceName = () => process.env.INSTANCE_NAME ?? 'dev'

/** The most recent messages in a room, oldest first. */
export async function getHistory(room: string, limit = 50): Promise<ChatMessage[]> {
  const redis = await getRedis()
  const rows = await redis.lRange(key(room, 'messages'), -limit, -1)
  return rows.map((r) => JSON.parse(r) as ChatMessage)
}

/** Messages with a sequence number above `afterSeq`: used to replay what a
 *  reconnecting browser missed while it was offline. */
export async function getSince(room: string, afterSeq: number): Promise<ChatMessage[]> {
  const redis = await getRedis()
  const rows = await redis.lRange(key(room, 'messages'), 0, -1)
  return rows.map((r) => JSON.parse(r) as ChatMessage).filter((m) => m.seq > afterSeq)
}

/** Save a message and publish it to every server instance subscribed to the room. */
export async function appendMessage(
  room: string,
  input: { id: string; user: string; text: string },
): Promise<ChatMessage> {
  const redis = await getRedis()
  const seq = await redis.incr(key(room, 'seq'))
  const message: ChatMessage = {
    ...input,
    room,
    seq,
    sentAt: Date.now(),
    via: instanceName(),
  }
  const json = JSON.stringify(message)
  await redis
    .multi()
    .rPush(key(room, 'messages'), json)
    .lTrim(key(room, 'messages'), -HISTORY_LIMIT, -1)
    .publish(key(room, 'events'), json)
    .exec()
  return message
}
