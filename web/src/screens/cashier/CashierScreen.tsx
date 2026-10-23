import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  Check,
  CreditCard,
  Delete,
  Inbox,
  LockKeyhole,
  PlusCircle,
  Printer,
  Receipt,
  Wallet,
} from 'lucide-react'
import { cashier, orders } from '../../lib/api'
import { joinRoom, on } from '../../lib/socket'
import {
  elapsed,
  fulfillmentLabel,
  money,
  moneyDT,
  orderNo,
  sourceLabel,
  timeShort,
  vientDeLaVeille,
  dateLongue,
  dateEtHeure,
} from '../../lib/format'
import type { CashSession, Order, PaymentMethod } from '../../lib/types'
import { useReglages } from '../../lib/reglages'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  useNow,
  useToast,
} from '../../components/ui'
import { NewOrderPanel } from './NewOrderPanel'
import { TodayPanel } from './TodayPanel'
import { CashCountGrid, useCashCount } from './CashCount'
import { DiscountModal } from './DiscountModal'
import { usePrint } from '../../components/PrintHost'
import { useAuth } from '../../lib/store'
import { Emoji } from '../../components/Emoji'
import { BandeauHorsLigne } from '../../components/BandeauHorsLigne'
import { estUnePanneReseau } from '../../lib/horsLigne'

/** Coupures courantes, pour encaisser sans taper le montant. */
const QUICK_CASH = [5, 10, 20, 50]

