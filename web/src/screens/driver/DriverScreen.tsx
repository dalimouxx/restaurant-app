import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bike,
  Navigation,
  PackageCheck,
  QrCode,
  Route,
  Wallet,
} from 'lucide-react'
import { delivery } from '../../lib/api'
import { emitDriverLocation, joinRoom, on } from '../../lib/socket'
import { useAuth } from '../../lib/store'
import { elapsed, haversineKm, money, moneyDT, orderNo } from '../../lib/format'
import { DeliveryMap } from '../../components/DeliveryMap'
import { Emoji } from '../../components/Emoji'
import type { DriverStats, Order } from '../../lib/types'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Modal,
  Skeleton,
  useNow,
  useToast,
} from '../../components/ui'
import { QrScanner, isScannerSupported } from '../../components/QrScanner'
import { Field, Input } from '../../components/ui'

type Tab = 'available' | 'earnings'

export default function DriverScreen() {
  const [tab, setTab] = useState<Tab>('available')
  const [available, setAvailable] = useState<Order[]>([])
  const [active, setActive] = useState<Order | null>(null)
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const { notify } = useToast()
  const user = useAuth((s) => s.user)
  const now = useNow(20000)

  const premierChargement = useRef(true)

  const load = useCallback(async () => {
    try {
      /**
       * La course en cours est relue à chaque cycle, pas seulement au
       * moment où le livreur l'accepte : un rafraîchissement, un téléphone
       * verrouillé ou une coupure de réseau la faisait disparaître de son
       * écran alors qu'elle lui restait assignée.
       */
      const [list, courante] = await Promise.all([
        delivery.available(),
        delivery.mine().catch(() => null),
      ])
      setAvailable(list)
      setActive(courante)
      // On n'impose l'onglet qu'à l'ouverture : ensuite le livreur navigue
      // où il veut, et un cycle de rafraîchissement ne doit pas le ramener.
      if (courante && premierChargement.current) setTab('available')
      premierChargement.current = false
    } catch {
      /* le prochain cycle réessaiera */
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStats = useCallback(async () => {
    try {
      setStats(await delivery.myStats())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    loadStats()
    const leave = joinRoom('drivers')
    const offNew = on('delivery:new_available', () => {
      load()
      notify('Nouvelle course disponible.', 'info')
      // Vibration courte : le livreur a le téléphone en poche.
      navigator.vibrate?.(180)
    })
    // Un autre livreur a été plus rapide : la course disparaît de l'écran.
    const offTaken = on<{ orderId: string }>('delivery:taken', (p) => {
      setAvailable((list) => list.filter((o) => o.id !== p.orderId))
    })
    const poll = setInterval(load, 20000)
    return () => {
      leave()
      offNew()
      offTaken()
      clearInterval(poll)
    }
  }, [load, loadStats, notify])

  // Position du livreur : sert au tri par distance et au suivi client.
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // Pendant une course, la position part vers le client en continu.
  const lastSent = useRef(0)
  useEffect(() => {
    if (!active || !pos || !user) return
    if (Date.now() - lastSent.current < 10000) return
    lastSent.current = Date.now()
    emitDriverLocation({
      driverId: user.id,
      orderId: active.id,
      lat: pos.lat,
      lng: pos.lng,
    })
    delivery.pushLocation(pos.lat, pos.lng).catch(() => {})
  }, [active, pos, user])

  async function accept(order: Order) {
    setAcceptingId(order.id)
    try {
      setActive(await delivery.accept(order.id))
      notify('Course acceptée.', 'success')
    } catch (e) {
      const taken = e instanceof Error && 'isTaken' in e && (e as { isTaken: boolean }).isTaken
      if (taken) {
        setAvailable((l) => l.filter((o) => o.id !== order.id))
        notify('Trop tard, un autre livreur a pris cette course.', 'error')
      } else {
        notify(e instanceof Error ? e.message : 'Course non attribuée.', 'error')
      }
    } finally {
      setAcceptingId(null)
    }
  }

  if (active) {
    return (
      <ActiveDelivery
        order={active}
        driverPos={pos}
        onDone={() => {
          setActive(null)
          load()
          loadStats()
        }}
      />
    )
  }

  return (
    <div className="dark-surface min-h-dvh bg-ink-900 pb-24">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-900/92 px-5 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <div>
            <p className="text-[12.5px] text-ink-500">Bonjour</p>
            <p className="text-[17px] font-bold text-white">{user?.fullName}</p>
          </div>
          {stats && (
            <div className="text-right">
              <p className="text-[12px] text-ink-500">Gains</p>
              <p className="num text-[19px] font-bold text-petrol-400">
                {moneyDT(stats.totalDriverEarnings)}
              </p>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-xl px-5 py-5">
        <div className="mb-5 flex gap-1 rounded-[11px] bg-ink-800 p-1">
          {(
            [
              ['available', 'Courses'],
              ['earnings', 'Mes gains'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`flex-1 rounded-[8px] py-2.5 text-[14px] font-bold transition-colors ${
                tab === value ? 'bg-ink-700 text-white' : 'text-ink-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'available' ? (
          loading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-[13px] bg-ink-800" />
              ))}
            </div>
          ) : available.length === 0 ? (
            <EmptyState
              dark
              icon={Bike}
              title="Aucune course pour le moment"
              description="Gardez cet écran ouvert, vous serez prévenu dès qu'une commande est prête."
            />
          ) : (
            <div className="space-y-3">
              {available.map((o) => (
                <AvailableCard
                  key={o.id}
                  order={o}
                  driverPos={pos}
                  now={now}
                  busy={acceptingId === o.id}
                  onAccept={() => accept(o)}
                />
              ))}
            </div>
          )
        ) : (
          <Earnings stats={stats} />
        )}
      </div>
    </div>
  )
}

/* ───────────────────────── Course disponible ───────────────────────── */

function AvailableCard({
  order,
  driverPos,
  now,
  busy,
  onAccept,
}: {
  order: Order
  driverPos: { lat: number; lng: number } | null
  now: number
  busy: boolean
  onAccept: () => void
}) {
  const share = order.deliveryFee * 0.7
  const km =
    driverPos && order.deliveryLat != null && order.deliveryLng != null
      ? haversineKm(driverPos.lat, driverPos.lng, order.deliveryLat, order.deliveryLng)
      : null

  return (
    <article className="animate-ticket-in rounded-[13px] border border-ink-700 bg-ink-800 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="num text-[19px] font-bold text-white">
            {orderNo(order.orderNumber)}
          </span>
          <p className="mt-0.5 text-[12px] text-ink-500">
            Prête depuis {elapsed(order.createdAt, now)}
          </p>
        </div>
        <span className="num rounded-full bg-petrol-600 px-3 py-1.5 text-[14px] font-bold text-white">
          + {money(share)} DT
        </span>
      </div>

      <p className="mt-3.5 text-[14px] leading-snug text-ink-200">
        {order.deliveryAddress ?? 'Adresse non précisée'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-500">
        {km != null && (
          <span className="flex items-center gap-1.5">
            <Route size={13} />
            <span className="num">{km.toFixed(1)} km</span>
          </span>
        )}
        <span>
          {order.items?.length ?? 0} article{(order.items?.length ?? 0) > 1 ? 's' : ''}
        </span>
        <span className="num">À encaisser {money(order.totalAmount)} DT</span>
      </div>

      <Button size="lg" className="mt-4 w-full" loading={busy} onClick={onAccept}>
        Accepter la course
      </Button>
    </article>
  )
}

/* ───────────────────────── Course en cours ───────────────────────── */

function ActiveDelivery({
  order,
  driverPos,
  onDone,
}: {
  order: Order
  driverPos: { lat: number; lng: number } | null
  onDone: () => void
}) {
  const [scanning, setScanning] = useState(false)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [delivered, setDelivered] = useState(false)
  const { notify } = useToast()

  const share = order.deliveryFee * 0.7 + order.tipAmount

  const distanceKm =
    driverPos && order.deliveryLat != null && order.deliveryLng != null
      ? haversineKm(driverPos.lat, driverPos.lng, order.deliveryLat, order.deliveryLng)
      : null

  const confirm = useCallback(
    async (token: string) => {
      setBusy(true)
      try {
        await delivery.confirm(order.id, token.trim())
        setScanning(false)
        setDelivered(true)
        notify('Livraison confirmée.', 'success')
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Code refusé.', 'error')
        setScanning(false)
      } finally {
        setBusy(false)
      }
    },
    [order.id, notify],
  )

  const mapsUrl =
    order.deliveryLat != null && order.deliveryLng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${order.deliveryLat},${order.deliveryLng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.deliveryAddress ?? '')}`

  if (delivered) {
    return (
      <div className="dark-surface grid min-h-dvh place-items-center bg-ink-900 px-6 text-center">
        <div>
          {/* Une course livree arrive quelques fois par service : c'est
              le seul endroit de l'ecran du livreur ou un peu de plaisir
              a sa place. Entre deux feux rouges, il n'a besoin que de
              l'adresse et du montant. */}
          <div className="mx-auto flex justify-center gap-2">
            <Emoji vie="rebondit" className="text-[38px]">🛵</Emoji>
            <Emoji vie="rebondit" retard={180} className="text-[38px]">✅</Emoji>
          </div>
          <p className="anim-monte mt-5 text-[22px] font-bold text-white">Course terminée</p>
          <p className="anim-surgit num mt-2 text-[17px] font-bold text-petrol-400">
            + {moneyDT(share)} pour vous
          </p>
          <Button size="lg" className="mt-8" onClick={onDone}>
            Chercher une nouvelle course
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="dark-surface min-h-dvh bg-ink-900 pb-8">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-900/92 px-5 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <span className="num text-[19px] font-bold text-white">
            {orderNo(order.orderNumber)}
          </span>
          <Chip tone="petrol">Course en cours</Chip>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-5 py-5">
        {/* La carte dans l'écran : le livreur voit où il va sans quitter
            l'application, et garde sous les yeux le montant à encaisser.
            Le bouton d'itinéraire reste là pour le guidage vocal. */}
        <div className="overflow-hidden rounded-[13px] border border-ink-700">
          <DeliveryMap
            driver={driverPos}
            destination={
              order.deliveryLat != null && order.deliveryLng != null
                ? { lat: order.deliveryLat, lng: order.deliveryLng }
                : null
            }
            className="h-[260px] w-full"
          />
          {order.deliveryLat == null && (
            <p className="bg-ink-800 px-4 py-2.5 text-[12.5px] leading-snug text-ink-400">
              Le client n'a pas partagé sa position : seule l'adresse écrite est
              disponible.
            </p>
          )}
          {distanceKm != null && (
            <div className="flex items-center justify-between gap-3 bg-ink-800 px-4 py-2.5">
              <span className="text-[12.5px] text-ink-400">À vol d'oiseau</span>
              <span className="num text-[14px] font-bold text-white">
                {distanceKm.toFixed(1)} km
              </span>
            </div>
          )}
        </div>

        <div className="rounded-[13px] border border-ink-700 bg-ink-800 p-4">
          <p className="text-[12.5px] font-semibold text-ink-500">Destination</p>
          <p className="mt-1 text-[16px] leading-snug font-semibold text-white">
            {order.deliveryAddress ?? 'Adresse non précisée'}
          </p>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3.5 flex h-12 items-center justify-center gap-2 rounded-[9px] border border-ink-600 text-[14.5px] font-bold text-white transition-colors hover:bg-ink-700"
          >
            <Navigation size={17} strokeWidth={2.2} />
            Ouvrir l'itinéraire
          </a>
          {driverPos && (
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-petrol-400">
              <span className="size-1.5 rounded-full bg-petrol-400" />
              Votre position est partagée avec le client
            </p>
          )}
        </div>

        <div className="rounded-[13px] border border-ink-700 bg-ink-800 p-4">
          <p className="text-[12.5px] font-semibold text-ink-500">Contenu</p>
          <ul className="mt-2 space-y-1.5">
            {order.items?.map((it) => (
              <li key={it.id} className="flex gap-2.5 text-[15px] text-white">
                <span className="num font-bold text-petrol-400">{it.quantity}×</span>
                {it.productNameSnapshot}
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-1.5 border-t border-ink-700 pt-3.5 text-[13.5px]">
            <DarkLine label="Sous-total" value={order.subtotal} />
            <DarkLine label="Livraison" value={order.deliveryFee} />
            {order.tipAmount > 0 && <DarkLine label="Pourboire" value={order.tipAmount} />}
            <div className="flex items-baseline justify-between pt-1.5">
              <dt className="text-[15px] font-bold text-white">À encaisser</dt>
              <dd className="num text-[20px] font-extrabold text-white">
                {moneyDT(order.totalAmount)}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex items-center justify-between rounded-[9px] bg-petrol-600/15 px-3.5 py-2.5">
            <span className="text-[12.5px] text-petrol-200">Votre part</span>
            <span className="num text-[15px] font-bold text-petrol-400">
              {moneyDT(share)}
            </span>
          </div>
        </div>

        <Button
          size="xl"
          icon={QrCode}
          className="w-full"
          onClick={() => setScanning(true)}
        >
          Scanner le code client
        </Button>
      </div>

      <Modal
        open={scanning}
        onClose={() => setScanning(false)}
        title="Code de réception"
        description="Demandez au client d'afficher son QR code."
      >
        {isScannerSupported() ? (
          <QrScanner onDetected={confirm} />
        ) : (
          <p className="mb-4 rounded-[9px] bg-saffron-50 px-3 py-2.5 text-[13px] text-saffron-700">
            La lecture par caméra n'est pas disponible sur ce navigateur. Demandez au client
            le code affiché sous son QR.
          </p>
        )}

        <div className="mt-4 border-t border-ink-100 pt-4">
          <Field label="Ou saisir le code manuellement">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Code de la commande"
            />
          </Field>
          <Button
            className="mt-3 w-full"
            variant="secondary"
            icon={PackageCheck}
            loading={busy}
            disabled={manual.trim().length === 0}
            onClick={() => confirm(manual)}
          >
            Confirmer la remise
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function DarkLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-400">{label}</dt>
      <dd className="num font-semibold text-ink-200">{moneyDT(value)}</dd>
    </div>
  )
}

/* ───────────────────────── Gains ───────────────────────── */

function Earnings({ stats }: { stats: DriverStats | null }) {
  if (!stats) return <Skeleton className="h-48" />

  return (
    <div className="space-y-4">
      <div className="rounded-[13px] bg-petrol-600 p-5">
        <p className="text-[12.5px] text-petrol-100">Gains nets</p>
        <p className="num mt-1 text-[34px] leading-none font-extrabold tracking-[-0.03em] text-white">
          {moneyDT(stats.totalDriverEarnings)}
        </p>
        <p className="mt-1.5 text-[12px] text-petrol-200">
          {stats.commissionPercent} % des frais de livraison, plus les pourboires
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/20 pt-3.5">
          <Stat label="Encaissé" value={money(stats.totalCollected)} />
          <Stat label="Pourboires" value={money(stats.totalTips)} />
          <Stat label="Courses" value={String(stats.deliveriesCount)} />
        </dl>
      </div>

      {stats.orders.length === 0 ? (
        <EmptyState dark icon={Wallet} title="Aucune course terminée" />
      ) : (
        <Card className="divide-y divide-ink-700 border-ink-700 bg-ink-800">
          {stats.orders.map((o) => (
            <div key={o.orderId} className="flex items-center gap-3 px-4 py-3">
              <span className="num text-[14px] font-bold text-white">
                {orderNo(o.orderNumber)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="num text-[12.5px] text-ink-400">
                  {money(o.totalAmount)} DT encaissés
                  {o.tip > 0 && ` · ${money(o.tip)} de pourboire`}
                </p>
              </div>
              <span className="num text-[14px] font-bold text-petrol-400">
                + {money(o.driverEarning)}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-petrol-200">{label}</dt>
      <dd className="num text-[15px] font-bold text-white">{value}</dd>
    </div>
  )
}
