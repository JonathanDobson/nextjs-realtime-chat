'use client'
// The browser half. Replaces the socket.io client:
//   socket.on('message')   ->  EventSource on /api/rooms/<room>/events
//   socket.emit('message') ->  the sendMessage Server Function
// with useOptimistic so your own message appears before the server answers.

import { useEffect, useOptimistic, useRef, useState, useSyncExternalStore } from 'react'
import { sendMessage } from '@/app/actions'
import type { ChatMessage } from '@/lib/types'

type Status = 'connecting' | 'live' | 'reconnecting'
type Shown = ChatMessage & { pending?: boolean }

function mergeMessage(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  if (list.some((x) => x.id === m.id)) return list
  return [...list, m].sort((a, b) => a.seq - b.seq)
}

export function ChatRoom({
  room,
  me,
  initialMessages,
}: {
  room: string
  me: string
  initialMessages: ChatMessage[]
}) {
  const [messages, setMessages] = useState(initialMessages)
  const [status, setStatus] = useState<Status>('connecting')
  const [streamHost, setStreamHost] = useState<string>()
  const [error, setError] = useState<string>()

  // Your own unsent messages, layered on top of the confirmed list. When React
  // re-runs this with a new base list (an SSE message arrived mid-send), a
  // pending message whose id is already confirmed is dropped, so no duplicate.
  const [shown, addPending] = useOptimistic<Shown[], Shown>(messages, (base, pending) =>
    base.some((m) => m.id === pending.id) ? base : [...base, pending],
  )

  // Live feed. Opened once per room; EventSource reconnects by itself and
  // resumes from the last event id it saw.
  const lastSeqAtMount = useRef(initialMessages.at(-1)?.seq ?? 0)
  useEffect(() => {
    const es = new EventSource(`/api/rooms/${room}/events?after=${lastSeqAtMount.current}`)
    es.addEventListener('hello', (e) => {
      setStreamHost(JSON.parse(e.data).instance)
      setStatus('live')
    })
    es.addEventListener('message', (e) => {
      const m = JSON.parse(e.data) as ChatMessage
      setMessages((list) => mergeMessage(list, m))
    })
    es.onerror = () => setStatus('reconnecting')
    return () => es.close()
  }, [room])

  // Keep the newest message in view.
  const bottom = useRef<HTMLDivElement>(null)
  // Block body on purpose: newer browsers make scrollIntoView() return a
  // Promise, and an effect that returns a non-function crashes React.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [shown.length])

  async function send(formData: FormData) {
    const text = String(formData.get('text') ?? '').trim()
    if (!text) return
    setError(undefined)
    const id = crypto.randomUUID()
    addPending({ id, room, seq: Number.MAX_SAFE_INTEGER, user: me, text, sentAt: Date.now(), via: '…', pending: true })
    const result = await sendMessage(room, { id, text })
    if (result.ok) setMessages((list) => mergeMessage(list, result.message))
    else setError(result.error)
  }

  return (
    <section className="chat">
      <header>
        <h2># {room}</h2>
        <span className={`status ${status}`}>
          {status === 'live' ? `live · stream from ${streamHost}` : status}
        </span>
      </header>

      <ol className="messages">
        {shown.length === 0 && <li className="empty">No messages yet. Say hello.</li>}
        {shown.map((m) => (
          <li key={m.id} className={[m.user === me && 'mine', m.pending && 'pending'].filter(Boolean).join(' ')}>
            <div className="meta">
              <b>{m.user}</b>
              <LocalTime ms={m.sentAt} />
              <span className="via">{m.pending ? 'sending…' : `#${m.seq} via ${m.via}`}</span>
            </div>
            <p>{m.text}</p>
          </li>
        ))}
        <div ref={bottom} />
      </ol>

      {error && <p className="error">{error}</p>}
      {/* A form action runs in a transition, which useOptimistic needs; React
          also resets the form when the action finishes. */}
      <form action={send} className="composer">
        <input name="text" autoComplete="off" maxLength={500} placeholder={`Message #${room}`} autoFocus />
        <button type="submit">Send</button>
      </form>
    </section>
  )
}

// The server doesn't know the reader's time zone (the container runs in UTC),
// so the clock time is filled in only in the browser, after hydration.
const noSubscribe = () => () => {}
function LocalTime({ ms }: { ms: number }) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false)
  const date = new Date(ms)
  return (
    <time dateTime={date.toISOString()}>
      {isClient ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
    </time>
  )
}
