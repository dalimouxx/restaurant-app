import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from '../../lib/format'
import type { CashSession, Order, PaymentMethod } from '../../lib/types'
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
import { usePrint } from '../../components/PrintHost'
import { useAuth } from '../../lib/store'

/** Coupures courantes, pour encaisser sans taper le montant. */
const QUICK_CASH = [5, 10, 20, 50]

export default function CashierScreen() {
  const [session, setSession] = useState<CashSession | null>(null)
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
      setError(err instanceof Error ? err.message : 'Ouverture impossible.')
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
  session: CashSession
  onSessionChange: () => void
}) {
  const [queue, setQueue] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [takingOrder, setTakingOrder] = useState(false)
  /** Onglet de la colonne de gauche : la file, ou le service du jour. */
  const [tab, setTab] = useState<'queue' | 'today'>('queue')
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
      const list = await orders.pendingPayment()
      setQueue(list)
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

  async function pay(method: PaymentMethod) {
    if (!selected) return
    try {
      const paid = await orders.pay(selected.id, method)
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
    <div className="grid min-h-[calc(100dvh-4rem)] grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
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
            <TabButton active={tab === 'today'} onClick={() => setTab('today')}>
              Aujourd'hui
            </TabButton>
          </div>
          <button
            onClick={() => setClosing(true)}
            className="flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12.5px] font-semibold text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <LockKeyhole size={13} />
            Clôturer
          </button>
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

          <div className="flex items-center justify-between text-[13px]">
            <span className="text-ink-500">Fond de caisse</span>
            <span className="num font-semibold text-ink-900">
              {moneyDT(session.openingFloat)}
            </span>
          </div>
        </div>
      </section>

      {/* Encaissement */}
      <section className="min-h-0 bg-white">
        {selected ? (
          <PaymentPanel
            key={selected.id}
            order={selected}
            onPay={pay}
            onPrint={() =>
              print({ order: selected, kind: 'receipt', cashierName: user?.fullName })
            }
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

      <CloseSession
        open={closing}
        session={session}
        onClose={() => setClosing(false)}
        onClosed={() => {
          setClosing(false)
          onSessionChange()
        }}
      />
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
  onPay,
  onPrint,
}: {
  order: Order
  onPay: (method: PaymentMethod) => void
  onPrint: () => void
}) {
  const [tendered, setTendered] = useState('')
  const due = order.subtotal
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

          <div className="mt-5 border-t border-ink-100 pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold text-ink-600">À payer</span>
              <span className="num text-[30px] font-extrabold tracking-[-0.025em] text-ink-900">
                {moneyDT(due)}
              </span>
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
                className="num min-h-11 rounded-[9px] border border-ink-200 bg-white text-[19px] font-semibold text-ink-900 transition-colors hover:bg-ink-50 active:bg-ink-100"
              >
                {k}
              </button>
            ))}
            <button
              onClick={() => press('back')}
              aria-label="Effacer un chiffre"
              className="grid min-h-11 place-items-center rounded-[9px] border border-ink-200 bg-white text-ink-600 transition-colors hover:bg-coral-50 hover:text-coral-600"
            >
              <Delete size={19} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="lg" icon={Banknote} onClick={() => onPay('cash')}>
              Espèces
            </Button>
            <Button size="lg" variant="secondary" icon={CreditCard} onClick={() => onPay('card')}>
              Carte
            </Button>
          </div>
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
  const [counted, setCounted] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CashSession | null>(null)
  const { notify } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setCounted('')
      setResult(null)
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [open])

  async function submit() {
    const value = Number(counted.replace(',', '.'))
    if (!Number.isFinite(value)) {
      notify('Entrez le montant compté dans le tiroir.', 'error')
      return
    }
    setBusy(true)
    try {
      setResult(await cashier.close(value))
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Clôture impossible.', 'error')
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
      description="Comptez le tiroir, y compris le fond de départ."
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
      <p className="mb-4 text-[13.5px] text-ink-500">
        Ouverte à {timeShort(session.openedAt)} avec un fond de{' '}
        <span className="num font-semibold text-ink-700">
          {moneyDT(session.openingFloat)}
        </span>
        .
      </p>
      <Field label="Montant compté">
        <div className="relative">
          <Input
            ref={inputRef}
            inputMode="decimal"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="0,00"
            className="num h-14 pr-12 text-[22px] font-bold"
          />
          <span className="absolute top-1/2 right-4 -translate-y-1/2 text-[15px] font-semibold text-ink-400">
            DT
          </span>
        </div>
      </Field>
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
