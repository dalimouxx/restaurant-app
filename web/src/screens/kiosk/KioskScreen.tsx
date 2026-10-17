import { useCallback, useEffect, useMemo, useState } from 'react'
import { Minus, Plus, ShoppingBag, Trash2, UtensilsCrossed } from 'lucide-react'
import { catalog, orders } from '../../lib/api'
import { on } from '../../lib/socket'
import { useKioskCart } from '../../lib/store'
import { moneyDT, orderNo } from '../../lib/format'
import type { Category, Product } from '../../lib/types'
import { Button, EmptyState, Skeleton, useToast } from '../../components/ui'
import { Wordmark } from '../../components/Shell'

type Stage = 'ordering' | 'done'

export default function KioskScreen() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState<Stage>('ordering')
  const [placedNumber, setPlacedNumber] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'dine_in' | 'pickup'>('dine_in')

  const cart = useKioskCart()
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      const [cats, prods] = await Promise.all([catalog.categories(), catalog.products()])
      setCategories(cats)
      setProducts(prods)
      setActiveCat((cur) => cur ?? cats[0]?.id ?? null)
    } catch {
      notify('Menu indisponible. Nouvelle tentative en cours.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  // Le stock bouge ailleurs (comptoir, commandes en ligne) : on resynchronise
  // pour ne jamais proposer un plat qui n'est plus réalisable.
  useEffect(() => {
    const offA = on('order:updated', load)
    const offB = on('stock:low_alert', load)
    const id = setInterval(load, 60000)
    return () => {
      offA()
      offB()
      clearInterval(id)
    }
  }, [load])

  const visible = useMemo(
    () => (activeCat ? products.filter((p) => p.categoryId === activeCat) : products),
    [products, activeCat],
  )

  async function submit() {
    setSubmitting(true)
    try {
      const order = await orders.createFromKiosk(cart.lines, mode)
      setPlacedNumber(order.orderNumber)
      cart.clear()
      setStage('done')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Commande refusée.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (stage === 'done' && placedNumber !== null) {
    return <KioskDone number={placedNumber} onRestart={() => setStage('ordering')} />
  }

  return (
    <div className="flex h-dvh flex-col bg-ink-50 lg:flex-row">
      {/* Menu */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 px-6 pt-6 pb-4 sm:px-10 sm:pt-10">
          <Wordmark dark={false} />
          <h1 className="mt-5 text-[30px] leading-[1.15] font-extrabold tracking-[-0.025em] text-ink-900 sm:text-[38px]">
            Composez votre commande
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-500">
            Touchez un plat pour l'ajouter. Vous paierez en caisse.
          </p>
        </header>

        <div className="scrollbar-none shrink-0 overflow-x-auto px-6 pb-4 sm:px-10">
          <div className="flex gap-2">
            {loading
              ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-28" />)
              : categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    className={`h-11 shrink-0 rounded-full px-5 text-[15px] font-bold transition-colors ${
                      c.id === activeCat
                        ? 'bg-ink-900 text-white'
                        : 'border border-ink-200 bg-white text-ink-700 hover:border-ink-300'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-10">
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-[190px]" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={UtensilsCrossed}
              title="Rien dans cette catégorie"
              description="Choisissez une autre catégorie ci-dessus."
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
              {visible.map((p) => (
                <ProductTile key={p.id} product={p} onAdd={() => cart.add(p)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panier */}
      <aside className="flex max-h-[52dvh] shrink-0 flex-col border-t border-ink-200 bg-white lg:max-h-none lg:w-[380px] lg:border-t-0 lg:border-l">
        <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="text-[16px] font-bold text-ink-900">Votre commande</h2>
          {cart.lines.length > 0 && (
            <button
              onClick={cart.clear}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 transition-colors hover:text-coral-600"
            >
              <Trash2 size={14} />
              Tout retirer
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {cart.lines.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="Panier vide"
              description="Vos plats apparaîtront ici."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {cart.lines.map((line, i) => (
                <li key={`${line.product.id}-${i}`} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold text-ink-900">
                      {line.product.name}
                    </p>
                    <p className="num mt-0.5 text-[13px] text-ink-500">
                      {moneyDT(line.product.price)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 rounded-full border border-ink-200 p-0.5">
                    <button
                      onClick={() => cart.decrement(i)}
                      aria-label="Retirer un"
                      className="grid size-8 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100"
                    >
                      <Minus size={15} strokeWidth={2.4} />
                    </button>
                    <span className="num w-6 text-center text-[15px] font-bold">
                      {line.quantity}
                    </span>
                    <button
                      onClick={() => cart.increment(i)}
                      aria-label="Ajouter un"
                      className="grid size-8 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100"
                    >
                      <Plus size={15} strokeWidth={2.4} />
                    </button>
                  </div>
                  <span className="num w-[72px] shrink-0 text-right text-[14.5px] font-bold">
                    {moneyDT(line.product.price * line.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cart.lines.length > 0 && (
          <div className="shrink-0 border-t border-ink-100 p-5">
            <div className="mb-4 grid grid-cols-2 gap-2">
              {(
                [
                  ['dine_in', 'Sur place'],
                  ['pickup', 'À emporter'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`h-12 rounded-[9px] text-[14.5px] font-bold transition-colors ${
                    mode === value
                      ? 'bg-petrol-50 text-petrol-700 ring-2 ring-petrol-600 ring-inset'
                      : 'border border-ink-200 text-ink-600 hover:border-ink-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mb-4 flex items-baseline justify-between">
              <span className="text-[15px] font-semibold text-ink-600">Total</span>
              <span className="num text-[26px] font-extrabold tracking-[-0.02em] text-ink-900">
                {moneyDT(cart.subtotal())}
              </span>
            </div>

            <Button
              size="xl"
              className="w-full"
              loading={submitting}
              onClick={submit}
            >
              Valider ma commande
            </Button>
          </div>
        )}
      </aside>
    </div>
  )
}

function ProductTile({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const out = !product.isAvailable
  return (
    <button
      onClick={onAdd}
      disabled={out}
      className={`group flex flex-col overflow-hidden rounded-[13px] border bg-white text-left transition-all ${
        out
          ? 'cursor-not-allowed border-ink-200 opacity-55'
          : 'border-ink-200 hover:-translate-y-0.5 hover:border-petrol-400 hover:shadow-[0_6px_20px_-8px_rgba(11,107,91,0.35)] active:translate-y-0'
      }`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink-100">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid size-full place-items-center text-ink-300">
            <UtensilsCrossed size={30} strokeWidth={1.5} />
          </div>
        )}
        {out && (
          <div className="absolute inset-x-0 bottom-0 bg-ink-900/85 py-1.5 text-center text-[12.5px] font-bold text-white">
            Épuisé
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <p className="text-[15px] leading-snug font-bold text-ink-900">{product.name}</p>
        {product.description && (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-500">
            {product.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="num text-[16px] font-extrabold text-ink-900">
            {moneyDT(product.price)}
          </span>
          {!out && (
            <span className="grid size-8 place-items-center rounded-full bg-petrol-50 text-petrol-600 transition-colors group-hover:bg-petrol-600 group-hover:text-white">
              <Plus size={17} strokeWidth={2.6} />
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function KioskDone({ number, onRestart }: { number: number; onRestart: () => void }) {
  const [left, setLeft] = useState(15)

  useEffect(() => {
    const id = setInterval(() => setLeft((v) => v - 1), 1000)
    const done = setTimeout(onRestart, 15000)
    return () => {
      clearInterval(id)
      clearTimeout(done)
    }
  }, [onRestart])

  return (
    <div className="dark-surface flex h-dvh flex-col items-center justify-center bg-ink-900 px-6 text-center">
      <p className="text-[17px] font-semibold text-ink-400">Commande enregistrée</p>
      <p className="mt-2 max-w-md text-[26px] leading-tight font-bold text-white sm:text-[32px]">
        Présentez ce numéro en caisse
      </p>

      <div className="animate-ticket-in mt-10 rounded-[20px] bg-white px-14 py-8">
        <span className="num block text-[84px] leading-none font-bold tracking-[-0.04em] text-petrol-600 sm:text-[110px]">
          {orderNo(number)}
        </span>
      </div>

      <p className="mt-10 text-[14px] text-ink-500">
        Votre préparation démarre dès le paiement.
      </p>

      <button
        onClick={onRestart}
        className="mt-8 text-[14px] font-semibold text-ink-400 underline-offset-4 transition-colors hover:text-white hover:underline"
      >
        Nouvelle commande ({left})
      </button>
    </div>
  )
}
