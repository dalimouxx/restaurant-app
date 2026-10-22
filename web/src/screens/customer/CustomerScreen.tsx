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
import { auth, catalog, orders, settingsApi, zones as zonesApi } from '../../lib/api'
import { lineUnitPrice, useAuth, useCustomerCart } from '../../lib/store'
import { moneyDT } from '../../lib/format'
import type {
  Category,
  DeliveryZone,
  OpeningState,
  Product,
  ProductOption,
} from '../../lib/types'
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
import { LineOptions, OptionPicker } from '../../components/OptionPicker'
import { Emoji, emojiPlat, emojiPour } from '../../components/Emoji'
import { useReglages } from '../../lib/reglages'
import { retenirCommande } from '../../lib/derniereCommande'
import { RepriseCommande } from '../../components/RepriseCommande'

/** Indicatif : le montant réel est toujours recalculé par le serveur. */

export default function CustomerScreen() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkout, setCheckout] = useState(false)
  const [picking, setPicking] = useState<Product | null>(null)
  const [opening, setOpening] = useState<OpeningState | null>(null)

  const cart = useCustomerCart()
  const { notify } = useToast()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const { categories: cats, products: prods } = await catalog.menu()
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
    // L'etat d'ouverture est calcule par le serveur : l'horloge du
    // telephone du client n'a pas voix au chapitre.
    settingsApi
      .get()
      .then((s) => setOpening(s.opening))
      .catch(() => setOpening(null))
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

      {opening && !opening.open && (
        <div className="border-b border-saffron-500/35 bg-saffron-50 px-4 py-3 text-center sm:px-6">
          <p className="text-[13.5px] leading-snug font-semibold text-saffron-700">
            Nous sommes fermés pour le moment.
            {opening.opensAt && (
              <>
                {' '}Réouverture {opening.opensDay} à{' '}
                <span className="num">{opening.opensAt}</span>.
              </>
            )}
          </p>
          <p className="mt-0.5 text-[12.5px] text-saffron-700/80">
            Vous pouvez composer votre commande, elle sera acceptée à l'ouverture.
          </p>
        </div>
      )}

      <div className="mx-auto max-w-3xl px-4">
        <div className="pt-4">
          <RepriseCommande />
        </div>
        <div className="py-6">
          <h1 className="anim-monte flex items-center gap-2.5 text-[27px] leading-tight font-extrabold tracking-[-0.025em] text-ink-900">
            Notre carte
            <Emoji vie="rebondit" className="text-[28px]">🍟</Emoji>
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
                    className={`reagit flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-bold transition-colors ${
                      c.id === activeCat
                        ? 'bg-ink-900 text-white'
                        : 'border border-ink-200 bg-white text-ink-600'
                    }`}
                  >
                    <Emoji vie={c.id === activeCat ? 'fretille' : 'immobile'}>
                      {emojiPour(c.name)}
                    </Emoji>
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
            <div key={activeCat ?? 'tout'} className="anim-cascade space-y-2.5">
            {visible.map((p) => (
              <MenuRow
                key={p.id}
                categorie={categories.find((c) => c.id === p.categoryId)?.name}
                product={p}
                onAdd={() => {
                  if ((p.options?.length ?? 0) === 0) cart.add(p)
                  else setPicking(p)
                }}
              />
            ))}
            </div>
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

      <OptionPicker
        product={picking}
        open={picking !== null}
        onClose={() => setPicking(null)}
        onConfirm={(options: ProductOption[]) => {
          if (picking) cart.add(picking, options)
          setPicking(null)
        }}
      />
    </div>
  )
}

