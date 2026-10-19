import { useCallback, useEffect, useState } from 'react'
import { Ban, Printer, Receipt } from 'lucide-react'
import { orders } from '../../lib/api'
import { money, orderNo, statusLabel, timeShort } from '../../lib/format'
import type { CancelReason, Order } from '../../lib/types'
import { Button, Chip, EmptyState, Modal, Skeleton, useToast } from '../../components/ui'
import { usePrint } from '../../components/PrintHost'
import { useAuth } from '../../lib/store'

/**
 * Les commandes de la journée en cours.
 *
 * Une fois encaissée, une commande quittait l'écran du caissier : plus
 * moyen de réimprimer un reçu, ni de rattraper l'erreur commise trente
 * secondes plus tôt. C'est ce que ce panneau rend possible — sans jamais
 * rien effacer, l'annulation reste visible dans la liste.
 */
export function TodayPanel({ reloadKey }: { reloadKey: number }) {
  const [list, setList] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<Order | null>(null)
  const { print } = usePrint()
  const user = useAuth((s) => s.user)
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      setList(await orders.recent())
    } catch {
      /* le prochain cycle rattrapera */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[64px]" />
        ))}
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="Aucune commande aujourd'hui"
        description="Les commandes du service apparaîtront ici, réimprimables et annulables."
      />
    )
  }

  const cancelled = list.filter((o) => o.status === 'cancelled').length

  return (
    <>
      {cancelled > 0 && (
        <p className="border-b border-ink-100 bg-ink-50 px-5 py-2 text-[12px] text-ink-500">
          {cancelled} annulation{cancelled > 1 ? 's' : ''} aujourd'hui · visible par le gérant
        </p>
      )}

      <ul>
        {list.map((order) => {
          const isCancelled = order.status === 'cancelled'
          const isPaid = Boolean(order.paidAt)
          return (
            <li
              key={order.id}
              className="flex items-center gap-3 border-b border-ink-100 px-4 py-3"
            >
              <span
                className={`num w-11 shrink-0 text-[16px] font-bold ${
                  isCancelled ? 'text-ink-300 line-through' : 'text-ink-900'
                }`}
              >
                {orderNo(order.orderNumber)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`num text-[13.5px] font-semibold ${
                      isCancelled ? 'text-ink-400 line-through' : 'text-ink-900'
                    }`}
                  >
                    {money(order.totalAmount)} DT
                  </span>
                  {isCancelled ? (
                    <Chip tone="coral">Annulée</Chip>
                  ) : (
                    <span className="text-[12px] text-ink-500">
                      {statusLabel[order.status]}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-ink-400">
                  {timeShort(order.createdAt)}
                  {isPaid && !isCancelled && ' · encaissée'}
                </p>
              </div>

              <button
                onClick={() =>
                  print({ order, kind: 'receipt', cashierName: user?.fullName })
                }
                aria-label="Réimprimer le reçu"
                title="Réimprimer le reçu"
                className="grid size-8 shrink-0 place-items-center rounded-[7px] text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                <Printer size={15} />
              </button>

              {!isCancelled && (
                <button
                  onClick={() => setCancelling(order)}
                  aria-label="Annuler la commande"
                  title="Annuler la commande"
                  className="grid size-8 shrink-0 place-items-center rounded-[7px] text-ink-400 transition-colors hover:bg-coral-100 hover:text-coral-700"
                >
                  <Ban size={15} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <CancelModal
        order={cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={(label) => {
          setCancelling(null)
          notify(`Commande annulée — ${label.toLowerCase()}.`, 'success')
          load()
        }}
      />
    </>
  )
}

/* ───────────────────────── Motif d'annulation ───────────────────────── */

/**
 * Le motif se touche, il ne s'écrit pas : c'est la règle de toute la
 * caisse. Un champ libre donnerait « erreur » ou rien du tout, et le
 * gérant ne pourrait pas comparer un mois sur l'autre.
 */
function CancelModal({
  order,
  onClose,
  onCancelled,
}: {
  order: Order | null
  onClose: () => void
  onCancelled: (label: string) => void
}) {
  const [reasons, setReasons] = useState<CancelReason[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const { notify } = useToast()

  useEffect(() => {
    if (!order) return
    orders.cancelReasons().then(setReasons).catch(() => setReasons([]))
  }, [order])

  async function confirm(reason: CancelReason) {
    if (!order) return
    setBusy(reason.code)
    try {
      await orders.cancel(order.id, reason.code)
      onCancelled(reason.label)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Annulation refusée.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const wasPaid = Boolean(order?.paidAt)

  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      title={order ? `Annuler ${orderNo(order.orderNumber)}` : ''}
      description="Choisissez le motif. L'annulation reste inscrite au journal."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Revenir
        </Button>
      }
    >
      {wasPaid && (
        <div className="mb-3 rounded-[9px] border border-saffron-500/35 bg-saffron-50 px-3.5 py-3 text-[12.5px] leading-snug text-saffron-700">
          <span className="font-bold">Commande déjà encaissée.</span> Rendez{' '}
          <span className="num font-bold">{money(order?.totalAmount ?? 0)} DT</span> au
          client. Le montant sortira du total attendu en caisse et les ingrédients
          retourneront au stock.
        </div>
      )}

      <div className="space-y-2">
        {reasons.map((reason) => (
          <button
            key={reason.code}
            onClick={() => confirm(reason)}
            disabled={busy !== null}
            className="flex h-12 w-full items-center rounded-[9px] border border-ink-200 px-4 text-left text-[14px] font-semibold text-ink-900 transition-colors hover:border-coral-500 hover:bg-coral-50 hover:text-coral-700 disabled:opacity-50"
          >
            {busy === reason.code ? 'Annulation…' : reason.label}
          </button>
        ))}
      </div>
    </Modal>
  )
}
