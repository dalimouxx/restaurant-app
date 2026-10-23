import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { orders, settingsApi } from '../../lib/api'
import { joinRoom, on } from '../../lib/socket'
import type { BoardEntry, Settings } from '../../lib/types'
import { Wordmark } from '../../components/Shell'
import { Emoji } from '../../components/Emoji'
import { traduire } from '../../lib/traductions'

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
        <div className="flex items-center gap-5">
          {settings?.etablissement?.logoUrl ? (
            <span className="grid h-12 w-auto min-w-12 place-items-center overflow-hidden rounded-[11px] bg-white px-1.5">
              <img
                src={settings.etablissement.logoUrl}
                alt=""
                className="max-h-10 w-auto max-w-[140px] object-contain"
              />
            </span>
          ) : (
            <Wordmark />
          )}
          <span className="text-[18px] font-semibold text-ink-500">
            {settings?.restaurantName}
          </span>
        </div>
        <button
          onClick={toggleSound}
          aria-label={sound ? 'Couper le son' : 'Activer le son'}
          className="reagit grid size-10 place-items-center rounded-[9px] text-ink-500 transition-colors hover:bg-ink-800 hover:text-white"
        >
          {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_1.4fr]">
        {/* En préparation */}
        <section className="border-ink-800 p-8 lg:border-r">
          {/* Bilingue, et sans sélecteur : l'écran est au mur, lu en
              même temps par des clients qui lisent le français et par
              d'autres qui lisent l'arabe. Personne ne viendra toucher
              un bouton sur un mur, et choisir une langue reviendrait à
              laisser la moitié de la salle devant un écran qu'elle ne
              lit pas. Les libellés sont courts : les deux tiennent. */}
          <h2 className="mb-6 flex items-center gap-2.5 text-[22px] font-bold tracking-[-0.01em] text-ink-500">
            <Emoji vie="bat" className="text-[24px]">🔥</Emoji>
            En préparation
            <span lang="ar" dir="rtl" className="text-ink-600">
              · {traduire('suivi.preparation', 'ar')}
            </span>
          </h2>
          {cooking.length === 0 ? (
            <p className="text-[18px] text-ink-700">—</p>
          ) : (
            <div className="anim-cascade flex flex-wrap items-center gap-x-7 gap-y-4">
              {cooking.map((e) => (
                <span
                  key={e.orderNumber}
                  className="num flex items-center gap-2 text-[56px] leading-none font-bold text-ink-600"
                >
                  <Emoji className="text-[34px]">👨‍🍳</Emoji>
                  {String(e.orderNumber).padStart(3, '0')}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Prêtes */}
        <section className="p-8">
          <h2 className="mb-6 flex items-center gap-2.5 text-[22px] font-bold tracking-[-0.01em] text-petrol-400">
            <Emoji vie="rebondit" className="text-[24px]">🛎️</Emoji>
            Prêtes
            <span lang="ar" dir="rtl" className="text-petrol-500">
              · {traduire('salle.pretes', 'ar')}
            </span>
          </h2>
          {ready.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 pb-20 text-ink-700">
              <Emoji vie="flotte" className="text-[64px]">🍔</Emoji>
              <p className="text-[20px]">Aucune commande prête</p>
              <p lang="ar" dir="rtl" className="text-[20px]">
                {traduire('salle.aucunePrete', 'ar')}
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-5">
              {ready.map((e, i) => (
                <span
                  key={e.orderNumber}
                  style={{ animationDelay: `${i * 90}ms` }}
                  className="anim-surgit anim-halo num flex items-center gap-4 rounded-[22px] bg-petrol-600 px-8 py-5 text-[88px] leading-none font-bold text-white"
                >
                  {String(e.orderNumber).padStart(3, '0')}
                  <Emoji vie="rebondit" retard={i * 180} className="text-[52px]">
                    🎉
                  </Emoji>
                </span>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-ink-800 px-8 py-4 text-center text-[17px] text-ink-600">
        Votre numéro s'affiche en vert quand votre commande est prête
        <span lang="ar" dir="rtl" className="ms-3">
          · {traduire('salle.consigne', 'ar')}
        </span>
      </footer>
    </div>
  )
}
