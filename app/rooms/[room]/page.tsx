// The chat page. A Server Component: it reads the cookie and the recent
// history on the server, so the first paint already shows messages; no
// fetch-after-mount like the old SPA did.

import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { getHistory, instanceName, isValidRoom, MAX_NAME, NAME_COOKIE } from '@/lib/chat'
import { clearName, setName } from '@/app/actions'
import { ChatRoom } from '@/components/ChatRoom'

const ROOMS = ['general', 'random', 'help']

export default async function RoomPage({ params }: PageProps<'/rooms/[room]'>) {
  const { room } = await params
  if (!isValidRoom(room)) notFound()

  const name = (await cookies()).get(NAME_COOKIE)?.value

  return (
    <main className="shell">
      <aside className="sidebar">
        <h1>Rooms</h1>
        <nav>
          {ROOMS.map((r) => (
            <Link key={r} href={`/rooms/${r}`} className={r === room ? 'active' : undefined}>
              # {r}
            </Link>
          ))}
        </nav>
        <p className="served">
          Page rendered by <b>{instanceName()}</b>
        </p>
        {name && (
          <form action={clearName} className="whoami">
            <span>
              You are <b>{name}</b>
            </span>
            <button type="submit" className="link">
              change
            </button>
          </form>
        )}
      </aside>

      {name ? (
        // key={room}: switching rooms remounts the component, closing the old
        // room's stream and opening the new one.
        <ChatRoom key={room} room={room} me={name} initialMessages={await getHistory(room)} />
      ) : (
        <section className="join">
          <form action={setName}>
            <h2>Pick a display name</h2>
            <input name="name" maxLength={MAX_NAME} required autoFocus placeholder="e.g. Ana" />
            <button type="submit">Join #{room}</button>
          </form>
        </section>
      )}
    </main>
  )
}
