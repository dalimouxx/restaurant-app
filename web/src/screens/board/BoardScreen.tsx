import { useCallback, useEffect, useRef, useState } from 'react'
import { ChefHat, Volume2, VolumeX } from 'lucide-react'
import { orders, settingsApi } from '../../lib/api'
import { joinRoom, on } from '../../lib/socket'
import type { BoardEntry, Settings } from '../../lib/types'
import { Wordmark } from '../../components/Shell'

/**
 * Écran mural des commandes prêtes.
 *
 * Jusqu'ici, la cuisine marquait une commande prête et personne ne
 * prévenait le client : il attendait au comptoir, ou demandait. Cet écran
 * se lit depuis le fond de la salle, et c'est son seul travail — pas de
 * montants, pas de plats, rien que des numéros.
 *
 * Il ne demande aucune connexion : un écran accroché au mur ne doit pas
 * garder une session de caissier ouverte. Le serveur ne lui envoie donc
 * que des numéros et des états.
 */
export default function BoardScreen() {
  const [entries, setEntries] = useState<BoardEntry[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem('service.boardSound') === 'on'
    } catch {
      return false
    }
  })
  const knownReady = useRef<Set<number>>(new Set())
  const firstLoad = useRef(true)

  const load = useCallback(async () => {
    try {
      const list = await orders.board()
      setEntries(list)

      // Un numéro qui vient de passer à « prête » mérite un signal sonore.
      const ready = new Set(list.filter((e) => e.status === 'ready').map((e) => e.orderNumber))
      if (!firstLoad.current) {
        for (const n of ready) {
          if (!knownReady.current.has(n)) chime()
        }
      }
      knownReady.current = ready
      firstLoad.current = false
    } catch {
      /* le cycle suivant rattrapera */
    }
  }, [])

  /** Deux notes brèves, synthétisées : aucun fichier à héberger. */
  const chime = useCallback(() => {
    if (!sound) return
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const now = ctx.currentTime
      for (const [i, freq] of [880, 1174].entries()) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = freq
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.0001, now + i * 0.18)
        gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.3)
        osc.connect(gain).connect(ctx.destination)
        osc.start(now + i * 0.18)
        osc.stop(now + i * 0.18 + 0.32)
      }
      setTimeout(() => ctx.close(), 1200)
    } catch {
      /* navigateur sans audio, ou son refusé : l'écran suffit */
    }
  }, [sound])

  useEffect(() => {
    load()
    settingsApi.get().then(setSettings).catch(() => {})
    const leave = joinRoom('board')
    const off = on('board:updated', load)
    // Filet : si la connexion temps réel tombe, l'écran reste juste.
    const poll = setInterval(load, 12000)
    return () => {
      leave()
      off()
      clearInterval(poll)
    }
  }, [load])

  function toggleSound() {
    setSound((v) => {
      const next = !v
      try {
        localStorage.setItem('service.boardSound', next ? 'on' : 'off')
      } catch {
        /* mode privé */
      }
      return next
    })
  }

  const ready = entries.filter((e) => e.status === 'ready')
  const cooking = entries.filter((e) => e.status !== 'ready')

  return (
    <div className="dark-surface flex min-h-dvh flex-col bg-ink-900">
      <header className="flex items-center justify-between gap-4 border-b border-ink-800 px-8 py-5">
        <div className="flex items-baseline gap-5">
          <Wordmark />
          <span className="text-[18px] font-semibold text-ink-500">
            {settings?.restaurantName}
          </span>
        </div>
        <button
          onClick={toggleSound}
          aria-label={sound ? 'Couper le son' : 'Activer le son'}
          className="grid size-10 place-items-center rounded-[9px] text-ink-500 transition-colors hover:bg-ink-800 hover:text-white"
        >
          {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_1.4fr]">
        {/* En préparation */}
        <section className="border-ink-800 p-8 lg:border-r">
          <h2 className="mb-6 text-[22px] font-bold tracking-[-0.01em] text-ink-500">
            En préparation
          </h2>
          {cooking.length === 0 ? (
            <p className="text-[18px] text-ink-700">—</p>
          ) : (
            <div className="flex flex-wrap gap-x-7 gap-y-4">
              {cooking.map((e) => (
                <span
                  key={e.orderNumber}
                  className="num text-[56px] leading-none font-bold text-ink-600"
                >
                  {String(e.orderNumber).padStart(3, '0')}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Prêtes */}
        <section className="p-8">
          <h2 className="mb-6 text-[22px] font-bold tracking-[-0.01em] text-petrol-400">
            Prêtes
          </h2>
          {ready.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 pb-20 text-ink-700">
              <ChefHat size={56} strokeWidth={1.5} />
              <p className="text-[20px]">Aucune commande prête</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-5">
              {ready.map((e) => (
                <span
                  key={e.orderNumber}
                  className="num animate-ticket-in rounded-[18px] bg-petrol-600 px-8 py-5 text-[88px] leading-none font-bold text-white"
                >
                  {String(e.orderNumber).padStart(3, '0')}
                </span>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-ink-800 px-8 py-4 text-center text-[17px] text-ink-600">
        Votre numéro s'affiche en vert quand votre commande est prête
      </footer>
    </div>
  )
}