function MenuRow({
  product,
  categorie,
  onAdd,
}: {
  product: Product
  categorie?: string
  onAdd: () => void
}) {
  const out = !product.isAvailable
  return (
    <Card className={`flex items-center gap-3.5 p-3.5 ${out ? 'opacity-55' : ''}`}>
      <div className="size-16 shrink-0 overflow-hidden rounded-[9px] bg-ink-100">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="grid size-full place-items-center bg-gradient-to-br from-saffron-50 to-petrol-50">
            <Emoji vie="flotte" className="text-[28px]">
              {emojiPlat(product.name, categorie)}
            </Emoji>
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
  const { livraison: livraisonOuverte } = useReglages()

  const [address, setAddress] = useState('')
  const [zoneList, setZoneList] = useState<DeliveryZone[]>([])
  const [zoneId, setZoneId] = useState<string>('')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [nom, setNom] = useState(user?.fullName ?? '')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needsAccount, setNeedsAccount] = useState(false)
  const { notify } = useToast()
  const navigate = useNavigate()

  const zone = zoneList.find((z) => z.id === zoneId) ?? null

  /**
   * La livraison est proposable quand elle est ouverte ET qu'au moins
   * une zone est tarifee. Les deux conditions sont necessaires : sans
   * zone, le serveur ne saurait ni quels frais appliquer ni quel delai
   * annoncer.
   */
  const livraisonPossible = livraisonOuverte && zoneList.length > 0
  useEffect(() => {
    if (mode === 'delivery' && !livraisonPossible) setMode('pickup')
  }, [mode, livraisonPossible])

  const fee = mode === 'delivery' ? (zone?.fee ?? 0) : 0
  const cheapest = zoneList.length > 0 ? Math.min(...zoneList.map((z) => z.fee)) : 0
  const missing =
    mode === 'delivery' && zone ? Math.max(0, zone.minimumOrder - cart.subtotal()) : 0

  // Les zones viennent du serveur : aucun tarif n'est ecrit dans l'interface.
  useEffect(() => {
    if (!open) return
    zonesApi
      .list()
      .then((list) => {
        setZoneList(list)
        setZoneId((cur) => cur || list[0]?.id || '')
      })
      .catch(() => setZoneList([]))
  }, [open])

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
    /**
     * Le compte n'est plus un peage.
     *
     * Quelqu'un qui scanne le code pose sur sa table ne creera pas un
     * compte avant de commander un sandwich : il refermera l'onglet.
     * Le nom et le telephone suffisent — le telephone reste exige, car
     * c'est le seul moyen de joindre un client dont la commande pose
     * probleme.
     */
    if (!user) {
      if (nom.trim().length < 2) {
        notify('Indiquez votre nom.', 'error')
        return
      }
      if (phone.replace(/\D/g, '').length < 8) {
        notify('Indiquez un téléphone où vous joindre.', 'error')
        return
      }
    }
    if (mode === 'delivery') {
      if (address.trim().length < 6) {
        notify('Indiquez une adresse de livraison complète.', 'error')
        return
      }
      if (!zone) {
        notify('Choisissez votre zone de livraison.', 'error')
        return
      }
      if (missing > 0) {
        notify(
          `Minimum ${moneyDT(zone.minimumOrder)} pour livrer à ${zone.name}.`,
          'error',
        )
        return
      }
    }
    setBusy(true)
    try {
      const order = await orders.createOnline(cart.lines, mode, {
        customerPhone: phone.trim() || undefined,
        customerName: nom.trim() || user?.fullName || undefined,
        ...(mode === 'delivery'
          ? {
              address: address.trim(),
              lat: coords?.lat,
              lng: coords?.lng,
              zoneId: zone?.id,
            }
          : {}),
      })
      // Le chemin de retour, avant de vider le panier : si le client
      // ferme son onglet en sortant d'ici, c'est tout ce qui lui restera
      // pour retrouver sa commande.
      retenirCommande(order.id, order.orderNumber)
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
                <LineOptions options={l.options} />
                <p className="num text-[13px] text-ink-500">{moneyDT(lineUnitPrice(l))}</p>
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
                {moneyDT(lineUnitPrice(l) * l.quantity)}
              </span>
            </li>
          ))}
        </ul>

        {/*
          * La livraison n'est proposee que si elle est reellement
          * assurable : le gerant la coupe quand son livreur n'est pas la,
          * et il faut aussi au moins une zone tarifee. Le serveur le
          * refusait deja, mais a la toute fin — le client composait sa
          * commande, saisissait son adresse, et n'apprenait qu'au moment
          * de confirmer qu'il avait perdu son temps.
          */}
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
            indisponible={!livraisonPossible}
            icon={Bike}
            label="Livraison"
            detail={
              !livraisonOuverte
                ? 'Suspendue ce soir'
                : zoneList.length === 0
                  ? 'Indisponible'
                  : `dès ${moneyDT(cheapest)}`
            }
            onClick={() => livraisonPossible && setMode('delivery')}
          />
        </div>

        {!livraisonPossible && (
          <p className="anim-surgit mt-2.5 flex items-start gap-2 rounded-[11px] bg-saffron-50 px-3.5 py-3 text-[13px] leading-snug text-saffron-700">
            <Emoji vie="fretille" className="mt-px">🛵</Emoji>
            <span>
              {livraisonOuverte
                ? "Aucune zone de livraison n'est ouverte pour le moment."
                : 'La livraison est suspendue en ce moment. Vous pouvez commander et venir récupérer.'}
            </span>
          </p>
        )}

        {mode === 'delivery' && livraisonPossible && (
          <div className="mt-4 space-y-2.5">
            {zoneList.length === 0 ? (
              <p className="rounded-[9px] bg-ink-100 px-3.5 py-3 text-[13px] leading-snug text-ink-600">
                La livraison n'est pas proposée pour le moment. Choisissez
                « Je récupère ».
              </p>
            ) : (
              <Field label="Votre quartier" hint="Il détermine les frais et le délai">
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {zoneList.map((z) => (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => setZoneId(z.id)}
                      className={`rounded-[9px] border px-3 py-2.5 text-left transition-colors ${
                        z.id === zoneId
                          ? 'border-petrol-500 bg-petrol-50'
                          : 'border-ink-200 hover:border-ink-300'
                      }`}
                    >
                      <span className="block text-[13.5px] font-semibold text-ink-900">
                        {z.name}
                      </span>
                      <span className="num block text-[12px] text-ink-500">
                        {moneyDT(z.fee)} · ~{z.estimatedMinutes} min
                        {z.minimumOrder > 0 && ` · min ${moneyDT(z.minimumOrder)}`}
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {missing > 0 && zone && (
              <p className="rounded-[9px] border border-saffron-500/35 bg-saffron-50 px-3.5 py-2.5 text-[12.5px] leading-snug text-saffron-700">
                Il manque <span className="num font-bold">{moneyDT(missing)}</span> pour
                atteindre le minimum de {zone.name}.
              </p>
            )}

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

        {!user && (
          <div className="mt-4">
            <Field label="Votre nom" hint="Pour qu'on vous appelle quand c'est prêt">
              <Input
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                placeholder="Prénom ou nom"
                autoComplete="name"
              />
            </Field>
          </div>
        )}

        <div className="mt-4">
          <Field
            label="Votre téléphone"
            hint={user ? "Pour vous prévenir quand c'est prêt" : 'Obligatoire — pour vous joindre si besoin'}
          >
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="20 123 456"
              className="num"
            />
          </Field>
        </div>

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
  indisponible = false,
  onClick,
}: {
  active: boolean
  icon: typeof Store
  label: string
  detail: string
  indisponible?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={indisponible}
      aria-disabled={indisponible}
      className={`reagit rounded-[13px] border p-3.5 text-left transition-colors ${
        indisponible
          ? 'cursor-not-allowed border-ink-200 bg-ink-50 opacity-60'
          : active
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
