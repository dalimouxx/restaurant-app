import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bike,
  Crosshair,
  Minus,
  Plus,
  ShoppingBag,
  Store,
  UtensilsCrossed,
} from 'lucide-react'
import { auth, catalog, orders } from '../../lib/api'
import { useAuth, useCustomerCart } from '../../lib/store'
import { moneyDT } from '../../lib/format'
import type { Category, Product } from '../../lib/types'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  useToast,
} from '../../components/ui'
import { Wordmark } from '../../components/Shell'

/** Indicatif : le montant réel est toujours recalculé par le serveur. */
const DELIVERY_FEE_HINT = 7

export default function CustomerScreen() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkout, setCheckout] = useState(false)

  const cart = useCustomerCart()
  const { notify } = useToast()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const [cats, prods] = await Promise.all([catalog.categories(), catalog.products()])
      setCategories(cats)
      setProducts(prods)
      setActiveCat((c) => c ?? cats[0]?.id ?? null)
    } catch {
      notify('Menu indisponible pour le moment.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(
    () => (activeCat ? products.filter((p) => p.categoryId === activeCat) : products),
    [products, activeCat],
  )

  return (
    <div className="min-h-dvh bg-ink-50 pb-28">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/92 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4">
          <button onClick={() => navigate('/')} aria-label="Accueil">
            <Wordmark dark={false} />
          </button>
          <button
            onClick={() => navigate('/mes-commandes')}
            className="text-[13.5px] font-semibold text-ink-600 transition-colors hover:text-petrol-600"
          >
            Mes commandes
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4">
        <div className="py-6">
          <h1 className="text-[27px] leading-tight font-extrabold tracking-[-0.025em] text-ink-900">
            Notre carte
          </h1>
          <p className="mt-1 text-[14.5px] text-ink-500">
            Retrait sur place ou livraison, paiement à la réception.
          </p>
        </div>

        <div className="scrollbar-none sticky top-16 z-20 -mx-4 overflow-x-auto bg-ink-50/92 px-4 py-3 backdrop-blur-md">
          <div className="flex gap-2">
            {loading
              ? [0, 1].map((i) => <Skeleton key={i} className="h-9 w-24" />)
              : categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    className={`h-9 shrink-0 rounded-full px-4 text-[14px] font-bold transition-colors ${
                      c.id === activeCat
                        ? 'bg-ink-900 text-white'
                        : 'border border-ink-200 bg-white text-ink-600'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
          </div>
        </div>

        <div className="space-y-2.5 py-4">
          {loading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-[88px]" />)
          ) : visible.length === 0 ? (
            <EmptyState icon={UtensilsCrossed} title="Rien dans cette catégorie" />
          ) : (
            visible.map((p) => (
              <MenuRow key={p.id} product={p} onAdd={() => cart.add(p)} />
            ))
          )}
        </div>
      </div>

      {cart.lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          <div className="mx-auto max-w-3xl">
            <Button size="lg" className="w-full" onClick={() => setCheckout(true)}>
              <ShoppingBag size={18} strokeWidth={2.2} />
              <span className="flex-1 text-left">
                Voir le panier ({cart.count()})
              </span>
              <span className="num">{moneyDT(cart.subtotal())}</span>
            </Button>
          </div>
        </div>
      )}

      <Checkout open={checkout} onClose={() => setCheckout(false)} />
    </div>
  )
}

function MenuRow({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const out = !product.isAvailable
  return (
    <Card className={`flex items-center gap-3.5 p-3.5 ${out ? 'opacity-55' : ''}`}>
      <div className="size-16 shrink-0 overflow-hidden rounded-[9px] bg-ink-100">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="grid size-full place-items-center text-ink-300">
            <UtensilsCrossed size={20} strokeWidth={1.6} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-ink-900">{product.name}</p>
        {product.description && !out && (
          <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-500">{product.description}</p>
        )}
        {out && (
          <p className="mt-0.5 text-[13px] font-semibold text-coral-600">
            Épuisé pour aujourd'hui
          </p>
        )}
        <p className="num mt-1 text-[15px] font-bold text-ink-900">
          {moneyDT(product.price)}
        </p>
      </div>
      {!out && (
        <button
          onClick={onAdd}
          aria-label={`Ajouter ${product.name}`}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-petrol-50 text-petrol-600 transition-colors hover:bg-petrol-600 hover:text-white"
        >
          <Plus size={19} strokeWidth={2.6} />
        </button>
      )}
    </Card>
  )
}

/* ───────────────────────── Validation ───────────────────────── */

function Checkout({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCustomerCart()
  const user = useAuth((s) => s.user)
  const [mode, setMode] = useState<'pickup' | 'delivery'>('pickup')
  const [address, setAddress] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needsAccount, setNeedsAccount] = useState(false)
  const { notify } = useToast()
  const navigate = useNavigate()

  const fee = mode === 'delivery' ? DELIVERY_FEE_HINT : 0

  /**
   * Le livreur a besoin de coordonnées pour la distance et l'itinéraire.
   * Le navigateur les fournit, à condition que le site soit en HTTPS
   * (ou en localhost pendant les tests).
   */
  function locate() {
    if (!navigator.geolocation) {
      notify("Ce navigateur ne peut pas partager votre position.", 'error')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocating(false)
        notify('Position enregistrée pour le livreur.', 'success')
      },
      () => {
        setLocating(false)
        notify(
          "Position refusée. Le livreur utilisera l'adresse écrite.",
          'error',
        )
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function submit() {
    if (!user) {
      setNeedsAccount(true)
      return
    }
    if (mode === 'delivery' && address.trim().length < 6) {
      notify('Indiquez une adresse de livraison complète.', 'error')
      return
    }
    setBusy(true)
    try {
      const order = await orders.createOnline(
        cart.lines,
        mode,
        mode === 'delivery'
          ? { address: address.trim(), lat: coords?.lat, lng: coords?.lng }
          : undefined,
      )
      cart.clear()
      onClose()
      navigate(`/commande/${order.id}`)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Commande refusée.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open && !needsAccount}
        onClose={onClose}
        title="Votre commande"
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Continuer mes achats
            </Button>
            <Button onClick={submit} loading={busy}>
              Confirmer
            </Button>
          </>
        }
      >
        <ul className="space-y-2">
          {cart.lines.map((l, i) => (
            <li key={`${l.product.id}-${i}`} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-semibold text-ink-900">
                  {l.product.name}
                </p>
                <p className="num text-[13px] text-ink-500">{moneyDT(l.product.price)}</p>
              </div>
              <div className="flex items-center gap-0.5 rounded-full border border-ink-200 p-0.5">
                <button
                  onClick={() => cart.decrement(i)}
                  aria-label="Retirer un"
                  className="grid size-7 place-items-center rounded-full text-ink-600 hover:bg-ink-100"
                >
                  <Minus size={14} strokeWidth={2.4} />
                </button>
                <span className="num w-5 text-center text-[14px] font-bold">{l.quantity}</span>
                <button
                  onClick={() => cart.increment(i)}
                  aria-label="Ajouter un"
                  className="grid size-7 place-items-center rounded-full text-ink-600 hover:bg-ink-100"
                >
                  <Plus size={14} strokeWidth={2.4} />
                </button>
              </div>
              <span className="num w-[68px] shrink-0 text-right text-[14px] font-bold">
                {moneyDT(l.product.price * l.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <ModeCard
            active={mode === 'pickup'}
            icon={Store}
            label="Je récupère"
            detail="Sans frais"
            onClick={() => setMode('pickup')}
          />
          <ModeCard
            active={mode === 'delivery'}
            icon={Bike}
            label="Livraison"
            detail={`+ ${moneyDT(DELIVERY_FEE_HINT)}`}
            onClick={() => setMode('delivery')}
          />
        </div>

        {mode === 'delivery' && (
          <div className="mt-4 space-y-2.5">
            <Field label="Adresse de livraison">
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Rue, numéro, étage, repère"
              />
            </Field>
            <button
              onClick={locate}
              disabled={locating}
              className={`flex w-full items-center justify-center gap-2 rounded-[9px] border px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
                coords
                  ? 'border-petrol-200 bg-petrol-50 text-petrol-700'
                  : 'border-ink-200 text-ink-600 hover:border-ink-300'
              }`}
            >
              <Crosshair size={15} />
              {locating
                ? 'Localisation…'
                : coords
                  ? 'Position partagée avec le livreur'
                  : 'Partager ma position GPS'}
            </button>
            <p className="text-[12px] leading-snug text-ink-500">
              La position aide le livreur à vous trouver et à calculer son trajet.
            </p>
          </div>
        )}

        <dl className="mt-5 space-y-1.5 border-t border-ink-100 pt-4 text-[14px]">
          <div className="flex justify-between">
            <dt className="text-ink-500">Sous-total</dt>
            <dd className="num font-semibold">{moneyDT(cart.subtotal())}</dd>
          </div>
          {fee > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-500">Livraison</dt>
              <dd className="num font-semibold">{moneyDT(fee)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-1.5">
            <dt className="text-[15px] font-bold text-ink-900">Total</dt>
            <dd className="num text-[20px] font-extrabold text-ink-900">
              {moneyDT(cart.subtotal() + fee)}
            </dd>
          </div>
        </dl>

        <p className="mt-3 rounded-[9px] bg-ink-50 px-3 py-2.5 text-[12.5px] leading-snug text-ink-600">
          Paiement à la réception. Vous pourrez ajouter un pourboire une fois la commande
          passée.
        </p>
      </Modal>

      <AccountGate
        open={needsAccount}
        onClose={() => setNeedsAccount(false)}
        onReady={() => {
          setNeedsAccount(false)
          submit()
        }}
      />
    </>
  )
}

function ModeCard({
  active,
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  active: boolean
  icon: typeof Store
  label: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[11px] border p-3.5 text-left transition-colors ${
        active
          ? 'border-petrol-600 bg-petrol-50 ring-1 ring-petrol-600'
          : 'border-ink-200 hover:border-ink-300'
      }`}
    >
      <Icon
        size={19}
        strokeWidth={2.1}
        className={active ? 'text-petrol-600' : 'text-ink-400'}
      />
      <p
        className={`mt-2 text-[14.5px] font-bold ${active ? 'text-petrol-800' : 'text-ink-900'}`}
      >
        {label}
      </p>
      <p className={`text-[12.5px] ${active ? 'text-petrol-700' : 'text-ink-500'}`}>
        {detail}
      </p>
    </button>
  )
}

/** Création de compte au dernier moment, pour ne pas bloquer la découverte du menu. */
function AccountGate({
  open,
  onClose,
  onReady,
}: {
  open: boolean
  onClose: () => void
  onReady: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const setUser = useAuth((s) => s.setUser)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2 || phone.trim().length < 6) {
      setError('Nom et téléphone sont nécessaires pour vous joindre.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      setUser(await auth.registerCustomer({ fullName: name.trim(), phone: phone.trim() }))
      onReady()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vos coordonnées"
      description="Pour vous prévenir quand la commande est prête."
    >
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Nom">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Téléphone" error={error}>
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="20 123 456"
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Continuer
        </Button>
      </form>
    </Modal>
  )
}
