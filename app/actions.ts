'use server'
// Server Functions: the write path. The browser calls these like async
// functions; Next.js turns each call into a POST to the server.
// docs: libraries/nextjs/16.4.5/content/01-app/02-guides/interactive-apps.mdx

import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { appendMessage, isValidRoom, MAX_NAME, MAX_TEXT, NAME_COOKIE } from '@/lib/chat'
import type { SendResult } from '@/lib/types'

/** Replaces `socket.emit('message', ...)`. Saves the message, then Redis
 *  pub/sub pushes it to every open SSE stream on every instance. */
export async function sendMessage(room: string, input: { id: string; text: string }): Promise<SendResult> {
  const user = (await cookies()).get(NAME_COOKIE)?.value
  if (!user) return { ok: false, error: 'Pick a name first.' }
  if (!isValidRoom(room)) return { ok: false, error: 'Unknown room.' }

  const text = input.text.trim()
  if (!text) return { ok: false, error: 'Message is empty.' }
  if (text.length > MAX_TEXT) return { ok: false, error: `Keep it under ${MAX_TEXT} characters.` }
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false, error: 'Bad message id.' }

  const message = await appendMessage(room, { id: input.id, user, text })
  // No refresh() here: the new message reaches every browser, this one
  // included, through the SSE stream. Re-rendering the route on the server
  // for every chat message would be wasted work.
  return { ok: true, message }
}

/** Sets the display name cookie, then re-renders the page so the chat shows. */
export async function setName(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim().slice(0, MAX_NAME)
  if (!name) return
  ;(await cookies()).set(NAME_COOKIE, name, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  refresh() // docs: libraries/nextjs/16.4.5/content/01-app/api-reference/04-functions/refresh.mdx
}

export async function clearName() {
  ;(await cookies()).delete(NAME_COOKIE)
  refresh()
}
