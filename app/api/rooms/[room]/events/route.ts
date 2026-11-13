// The live feed for one room, as Server-Sent Events (SSE).
// docs: libraries/nextjs/16.4.5/content/01-app/02-guides/streaming.mdx:482 (Streaming in Route Handlers)
//
// The browser opens this with `new EventSource(...)` and keeps it open. Every
// message published to the room in Redis, by ANY app instance, is written to
// the stream. If the connection drops, EventSource reconnects by itself and
// sends a `Last-Event-ID` header; the missed messages are replayed from the
// Redis history before live events resume.

import { getSince, instanceName, isValidRoom } from '@/lib/chat'
import { listen, openStreams } from '@/lib/realtime'
import type { ChatMessage } from '@/lib/types'

const HEARTBEAT_MS = 15_000

export async function GET(request: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room } = await params
  if (!isValidRoom(room)) return new Response('Unknown room', { status: 404 })

  // Resume point: the header on an automatic reconnect, else ?after= from the
  // page (the last message it rendered on the server).
  const resumeFrom = Number(
    request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('after') ?? 0,
  ) || 0

  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const write = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      const sent = new Set<number>()
      const emit = (m: ChatMessage) => {
        if (m.seq <= resumeFrom || sent.has(m.seq)) return
        sent.add(m.seq)
        write(`id: ${m.seq}\nevent: message\ndata: ${JSON.stringify(m)}\n\n`)
      }

      // Subscribe BEFORE reading the backlog, buffering live events meanwhile,
      // so nothing published in between is lost.
      const buffered: ChatMessage[] = []
      let replaying = true
      const unlisten = await listen(room, (m) => (replaying ? buffered.push(m) : emit(m)))

      write('retry: 2000\n\n') // reconnect delay hint for EventSource
      write(`event: hello\ndata: ${JSON.stringify({ instance: instanceName(), streams: openStreams() })}\n\n`)

      if (resumeFrom > 0) for (const m of await getSince(room, resumeFrom)) emit(m)
      replaying = false
      buffered.sort((a, b) => a.seq - b.seq).forEach(emit)

      // Comment lines keep proxies and load balancers from closing an idle connection.
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)

      cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unlisten()
        try {
          controller.close()
        } catch {}
      }
      request.signal.addEventListener('abort', () => cleanup())
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: stops gzip from buffering the stream.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx-style proxies not to buffer (streaming.mdx, "Reverse proxies").
      'X-Accel-Buffering': 'no',
    },
  })
}
