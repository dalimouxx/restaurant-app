import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowLeft, Check, Heart } from 'lucide-react'
import { delivery, orders } from '../../lib/api'
import { joinRoom, on } from '../../lib/socket'
import { moneyDT, orderNo, statusLabel, trackingIndex, trackingSteps } from '../../lib/format'
import type { Order } from '../../lib/types'
import { Button, Card, Skeleton, useToast } from '../../components/ui'
import { DeliveryMap } from '../../components/DeliveryMap'

const TIPS = [1, 2, 5]

export default function TrackingScreen() {
  const { id = '' } = useParams()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null)
  const [tipping, setTipping] = useState(false)
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      setOrder(await orders.byId(id))
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Commande introuvable.', 'error')
    } finally {
      setLoading(false)
    }
  }, [id, notify])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!id) return
    const leave = joinRoom(`order_${id}`)
    const offStatus = on('order:status_changed', load)
    const offPos = on<{ lat: number; lng: number }>('delivery:location_update', (p) => {
      if (typeof p?.lat === 'number') setDriverPos({ lat: p.lat, lng: p.lng })
    })
    // Filet si le socket tombe : le client ne doit jamais rester sur un statut figé.
    const poll = setInterval(load, 25000)
    return () => {
      leave()
      offStatus()
      offPos()
      clearInterval(poll)
    }
  }, [id, load])

  async function addTip(amount: number) {
    if (!order) return
    setTipping(true)
    try {
      setOrder(await delivery.addTip(order.id, amount))
      notify('Merci, le pourboire revient intégralement au livreur.', 'success')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Pourboire non enregistré.', 'error')
    } finally {
      setTipping(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-5">
        <Skeleton className="h-28" />
        <Skeleton className="h-52" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="grid min-h-dvh place-items-center px-5 text-center">
        <div>
          <p className="text-[17px] font-bold text-ink-900">Commande introuvable</p>
          <Link
            to="/commander"
            className="mt-3 inline-block text-[14px] font-semibold text-petrol-600"
          >
            Retour à la carte
          </Link>
        </div>
      </div>
    )
  }

  const steps = trackingSteps(order.fulfillmentType)
  const current = Math.min(trackingIndex(order.status), steps.length - 1)
  const isDelivery = order.fulfillmentType === 'delivery'
  const showQr =
    isDelivery && ['awaiting_driver', 'out_for_delivery'].includes(order.status)
  const enRoute = order.status === 'out_for_delivery'
  const destination =
    order.deliveryLat != null && order.deliveryLng != null
      ? { lat: order.deliveryLat, lng: order.deliveryLng }
      : null

  return (
    <div className="min-h-dvh bg-ink-50 pb-10">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/92 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-lg items-center gap-3 px-4">
          <Link
            to="/commander"
            aria-label="Retour"
            className="-ml-1 grid size-9 place-items-center rounded-full text-ink-600 hover:bg-ink-100"
          >
            <ArrowLeft size={19} />
          </Link>
          <span className="num text-[17px] font-bold text-ink-900">
            {orderNo(order.orderNumber)}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-4 px-4 py-5">
        {/* Statut */}
        <Card className="p-5">
          <p className="text-[21px] leading-tight font-extrabold tracking-[-0.02em] text-petrol-700">
            {statusLabel[order.status]}
          </p>

          <ol className="mt-5 space-y-0">
            {steps.map((label, i) => {
              const done = i <= current
              const last = i === steps.length - 1
              return (
                <li key={label} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`grid size-5 shrink-0 place-items-center rounded-full ${
                        done ? 'bg-petrol-600 text-white' : 'border-2 border-ink-200'
                      }`}
                    >
                      {done && <Check size={12} strokeWidth={3.2} />}
                    </span>
                    {!last && (
                      <span
                        className={`w-0.5 flex-1 ${i < current ? 'bg-petrol-600' : 'bg-ink-200'}`}
                        style={{ minHeight: 22 }}
                      />
                    )}
                  </div>
                  <span
                    className={`pb-4 text-[14.5px] ${
                      i === current
                        ? 'font-bold text-ink-900'
                        : done
                          ? 'font-medium text-ink-600'
                          : 'text-ink-400'
                    }`}
                  >
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>
        </Card>

        {/* Carte de suivi */}
        {enRoute && (
          <Card className="overflow-hidden">
            <DeliveryMap
              driver={driverPos}
              destination={destination}
              className="h-56 w-full"
            />
            <p className="border-t border-ink-100 px-4 py-2.5 text-[13px] text-ink-600">
              {driverPos
                ? 'Votre livreur est en route.'
                : "En attente de la position du livreur."}
            </p>
          </Card>
        )}

        {/* Code de réception */}
        {showQr && order.qrToken && (
          <Card className="p-5 text-center">
            <p className="text-[15px] font-bold text-ink-900">Code de réception</p>
            <p className="mt-1 text-[13px] text-ink-500">
              Montrez-le au livreur pour confirmer la remise.
            </p>
            <div className="mt-4 inline-block rounded-[11px] border border-ink-200 bg-white p-3">
              <QRCodeSVG value={order.qrToken} size={168} level="M" />
            </div>
          </Card>
        )}

        {/* Détail */}
        <Card className="p-5">
          <p className="text-[15px] font-bold text-ink-900">Détail</p>
          <ul className="mt-3 space-y-2">
            {order.items?.map((it) => {
              const removed = it.customization?.removed ?? []
              const added = it.customization?.added ?? []
              return (
                <li key={it.id} className="flex items-start gap-2.5 text-[14px]">
                  <span className="num font-bold text-ink-500">{it.quantity}×</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-ink-800">{it.productNameSnapshot}</span>
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
                  <span className="num font-semibold text-ink-700">
                    {moneyDT(it.unitPrice * it.quantity)}
                  </span>
                </li>
              )
            })}
          </ul>

          <dl className="mt-4 space-y-1.5 border-t border-ink-100 pt-3.5 text-[14px]">
            <Line label="Sous-total" value={order.subtotal} />
            {order.deliveryFee > 0 && <Line label="Livraison" value={order.deliveryFee} />}
            {order.tipAmount > 0 && <Line label="Pourboire" value={order.tipAmount} />}
            <div className="flex items-baseline justify-between pt-1.5">
              <dt className="text-[15px] font-bold text-ink-900">Total</dt>
              <dd className="num text-[19px] font-extrabold text-ink-900">
                {moneyDT(order.totalAmount)}
              </dd>
            </div>
          </dl>

          {order.deliveryAddress && (
            <p className="mt-3 border-t border-ink-100 pt-3 text-[13px] text-ink-500">
              Livraison à {order.deliveryAddress}
            </p>
          )}
        </Card>

        {/* Pourboire */}
        {isDelivery && order.status !== 'cancelled' && (
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Heart size={16} className="text-coral-500" strokeWidth={2.2} />
              <p className="text-[15px] font-bold text-ink-900">Remercier le livreur</p>
            </div>
            <p className="mt-1 text-[13px] text-ink-500">
              Le pourboire lui revient en totalité.
            </p>
            <div className="mt-3 flex gap-2">
              {TIPS.map((t) => (
                <Button
                  key={t}
                  variant={order.tipAmount === t ? 'primary' : 'secondary'}
                  className="num flex-1"
                  disabled={tipping}
                  onClick={() => addTip(t)}
                >
                  {t} DT
                </Button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd className="num font-semibold text-ink-800">{moneyDT(value)}</dd>
    </div>
  )
}
