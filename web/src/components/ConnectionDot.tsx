import { useEffect, useState } from 'react'
import { getSocket } from '../lib/socket'

/**
 * Indique si l'écran reçoit encore les événements temps réel.
 * Sans ça, un opérateur peut regarder une file figée sans le savoir.
 */
export function ConnectionDot({ dark = false }: { dark?: boolean }) {
  const [online, setOnline] = useState(() => getSocket().connected)

  useEffect(() => {
    const s = getSocket()
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    s.on('connect', up)
    s.on('disconnect', down)
    s.on('connect_error', down)
    setOnline(s.connected)
    return () => {
      s.off('connect', up)
      s.off('disconnect', down)
      s.off('connect_error', down)
    }
  }, [])

  if (online) {
    return (
      <span
        title="Connecté en temps réel"
        className="inline-flex items-center gap-1.5"
        aria-label="Connecté en temps réel"
      >
        <span className="size-1.5 rounded-full bg-petrol-500" />
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
        dark ? 'bg-coral-500/15 text-coral-500' : 'bg-coral-50 text-coral-700'
      }`}
    >
      <span className="size-1.5 animate-pulse rounded-full bg-coral-500" />
      Hors ligne
    </span>
  )
}
