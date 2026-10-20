import { useEffect, useState } from 'react'
import { orders } from '../../lib/api'
import { money, moneyDT } from '../../lib/format'
import type { CancelReason, Order } from '../../lib/types'
import { Button, Modal, useToast } from '../../components/ui'

/**
 * Remise.
 *
 * Des paliers et des motifs, rien à écrire ni à calculer : c'est la règle
 * de toute la caisse. Au-delà d'un certain pourcentage le serveur exige un
 * gérant — un caissier seul ne doit pas pouvoir offrir une addition
 * entière, c'est la porte ouverte à un encaissement qui disparaît.
 */
export function DiscountModal({
  order,
  onClose,
  onApplied,
}: {
  order: Order | null
  onClose: () => void
  onApplied: (o: Order) => void
}) {
  const [reasons, setReasons] = useState<CancelReason[]>([])
  const [steps, setSteps] = useState<number[]>([])
  const [maxCashier, setMaxCashier] = useState(20)
  const [percent, setPercent] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (!order) return
    setPercent(null)
    orders
      .discountOptions()
      .then((o) => {
        setReasons(o.reasons)
        setSteps(o.steps)
        setMaxCashier(o.cashierMaxPercent)
      })
      .catch(() => setReasons([]))
  }, [order])

  async function appliquer(reason: CancelReason) {
    if (!order || percent === null) return
    setBusy(true)
    try {
      const maj = await orders.applyDiscount(order.id, percent, reason.code)
      notify(`Remise de ${percent} % — ${reason.label.toLowerCase()}.`, 'success')
      onApplied(maj)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Remise refusée.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function retirer() {
    if (!order) return
    setBusy(true)
    try {
      onApplied(await orders.clearDiscount(order.id))
      notify('Remise retirée.', 'info')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Retrait refusé.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const base = order?.subtotal ?? 0
  const montant = percent !== null ? (base * percent) / 100 : 0

  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      title="Accorder une remise"
      description="Choisissez le montant, puis le motif. La remise est inscrite au journal."
      footer={
        <>
          {(order?.discountAmount ?? 0) > 0 && (
            <div className="mr-auto">
              <Button variant="ghost" size="sm" onClick={retirer} loading={busy}>
                Retirer la remise
              </Button>
            </div>
          )}
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-baseline justify-between rounded-[9px] bg-ink-50 px-3.5 py-2.5">
          <span className="text-[13px] text-ink-500">Addition</span>
          <span className="num text-[17px] font-bold text-ink-900">{moneyDT(base)}</span>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-700">Montant</p>
          <div className="grid grid-cols-5 gap-2">
            {steps.map((s) => (
              <button
                key={s}
                onClick={() => setPercent(s)}
                className={`num h-12 rounded-[9px] border text-[15px] font-bold transition-colors ${
                  percent === s
                    ? 'border-petrol-600 bg-petrol-600 text-white'
                    : 'border-ink-200 bg-white text-ink-800 hover:border-petrol-400'
                }`}
              >
                {s}%
              </button>
            ))}
          </div>
          {percent !== null && (
            <p className="mt-2 text-[13px] text-ink-600">
              Soit <span className="num font-bold text-coral-600">−{money(montant)} DT</span>, reste{' '}
              <span className="num font-bold text-ink-900">{moneyDT(base - montant)}</span>
              {percent > maxCashier && (
                <span className="mt-1 block text-[12.5px] font-semibold text-saffron-700">
                  Au-delà de {maxCashier} %, un compte gérant est demandé.
                </span>
              )}
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-700">Motif</p>
          <div className="space-y-2">
            {reasons.map((r) => (
              <button
                key={r.code}
                disabled={percent === null || busy}
                onClick={() => appliquer(r)}
                className="flex h-12 w-full items-center rounded-[9px] border border-ink-200 px-4 text-left text-[14px] font-semibold text-ink-900 transition-colors hover:border-petrol-500 hover:bg-petrol-50 disabled:opacity-40"
              >
                {r.label}
              </button>
            ))}
          </div>
          {percent === null && (
            <p className="mt-2 text-[12.5px] text-ink-500">
              Choisissez d'abord un montant.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
