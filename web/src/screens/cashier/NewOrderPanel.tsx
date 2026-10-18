import { useCallback, useEffect, useMemo, useState } from 'react'
import { Minus, Plus, ShoppingBag, Trash2, UtensilsCrossed } from 'lucide-react'
import { catalog, orders } from '../../lib/api'
import { lineUnitPrice } from '../../lib/store'
import { moneyDT, orderNo } from '../../lib/format'
import type { CartLine, Category, Product, ProductOption } from '../../lib/types'
import { Button, EmptyState, Modal, Skeleton, useToast } from '../../components/ui'
import { LineOptions, OptionPicker } from '../../components/OptionPicker'

/**
 * Prise de commande au comptoir. Pensée pour aller vite et sans clavier :
 * une grille de plats, un panneau de choix prédéfinis, rien à écrire.
 */
export function NewOrderPanel({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (orderNumber: number) => void
}) {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<CartLine[]>([])
  const [picking, setPicking] = useState<Product | null>(null)
  const [mode, setMode] = useState<'dine_in' | 'pickup'>('dine_in')
  const [submitting, setSubmitting] = useState(false)
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      const [cats, prods] = await Promise.all([catalog.categories(), catalog.products()])
      setCategories(cats)
      setProducts(prods)
      setActiveCat((c) => c ?? cats[0]?.id ?? null)
    } catch {
      notify('Menu indisponible.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const visible = useMemo(
    () => (activeCat ? products.filter((p) => p.categoryId === activeCat) : products),
    [products, activeCat],
  )

  const subtotal = lines.reduce((s, l) => s + lineUnitPrice(l) * l.quantity, 0)
  const count = lines.reduce((s, l) => s + l.quantity, 0)

  /** Un plat sans variante entre directement : un geste au lieu de trois. */
  function pick(product: Product) {
    if ((product.options?.length ?? 0) === 0) {
      addLine(product, [], 1)
      return
    }
    setPicking(product)
  }

  function addLine(product: Product, options: ProductOption[], quantity: number) {
    setLines((cur) => {
      const ids = new Set(options.map((o) => o.id))
      const i = cur.findIndex(
        (l) =>
          l.product.id === product.id &&
          l.options.length === options.length &&
          l.options.every((o) => ids.has(o.id)),
      )
      if (i >= 0) {
        const next = [...cur]
        next[i] = { ...next[i], quantity: next[i].quantity + quantity }
        return next
      }
      return [...cur, { product, quantity, options }]
    })
    setPicking(null)
  }

  function changeQty(index: number, delta: number) {
    setLines((cur) => {
      const next = [...cur]
      const q = next[index].quantity + delta
      if (q <= 0) next.splice(index, 1)
      else next[index] = { ...next[index], quantity: q }
      return next
    })
  }

  async function submit() {
    if (lines.length === 0) return
    setSubmitting(true)
    try {
      const order = await orders.createAtCounter(lines, mode)
      setLines([])
      onCreated(order.orderNumber)
      notify(`Commande ${orderNo(order.orderNumber)} enregistrée.`, 'success')
      onClose()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Commande refusée.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Nouvelle commande au comptoir"
        description="Touchez les plats, puis les choix du client."
        width="max-w-4xl"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Fermer
            </Button>
            <Button onClick={submit} loading={submitting} disabled={lines.length === 0}>
              Enregistrer — {moneyDT(subtotal)}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Catalogue */}
          <div className="min-w-0">
            <div className="scrollbar-none -mx-1 mb-3 flex gap-2 overflow-x-auto px-1">
              {loading
                ? [0, 1].map((i) => <Skeleton key={i} className="h-9 w-24 shrink-0" />)
                : categories.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActiveCat(c.id)}
                      className={`h-9 shrink-0 rounded-full px-4 text-[13.5px] font-bold transition-colors ${
                        c.id === activeCat
                          ? 'bg-ink-900 text-white'
                          : 'border border-ink-200 text-ink-600 hover:border-ink-300'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
            </div>

            {loading ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[72px]" />
                ))}
              </div>
            ) : (
              <div className="grid max-h-[46dvh] grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 overflow-y-auto">
                {visible.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pick(p)}
                    disabled={!p.isAvailable}
                    className={`flex min-h-[72px] flex-col justify-between rounded-[11px] border p-2.5 text-left transition-colors ${
                      p.isAvailable
                        ? 'border-ink-200 hover:border-petrol-400 hover:bg-petrol-50'
                        : 'cursor-not-allowed border-ink-200 opacity-50'
                    }`}
                  >
                    <span className="text-[13.5px] leading-tight font-semibold text-ink-900">
                      {p.name}
                    </span>
                    <span className="num text-[13px] font-bold text-ink-600">
                      {p.isAvailable ? moneyDT(p.price) : 'Épuisé'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Ticket en cours */}
          <div className="flex min-h-[220px] flex-col rounded-[11px] border border-ink-200 bg-ink-50">
            <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2.5">
              <span className="text-[13.5px] font-bold text-ink-900">
                Ticket {count > 0 && <span className="num text-ink-500">({count})</span>}
              </span>
              {lines.length > 0 && (
                <button
                  onClick={() => setLines([])}
                  className="flex items-center gap-1 text-[12px] font-semibold text-ink-500 transition-colors hover:text-coral-600"
                >
                  <Trash2 size={12} />
                  Vider
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {lines.length === 0 ? (
                <EmptyState icon={ShoppingBag} title="Ticket vide" />
              ) : (
                <ul className="divide-y divide-ink-200">
                  {lines.map((l, i) => (
                    <li key={`${l.product.id}-${i}`} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13.5px] leading-snug font-semibold text-ink-900">
                          {l.product.name}
                        </span>
                        <span className="num shrink-0 text-[13.5px] font-bold">
                          {moneyDT(lineUnitPrice(l) * l.quantity)}
                        </span>
                      </div>
                      <LineOptions options={l.options} />
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          onClick={() => changeQty(i, -1)}
                          aria-label="Retirer un"
                          className="grid size-7 place-items-center rounded-full border border-ink-200 bg-white text-ink-600"
                        >
                          <Minus size={13} strokeWidth={2.5} />
                        </button>
                        <span className="num w-6 text-center text-[13.5px] font-bold">
                          {l.quantity}
                        </span>
                        <button
                          onClick={() => changeQty(i, 1)}
                          aria-label="Ajouter un"
                          className="grid size-7 place-items-center rounded-full border border-ink-200 bg-white text-ink-600"
                        >
                          <Plus size={13} strokeWidth={2.5} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-ink-200 p-3">
              <div className="mb-2.5 grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['dine_in', 'Sur place'],
                    ['pickup', 'À emporter'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setMode(value)}
                    className={`h-9 rounded-[8px] text-[13px] font-bold transition-colors ${
                      mode === value
                        ? 'bg-petrol-50 text-petrol-700 ring-2 ring-petrol-600 ring-inset'
                        : 'border border-ink-200 text-ink-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-ink-600">Total</span>
                <span className="num text-[19px] font-extrabold text-ink-900">
                  {moneyDT(subtotal)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {!loading && visible.length === 0 && (
          <EmptyState icon={UtensilsCrossed} title="Aucun plat dans cette catégorie" />
        )}
      </Modal>

      <OptionPicker
        product={picking}
        open={picking !== null}
        onClose={() => setPicking(null)}
        onConfirm={(options, quantity) =>
          picking && addLine(picking, options, quantity)
        }
        withQuantity
      />
    </>
  )
}