export default function CashierScreen() {
  const [session, setSession] = useState<CashSession | null>(null)
  const { caisseSimplifiee: simplifiee } = useReglages()
  const [checking, setChecking] = useState(true)

  const refreshSession = useCallback(async () => {
    try {
      setSession(await cashier.currentSession())
    } catch {
      setSession(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  if (checking) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  /**
   * Caisse simplifiee : pas de session a ouvrir.
   *
   * Les soirs sans caissier, le gerant encaisse lui-meme entre deux
   * clients. Lui imposer d'ouvrir une session, d'annoncer son fond puis
   * de la cloturer, c'est trois gestes administratifs pour trois
   * sandwichs — et en pratique personne ne cloture, si bien que l'ecart
   * de caisse du lendemain ne veut plus rien dire.
   */
  if (simplifiee) {
    return <Register session={null} onSessionChange={refreshSession} />
  }

  if (!session?.isOpen) {
    return <OpenSession onOpened={setSession} />
  }

  return <Register session={session} onSessionChange={refreshSession} />
}

/* ───────────────────────── Ouverture de caisse ───────────────────────── */

function OpenSession({ onOpened }: { onOpened: (s: CashSession) => void }) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { notify } = useToast()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = Number(amount.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) {
      setError('Entrez le montant présent dans le tiroir.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      onOpened(await cashier.open(value))
      notify('Caisse ouverte.', 'success')
    } catch (err) {
      /**
       * Ouvrir une caisse sans réseau est refusé, et c'est délibéré.
       *
       * Le fond de caisse est la référence de tout le service : c'est
       * lui qui dit, le soir, si le tiroir est juste. Une ouverture
       * enregistrée seulement sur la tablette peut disparaître avec
       * elle — et l'écart du soir devient alors indéfendable, aux
       * dépens du caissier. On le dit franchement plutôt que de laisser
       * une erreur technique.
       */
      setError(
        estUnePanneReseau(err)
          ? 'Réseau coupé : une caisse ne peut pas s\'ouvrir sans lui. Le fond de ' +
            'caisse sert de référence au contrôle du soir, il doit être enregistré ' +
            'sur le serveur. Réessayez dès que le réseau revient.'
          : err instanceof Error
            ? err.message
            : 'Ouverture impossible.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <Card className="p-6">
        <div className="mb-5 grid size-11 place-items-center rounded-[11px] bg-petrol-50 text-petrol-600">
          <Wallet size={21} strokeWidth={2} />
        </div>
        <h2 className="text-[20px] font-bold tracking-[-0.015em] text-ink-900">
          Ouvrir la caisse
        </h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">
          Comptez le tiroir avant le premier client. Ce montant sert de référence au
          contrôle d'écart en fin de service.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Fond de caisse" error={error}>
            <div className="relative">
              <Input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="num h-14 pr-12 text-[22px] font-bold"
              />
              <span className="absolute top-1/2 right-4 -translate-y-1/2 text-[15px] font-semibold text-ink-400">
                DT
              </span>
            </div>
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Ouvrir la caisse
          </Button>
        </form>
      </Card>
    </div>
  )
}

/* ───────────────────────── Poste d'encaissement ───────────────────────── */

function Register({
  session,
  onSessionChange,
}: {
  session: CashSession | null
  onSessionChange: () => void
}) {
  const [queue, setQueue] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [takingOrder, setTakingOrder] = useState(false)
  /** Onglet de la colonne de gauche : la file, ou le service du jour. */
  const [tab, setTab] = useState<'queue' | 'parked' | 'today'>('queue')
  const [parked, setParked] = useState<Order[]>([])
  const [discounting, setDiscounting] = useState<Order | null>(null)
  /** Incrémenté à chaque encaissement : l'historique se recharge. */
  const [serviceVersion, setServiceVersion] = useState(0)
  const { notify } = useToast()
  const { print } = usePrint()
  const user = useAuth((s) => s.user)
  const now = useNow(20000)

  /** Impression du reçu à l'encaissement, mémorisée sur ce poste. */
  const [autoPrint, setAutoPrint] = useState(() => {
    try {
      return localStorage.getItem('service.autoPrint') !== 'off'
    } catch {
      return true
    }
  })

  function toggleAutoPrint() {
    setAutoPrint((v) => {
      const next = !v
      try {
        localStorage.setItem('service.autoPrint', next ? 'on' : 'off')
      } catch {
        /* mode privé : le choix vaut pour cette session */
      }
      return next
    })
  }

  const load = useCallback(async () => {
    try {
      const [list, garees] = await Promise.all([
        orders.pendingPayment(),
        orders.parked().catch(() => []),
      ])
      setQueue(list)
      setParked(garees)
      setSelectedId((cur) => (cur && list.some((o) => o.id === cur) ? cur : list[0]?.id ?? null))
    } catch {
      /* le temps réel ou le prochain cycle rattrapera */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const leave = joinRoom('cashier')
    const offNew = on('order:new', () => {
      load()
      notify('Nouvelle commande à encaisser.', 'info')
    })
    const offUpd = on('order:updated', load)
    const poll = setInterval(load, 20000)
    return () => {
      leave()
      offNew()
      offUpd()
      clearInterval(poll)
    }
  }, [load, notify])

  const selected = useMemo(
    () => queue.find((o) => o.id === selectedId) ?? null,
    [queue, selectedId],
  )

  // Navigation clavier : flèches pour parcourir la file, sans quitter le pavé numérique.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const i = queue.findIndex((o) => o.id === selectedId)
      const next = e.key === 'ArrowDown' ? i + 1 : i - 1
      if (queue[next]) setSelectedId(queue[next].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [queue, selectedId])

  /** Range la commande de côté, ou la ramène dans la file. */
  async function park(order: Order, parked = true) {
    try {
      await orders.park(order.id, parked)
      notify(parked ? 'Commande mise en attente.' : 'Commande reprise.', 'success')
      if (!parked) setSelectedId(order.id)
      setTab(parked ? 'queue' : 'queue')
      load()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Action refusée.', 'error')
    }
  }

  async function split(order: Order, parts: number) {
    try {
      const maj = await orders.split(order.id, parts)
      setQueue((q) => q.map((o) => (o.id === maj.id ? maj : o)))
      notify(parts > 1 ? `Addition partagée en ${parts}.` : 'Partage annulé.', 'info')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Partage refusé.', 'error')
    }
  }

  async function pay(method: PaymentMethod) {
    if (!selected) return
    try {
      const paid = await orders.pay(selected.id, method)

      // Une addition partagée reste ouverte tant que toutes les parts
      // ne sont pas réglées : le premier qui paie n'emporte pas la
      // commande des autres.
      const resteDesParts =
        (paid.splitCount ?? 1) > 1 && (paid.splitPaidCount ?? 0) < (paid.splitCount ?? 1)

      if (resteDesParts) {
        notify(
          `Part ${paid.splitPaidCount} sur ${paid.splitCount} encaissée.`,
          'success',
        )
        setQueue((q) => q.map((o) => (o.id === paid.id ? paid : o)))
        return
      }

      notify(`${orderNo(selected.orderNumber)} encaissée, envoyée en cuisine.`, 'success')

      // Le reçu part dès l'encaissement : c'est le moment où le client
      // est devant la caisse, pas trois clics plus tard.
      if (autoPrint) {
        print({ order: paid, kind: 'receipt', cashierName: user?.fullName })
      }

      setQueue((q) => q.filter((o) => o.id !== selected.id))
      setSelectedId(null)
      setServiceVersion((v) => v + 1)
      load()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Encaissement refusé.', 'error')
    }
  }

  return (
    /* La hauteur est bornée sur grand écran, et pas seulement minimale :
       avec « min-h », la colonne grandit avec la file, le défilement
       interne ne s'enclenche jamais et c'est la page entière qui
       descend. Un midi à quarante commandes en attente, le pavé
       d'encaissement sortait de l'écran — exactement au moment où le
       caissier en a besoin. Sur téléphone la disposition est en une
       seule colonne : là, elle doit pouvoir s'allonger. */
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col lg:h-[calc(100dvh-4rem)] lg:min-h-0">
      {/* Au-dessus de tout, et seulement quand il a quelque chose a
          dire : un bandeau permanent devient invisible en trois jours,
          et ne sert plus a rien le jour ou il compte. */}
      <BandeauHorsLigne />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      {/* File */}
      <section className="flex min-h-0 flex-col border-ink-200 lg:border-r">
        <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-5 py-2.5">
          <div className="flex gap-1">
            <TabButton active={tab === 'queue'} onClick={() => setTab('queue')}>
              À encaisser
              {queue.length > 0 && (
                <span className="num ml-1.5 rounded-full bg-petrol-600 px-1.5 text-[11px] text-white">
                  {queue.length}
                </span>
              )}
            </TabButton>
            {parked.length > 0 && (
              <TabButton active={tab === 'parked'} onClick={() => setTab('parked')}>
                Garées
                <span className="num ml-1.5 rounded-full bg-saffron-500 px-1.5 text-[11px] text-ink-900">
                  {parked.length}
                </span>
              </TabButton>
            )}
            <TabButton active={tab === 'today'} onClick={() => setTab('today')}>
              Aujourd'hui
            </TabButton>
          </div>
          {session && (
            <button
              onClick={() => setClosing(true)}
              className="flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12.5px] font-semibold text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              <LockKeyhole size={13} />
              Clôturer
            </button>
          )}
        </div>

        {tab === 'queue' && (
          <div className="border-b border-ink-200 p-3">
            <Button
              size="lg"
              icon={PlusCircle}
              className="w-full"
              onClick={() => setTakingOrder(true)}
            >
              Prendre une commande
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'today' ? (
            <TodayPanel reloadKey={serviceVersion} />
          ) : tab === 'parked' ? (
            <ul>
              {parked.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center gap-3 border-b border-ink-100 px-4 py-3"
                >
                  <span className="num w-11 shrink-0 text-[16px] font-bold text-ink-900">
                    {orderNo(o.orderNumber)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="num text-[13.5px] font-semibold text-ink-900">
                      {vientDeLaVeille(o.orderDate) && (
                        <span className="me-1.5 rounded-[5px] bg-saffron-100 px-1.5 py-0.5 text-[10.5px] font-extrabold tracking-[0.04em] text-saffron-700 uppercase">
                          hier
                        </span>
                      )}
                      {money(o.totalAmount)} DT
                    </p>
                    <p className="text-[12px] text-ink-400">
                      En attente depuis {elapsed(o.updatedAt, now)}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => park(o, false)}>
                    Reprendre
                  </Button>
                </li>
              ))}
            </ul>
          ) : loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[72px]" />
              ))}
            </div>
          ) : queue.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Aucune commande en attente"
              description="Les commandes de la borne arrivent ici automatiquement."
            />
          ) : (
            <ul>
              {queue.map((o) => {
                const active = o.id === selectedId
                const waiting = elapsed(o.createdAt, now)
                return (
                  <li key={o.id}>
                    <button
                      onClick={() => setSelectedId(o.id)}
                      className={`flex w-full items-center gap-3 border-b border-ink-100 px-5 py-3.5 text-left transition-colors ${
                        active ? 'bg-petrol-50' : 'hover:bg-ink-50'
                      }`}
                    >
                      <span
                        className={`num text-[17px] font-bold ${
                          active ? 'text-petrol-700' : 'text-ink-900'
                        }`}
                      >
                        {orderNo(o.orderNumber)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink-600">
                          {/* Deux « 12 » dans la file, c'est le caissier
                              qui encaisse la mauvaise commande. */}
                          {vientDeLaVeille(o.orderDate) && (
                            <span className="me-1.5 rounded-[5px] bg-saffron-100 px-1.5 py-0.5 text-[10.5px] font-extrabold tracking-[0.04em] text-saffron-700 uppercase">
                              hier
                            </span>
                          )}
                          {o.items?.length ?? 0} article
                          {(o.items?.length ?? 0) > 1 ? 's' : ''} · {sourceLabel[o.source]}
                        </p>
                        <p className="text-[12px] text-ink-400">Depuis {waiting}</p>
                      </div>
                      <span className="num shrink-0 text-[15px] font-bold text-ink-900">
                        {money(o.subtotal)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t border-ink-200 px-5 py-3">
          <button
            onClick={toggleAutoPrint}
            className="flex w-full items-center gap-2 text-[12.5px] font-semibold text-ink-600 transition-colors hover:text-ink-900"
          >
            <span
              className={`grid size-4 place-items-center rounded-[4px] border ${
                autoPrint
                  ? 'border-petrol-600 bg-petrol-600 text-white'
                  : 'border-ink-300'
              }`}
            >
              {autoPrint && <Check size={11} strokeWidth={3.5} />}
            </span>
            Imprimer le reçu à l'encaissement
          </button>

          {session && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-500">Fond de caisse</span>
              <span className="num font-semibold text-ink-900">
                {moneyDT(session.openingFloat)}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Encaissement */}
      <section className="min-h-0 bg-white">
        {selected ? (
          <PaymentPanel
            key={selected.id}
            order={selected}
            unSeulGeste={session === null}
            onPay={pay}
            onPrint={() =>
              print({ order: selected, kind: 'receipt', cashierName: user?.fullName })
            }
            onDiscount={() => setDiscounting(selected)}
            onPark={() => park(selected)}
            onSplit={(parts) => split(selected, parts)}
          />
        ) : (
          <EmptyState
            icon={Receipt}
            title="Sélectionnez une commande"
            description="Utilisez les flèches haut et bas pour parcourir la file."
          />
        )}
      </section>

      <NewOrderPanel
        open={takingOrder}
        onClose={() => setTakingOrder(false)}
        onCreated={() => load()}
      />

      <DiscountModal
        order={discounting}
        onClose={() => setDiscounting(null)}
        onApplied={(maj) => {
          setDiscounting(null)
          setQueue((q) => q.map((o) => (o.id === maj.id ? maj : o)))
        }}
      />

      {session && (
      <CloseSession
        open={closing}
        session={session}
        onClose={() => setClosing(false)}
        onClosed={() => {
          setClosing(false)
          onSessionChange()
        }}
      />
      )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center rounded-[7px] px-2.5 py-1.5 text-[13.5px] font-bold transition-colors ${
        active ? 'bg-ink-100 text-ink-900' : 'text-ink-500 hover:text-ink-900'
      }`}
    >
      {children}
    </button>
  )
}

/* ───────────────────────── Panneau de paiement ───────────────────────── */

function PaymentPanel({
  order,
  unSeulGeste,
  onPay,
  onPrint,
  onDiscount,
  onPark,
  onSplit,
}: {
  order: Order
  /** Caisse simplifiée : un seul bouton, aucun moyen de paiement à choisir. */
  unSeulGeste: boolean
  onPay: (method: PaymentMethod) => void
  onPrint: () => void
  onDiscount: () => void
  onPark: () => void
  onSplit: (parts: number) => void
}) {
  const [tendered, setTendered] = useState('')

  const remise = order.discountAmount ?? 0
  const parts = order.splitCount ?? 1
  const reglees = order.splitPaidCount ?? 0

  /**
   * Ce qu'il reste à encaisser maintenant. Sur une addition partagée,
   * c'est la part en cours, pas le total : le caissier ne doit jamais
   * avoir à diviser de tête devant le client.
   */
  const due =
    parts > 1
      ? Math.round((order.totalAmount / parts) * 1000) / 1000
      : order.totalAmount
  const received = Number(tendered.replace(',', '.')) || 0
  const change = received - due
  const enough = received >= due

  const press = useCallback((key: string) => {
    setTendered((cur) => {
      if (key === 'clear') return ''
      if (key === 'back') return cur.slice(0, -1)
      if (key === ',') return cur.includes(',') ? cur : (cur || '0') + ','
      return (cur === '0' ? '' : cur) + key
    })
  }, [])

  // Le pavé numérique physique pilote l'écran : pas besoin de viser à la souris.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (/^[0-9]$/.test(e.key)) {
        press(e.key)
      } else if (e.key === '.' || e.key === ',') {
        press(',')
      } else if (e.key === 'Backspace') {
        press('back')
      } else if (e.key === 'Escape') {
        press('clear')
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onPay('cash')
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, onPay])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="num text-[24px] font-extrabold tracking-[-0.02em] text-ink-900">
            {orderNo(order.orderNumber)}
          </span>
          <Chip tone={order.fulfillmentType === 'delivery' ? 'coral' : 'neutral'}>
            {fulfillmentLabel[order.fulfillmentType]}
          </Chip>
        </div>
        <span className="text-[12.5px] text-ink-400">Reçue à {timeShort(order.createdAt)}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-2">
        {/* Détail */}
        <div className="min-h-0 overflow-y-auto border-ink-100 px-6 py-5 xl:border-r">
          <ul className="space-y-2.5">
            {order.items?.map((it) => {
              const removed = it.customization?.removed ?? []
              const added = it.customization?.added ?? []
              return (
                <li key={it.id} className="flex items-start gap-3">
                  <span className="num mt-px w-7 shrink-0 text-[14px] font-bold text-ink-500">
                    {it.quantity}×
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[14.5px] font-medium text-ink-900">
                      {it.productNameSnapshot}
                    </span>
                    {(removed.length > 0 || added.length > 0) && (
                      <p className="mt-0.5 text-[12.5px] leading-snug">
                        {removed.length > 0 && (
                          <span className="text-coral-600">
                            sans {removed.map((o) => o.label.toLowerCase()).join(', ')}
                          </span>
                        )}
                        {removed.length > 0 && added.length > 0 && (
                          <span className="text-ink-400"> · </span>
                        )}
                        {added.length > 0 && (
                          <span className="text-petrol-600">
                            extra {added.map((o) => o.label.toLowerCase()).join(', ')}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <span className="num text-[14.5px] font-semibold text-ink-700">
                    {money(it.unitPrice * it.quantity)}
                  </span>
                </li>
              )
            })}
          </ul>

          <div className="mt-5 space-y-1.5 border-t border-ink-100 pt-4">
            {remise > 0 && (
              <>
                <div className="flex items-baseline justify-between text-[13.5px]">
                  <span className="text-ink-500">Sous-total</span>
                  <span className="num text-ink-700">{moneyDT(order.subtotal)}</span>
                </div>
                <div className="flex items-baseline justify-between text-[13.5px]">
                  <span className="font-semibold text-coral-600">Remise</span>
                  <span className="num font-semibold text-coral-600">
                    −{moneyDT(remise)}
                  </span>
                </div>
              </>
            )}

            <div className="flex items-baseline justify-between pt-1">
              <span className="text-[15px] font-semibold text-ink-600">
                {parts > 1 ? `Part ${reglees + 1} sur ${parts}` : 'À payer'}
              </span>
              <span className="num text-[30px] font-extrabold tracking-[-0.025em] text-ink-900">
                {moneyDT(due)}
              </span>
            </div>

            {parts > 1 && (
              <p className="text-[12.5px] text-ink-500">
                Addition de <span className="num">{moneyDT(order.totalAmount)}</span> partagée
                en {parts}
                {reglees > 0 && ` · ${reglees} déjà réglée${reglees > 1 ? 's' : ''}`}
              </p>
            )}
          </div>

          {/* Actions du caissier : tout se touche, rien ne s'écrit. */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={onDiscount}
              className={`h-9 rounded-[8px] border px-3 text-[12.5px] font-bold transition-colors ${
                remise > 0
                  ? 'border-coral-500 bg-coral-50 text-coral-700'
                  : 'border-ink-200 text-ink-600 hover:border-coral-400 hover:text-coral-700'
              }`}
            >
              {remise > 0 ? 'Remise accordée' : 'Remise'}
            </button>

            <button
              onClick={onPark}
              disabled={reglees > 0}
              className="h-9 rounded-[8px] border border-ink-200 px-3 text-[12.5px] font-bold text-ink-600 transition-colors hover:border-saffron-500 hover:text-saffron-700 disabled:opacity-40"
            >
              Mettre en attente
            </button>

            <div className="flex items-center gap-1.5 rounded-[8px] border border-ink-200 px-2">
              <span className="text-[12px] text-ink-500">Partager</span>
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => onSplit(n)}
                  disabled={n < reglees}
                  className={`num size-7 rounded-[6px] text-[12.5px] font-bold transition-colors disabled:opacity-30 ${
                    parts === n
                      ? 'bg-petrol-600 text-white'
                      : 'text-ink-600 hover:bg-ink-100'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pavé */}
        <div className="flex min-h-0 flex-col px-6 py-5">
          <div className="rounded-[13px] border border-ink-200 bg-ink-50 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-ink-500">Reçu</span>
              <span className="num text-[26px] font-bold text-ink-900">
                {tendered || '0'}
              </span>
            </div>
            <div
              className={`mt-3 flex items-baseline justify-between rounded-[9px] px-3 py-2.5 transition-colors ${
                enough && received > 0 ? 'bg-petrol-600 text-white' : 'bg-ink-200/60 text-ink-500'
              }`}
            >
              <span className="text-[13.5px] font-semibold">À rendre</span>
              <span className="num text-[20px] font-bold">
                {enough && received > 0 ? money(change) : '—'}
              </span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            {QUICK_CASH.map((n) => (
              <button
                key={n}
                onClick={() => setTendered(String(n))}
                className="num h-10 rounded-[9px] border border-ink-200 bg-white text-[14px] font-bold text-ink-700 transition-colors hover:border-petrol-400 hover:bg-petrol-50 hover:text-petrol-700"
              >
                {n}
              </button>
            ))}
          </div>

          <div className="mt-2 grid flex-1 grid-cols-3 gap-2">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0'].map((k) => (
              <button
                key={k}
                onClick={() => press(k)}
                className="reagit-fort num min-h-11 rounded-[11px] border border-ink-200 bg-white text-[19px] font-semibold text-ink-900 transition-colors hover:bg-ink-50 active:bg-ink-100"
              >
                {k}
              </button>
            ))}
            <button
              onClick={() => press('back')}
              aria-label="Effacer un chiffre"
              className="reagit-fort grid min-h-11 place-items-center rounded-[11px] border border-ink-200 bg-white text-ink-600 transition-colors hover:bg-coral-50 hover:text-coral-600"
            >
              <Delete size={19} />
            </button>
          </div>

          {/* En caisse simplifiee, il n'y a rien a choisir : un appui
              encaisse en especes, c'est tout. Le gerant qui sert aussi
              au comptoir n'a pas une main de libre pour lire un menu. */}
          {unSeulGeste ? (
            <div className="mt-3">
              <Button size="xl" icon={Banknote} className="w-full" onClick={() => onPay('cash')}>
                Encaisser {moneyDT(order.totalAmount)}
              </Button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="lg" icon={Banknote} onClick={() => onPay('cash')}>
                Espèces
              </Button>
              <Button size="lg" variant="secondary" icon={CreditCard} onClick={() => onPay('card')}>
                Carte
              </Button>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-ink-400">
              Entrée encaisse en espèces · Échap efface
            </p>
            <button
              onClick={onPrint}
              className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-ink-500 transition-colors hover:text-petrol-700"
            >
              <Printer size={13} />
              Imprimer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Clôture ───────────────────────── */

function CloseSession({
  open,
  session,
  onClose,
  onClosed,
}: {
  open: boolean
  session: CashSession
  onClose: () => void
  onClosed: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CashSession | null>(null)
  const { notify } = useToast()
  const { compte, setCompte, total, pieces, remettre } = useCashCount()

  useEffect(() => {
    if (open) {
      remettre()
      setResult(null)
    }
    // `remettre` est stable : la dépendance volontairement réduite à
    // l'ouverture évite de vider le comptage à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function submit() {
    if (pieces === 0) {
      notify('Comptez le tiroir avant de clôturer.', 'error')
      return
    }
    setBusy(true)
    try {
      setResult(await cashier.close(total, compte))
    } catch (e) {
      /**
       * Clôturer sans réseau est refusé, pour la même raison inversée.
       *
       * Le total du service se calcule à partir des ventes du serveur.
       * Hors ligne, celles de la coupure n'y sont pas encore : l'écart
       * serait calculé sur des données partielles, et il tomberait sur
       * le caissier sans que personne sache d'où il vient. Mieux vaut
       * pas de clôture qu'une fausse.
       */
      notify(
        estUnePanneReseau(e)
          ? 'Réseau coupé : la clôture attendra. Les ventes de la coupure ne sont ' +
            'pas encore remontées, et l\'écart serait calculé sur une partie du ' +
            'service seulement.'
          : e instanceof Error
            ? e.message
            : 'Clôture impossible.',
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const gap = result.discrepancy ?? 0
    const balanced = Math.abs(gap) < 0.01
    return (
      <Modal
        open={open}
        onClose={onClosed}
        title="Caisse clôturée"
        footer={<Button onClick={onClosed}>Terminer</Button>}
      >
        <dl className="space-y-2 text-[14px]">
          <Row label="Fond initial" value={moneyDT(result.openingFloat)} />
          <Row label="Attendu" value={moneyDT(result.expectedAmount ?? 0)} />
          <Row label="Compté" value={moneyDT(result.closingAmount ?? 0)} />
        </dl>
        <div
          className={`mt-4 flex items-center justify-between rounded-[11px] px-4 py-3 ${
            balanced ? 'bg-petrol-50' : gap > 0 ? 'bg-saffron-50' : 'bg-coral-50'
          }`}
        >
          <span
            className={`text-[14px] font-bold ${
              balanced ? 'text-petrol-700' : gap > 0 ? 'text-saffron-700' : 'text-coral-700'
            }`}
          >
            {balanced ? 'Caisse équilibrée' : gap > 0 ? 'Excédent' : 'Manquant'}
          </span>
          {!balanced && (
            <span
              className={`num text-[18px] font-bold ${
                gap > 0 ? 'text-saffron-700' : 'text-coral-700'
              }`}
            >
              {moneyDT(Math.abs(gap))}
            </span>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clôturer la caisse"
      width="max-w-lg"
      description="Comptez le tiroir, fond de départ compris."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy}>
            Clôturer
          </Button>
        </>
      }
    >
      {/* Une caisse qu'on a oublie de cloturer hier soir affichait
          « Ouverte a 14:32 » — exactement comme celle du jour. Le
          caissier comptait alors deux journees pour une, et l'ecart
          tombait sur lui. Des qu'elle ne date pas d'aujourd'hui, on le
          dit en grand, avant qu'il ne compte quoi que ce soit. */}
      {vientDeLaVeille(session.openedAt) && (
        <p className="anim-surgit mb-3 flex items-start gap-2 rounded-[11px] border border-saffron-500/35 bg-saffron-50 px-3.5 py-3 text-[13px] leading-snug text-saffron-800">
          <Emoji vie="fretille" className="mt-px">⚠️</Emoji>
          <span>
            Cette caisse a été ouverte{' '}
            <span className="font-bold">{dateLongue(session.openedAt)}</span> et n'a
            jamais été clôturée. Ce que vous allez compter couvre donc plus d'une
            journée de service.
          </span>
        </p>
      )}
      <p className="mb-3 text-[13.5px] text-ink-500">
        Ouverte {dateEtHeure(session.openedAt)} avec un fond de{' '}
        <span className="num font-semibold text-ink-700">
          {moneyDT(session.openingFloat)}
        </span>
        . Pointez ce que vous avez, le total se fait tout seul.
      </p>
      <CashCountGrid compte={compte} onChange={setCompte} total={total} />
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd className="num font-semibold text-ink-900">{value}</dd>
    </div>
  )
}
