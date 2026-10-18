import { useCallback, useEffect, useState } from 'react'
import {
  Ban,
  Bike,
  ChefHat,
  Check,
  PlusCircle,
  Smartphone,
  Store,
} from 'lucide-react'
import { orders } from '../../lib/api'
import { joinRoom, on } from '../../lib/socket'
import { elapsed, elapsedMinutes, orderNo } from '../../lib/format'
import type { Order } from '../../lib/types'
import { EmptyState, useNow, useToast } from '../../components/ui'
import { ConnectionDot } from '../../components/ConnectionDot'
import { Wordmark } from '../../components/Shell'

/** Seuils d'alerte, en minutes depuis l'arrivée du ticket. */
const WARN_AT = 8
const LATE_AT = 15

export default function KitchenScreen() {
  const [queue, setQueue] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { notify } = useToast()
  const now = useNow(10000)

  const load = useCallback(async () => {
    try {
      setQueue(await orders.kitchenQueue())
    } catch {
      /* reconnexion gérée par le socket et le cycle suivant */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const leave = joinRoom('kitchen')
    const offNew = on('kitchen:new_ticket', () => {
      load()
      notify('Nouveau ticket.', 'info')
    })
    const offUpd = on('order:updated', load)
    const poll = setInterval(load, 15000)
    return () => {
      leave()
      offNew()
      offUpd()
      clearInterval(poll)
    }
  }, [load, notify])

  async function advance(order: Order) {
    const next = order.status === 'in_kitchen' ? 'preparing' : 'ready'
    setBusyId(order.id)
    // Mise à jour optimiste : en cuisine, l'écran doit répondre au doigt.
    setQueue((q) => q.map((o) => (o.id === order.id ? { ...o, status: next } : o)))
    try {
      await orders.setKitchenStatus(order.id, next)
      load()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Mise à jour refusée.', 'error')
      load()
    } finally {
      setBusyId(null)
    }
  }

  const active = queue.filter((o) => o.status !== 'ready')
  const ready = queue.filter((o) => o.status === 'ready')

  return (
    <div className="dark-surface flex min-h-dvh flex-col bg-ink-900">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-ink-800 bg-ink-900/90 px-5 py-3.5 backdrop-blur-md sm:px-7">
        <div className="flex items-center gap-4">
          <Wordmark />
          <span className="hidden text-[13px] font-semibold text-ink-500 sm:block">
            Cuisine
          </span>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionDot dark />
          <div className="flex items-baseline gap-1.5">
            <span className="num text-[22px] font-bold text-white">{active.length}</span>
            <span className="text-[13px] text-ink-500">en cours</span>
          </div>
          {ready.length > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="num text-[22px] font-bold text-petrol-400">
                {ready.length}
              </span>
              <span className="text-[13px] text-ink-500">prêtes</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 p-5 sm:p-7">
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-[13px] bg-ink-800" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <EmptyState
            dark
            icon={ChefHat}
            title="Aucun ticket"
            description="Les commandes payées arrivent ici automatiquement."
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
            {[...active, ...ready].map((order) => (
              <Ticket
                key={order.id}
                order={order}
                now={now}
                busy={busyId === order.id}
                onAdvance={() => advance(order)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function Ticket({
  order,
  now,
  busy,
  onAdvance,
}: {
  order: Order
  now: number
  busy: boolean
  onAdvance: () => void
}) {
  const mins = elapsedMinutes(order.createdAt, now)
  const isReady = order.status === 'ready'
  const late = !isReady && mins >= LATE_AT
  const warn = !isReady && !late && mins >= WARN_AT

  const channel =
    order.fulfillmentType === 'delivery'
      ? { icon: Bike, label: 'Livraison', color: 'text-coral-500' }
      : order.source === 'online'
        ? { icon: Smartphone, label: 'En ligne', color: 'text-sky-500' }
        : { icon: Store, label: 'Sur place', color: 'text-ink-400' }

  // L'urgence prime sur le canal : un ticket en retard doit sauter aux yeux.
  const edge = late
    ? 'border-coral-500'
    : warn
      ? 'border-saffron-500'
      : isReady
        ? 'border-petrol-500'
        : order.fulfillmentType === 'delivery'
          ? 'border-coral-500/45'
          : order.source === 'online'
            ? 'border-sky-500/45'
            : 'border-ink-700'

  return (
    <article
      className={`animate-ticket-in flex flex-col rounded-[13px] border-2 bg-ink-800 ${edge} ${
        isReady ? 'opacity-75' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div>
          <span className="num text-[26px] leading-none font-bold text-white">
            {orderNo(order.orderNumber)}
          </span>
          <div className={`mt-1.5 flex items-center gap-1.5 ${channel.color}`}>
            <channel.icon size={14} strokeWidth={2.3} />
            <span className="text-[12px] font-bold">{channel.label}</span>
          </div>
        </div>
        <span
          className={`num rounded-full px-2 py-1 text-[12px] font-bold ${
            late
              ? 'bg-coral-500 text-white'
              : warn
                ? 'bg-saffron-500 text-ink-900'
                : 'bg-ink-700 text-ink-300'
          }`}
        >
          {elapsed(order.createdAt, now)}
        </span>
      </div>

      <ul className="flex-1 space-y-3 px-4 py-4">
        {order.items?.map((it) => {
          const removed = it.customization?.removed ?? []
          const added = it.customization?.added ?? []
          return (
            <li key={it.id}>
              <div className="flex gap-2.5">
                <span className="num shrink-0 text-[17px] font-bold text-petrol-400">
                  {it.quantity}×
                </span>
                <span className="text-[16px] leading-snug font-semibold text-white">
                  {it.productNameSnapshot}
                </span>
              </div>

              {/* Les modifications sautent aux yeux : c'est là que les
                  erreurs coûtent cher en cuisine. */}
              {(removed.length > 0 || added.length > 0) && (
                <div className="mt-1.5 ml-8 space-y-1">
                  {removed.map((o) => (
                    <p
                      key={o.id}
                      className="flex items-center gap-1.5 text-[14px] leading-tight font-bold text-coral-500"
                    >
                      <Ban size={13} strokeWidth={3} className="shrink-0" />
                      SANS {o.label.toUpperCase()}
                    </p>
                  ))}
                  {added.map((o) => (
                    <p
                      key={o.id}
                      className="flex items-center gap-1.5 text-[14px] leading-tight font-bold text-saffron-500"
                    >
                      <PlusCircle size={13} strokeWidth={3} className="shrink-0" />
                      EXTRA {o.label.toUpperCase()}
                    </p>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="p-3 pt-0">
        {isReady ? (
          <div className="flex items-center justify-center gap-2 rounded-[9px] bg-petrol-600/15 py-3 text-[14px] font-bold text-petrol-400">
            <Check size={17} strokeWidth={2.6} />
            Prête
          </div>
        ) : (
          <button
            onClick={onAdvance}
            disabled={busy}
            className={`h-12 w-full rounded-[9px] text-[15px] font-bold transition-colors disabled:opacity-50 ${
              order.status === 'in_kitchen'
                ? 'bg-ink-700 text-white hover:bg-ink-600'
                : 'bg-petrol-600 text-white hover:bg-petrol-500'
            }`}
          >
            {order.status === 'in_kitchen' ? 'Commencer' : 'Marquer prête'}
          </button>
        )}
      </div>
    </article>
  )
}
