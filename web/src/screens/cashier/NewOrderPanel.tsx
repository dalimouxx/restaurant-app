import { useCallback, useEffect, useMemo, useState } from 'react'
import { Minus, Plus, ShoppingBag, Trash2, UtensilsCrossed } from 'lucide-react'
import { catalog, orders } from '../../lib/api'
import { lineUnitPrice } from '../../lib/store'
import { journeeDuJour, moneyDT, orderNo } from '../../lib/format'
import {
  carteRetenue,
  composerVente,
  estUnePanneReseau,
  mettreDeCote,
  prendreUnNumero,
  retenirLaCarte,
  ticketDeSecours,
} from '../../lib/horsLigne'
import { usePrint } from '../../components/PrintHost'
import { useAuth } from '../../lib/store'
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
  const { print } = usePrint()
  const user = useAuth((st) => st.user)

  /**
   * La carte, du serveur ou de la mémoire de la tablette.
   *
   * Tout le reste du mode hors ligne ne sert à rien si le caissier ne
   * peut pas voir les plats : il ne peut composer aucune commande, et
   * les numéros mis de côté dorment pour rien. On recopie donc la carte
   * à chaque fois qu'on la reçoit, et on la ressert telle quelle le
   * jour où le réseau manque.
   *
   * Une carte de la veille vaut mieux que pas de carte. Un prix changé
   * ce matin passerait inaperçu — mais le serveur recalcule de toute
   * façon le montant à l'arrivée, à partir de ses propres prix : ce que
   * voit le caissier peut être périmé, ce qui est facturé ne l'est pas.
   */
  const load = useCallback(async () => {
    try {
      const { categories: cats, products: prods } = await catalog.menu()
      setCategories(cats)
      setProducts(prods)
      setActiveCat((c) => c ?? cats[0]?.id ?? null)
      retenirLaCarte({ categories: cats, products: prods })
    } catch {
      const retenue = carteRetenue<{ categories: Category[]; products: Product[] }>()
      if (retenue) {
        setCategories(retenue.carte.categories)
        setProducts(retenue.carte.products)
        setActiveCat((c) => c ?? retenue.carte.categories[0]?.id ?? null)
        notify('Carte de la dernière connexion : le réseau ne répond pas.', 'info')
      } else {
        notify(
          'Menu indisponible, et cette tablette ne l\'a jamais chargé. ' +
            'Encaissez à la main.',
          'error',
        )
      }
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

  /**
   * Enregistre la vente, avec ou sans réseau.
   *
   * La référence est tirée au sort **avant** l'envoi, et c'est tout
   * l'intérêt : si la réponse se perd, la vente peut être rejouée sans
   * risque d'être enregistrée deux fois. Sans elle, un caissier qui
   * retente après un écran figé vend deux fois le même sandwich.
   *
   * Si le réseau manque, la vente part dans la file locale avec un
   * numéro pioché dans la tranche réservée d'avance. Le client reçoit
   * son ticket, l'argent entre dans le tiroir, et le service continue.
   *
   * **Deux cas où l'on refuse, et où il faut le dire franchement.**
   * Plus de numéros en réserve : en inventer un le ferait réapparaître
   * sur le ticket d'un autre client. Stockage indisponible : une vente
   * qu'on croit mise de côté et qui ne l'est pas disparaît sans bruit,
   * et l'écart de caisse du soir devient inexplicable.
   */
  async function submit() {
    if (lines.length === 0) return
    setSubmitting(true)

    /**
     * Hors ligne, la vente part deja encaissee — en especes.
     *
     * Ce n'est pas un raccourci : au comptoir, le caissier prend la
     * commande et l'argent dans le meme geste, et un terminal de carte
     * ne fonctionne pas davantage sans reseau. L'enregistrer « a
     * encaisser » la ferait revenir dans la file au retour du reseau,
     * et le client — deja parti — serait encaisse une seconde fois par
     * le suivant qui prendrait son numero.
     */
    const vente = composerVente(lines, mode, 0, undefined, {
      methode: 'cash',
      quand: new Date().toISOString(),
    })
    try {
      const order = await orders.createAtCounter(lines, mode, undefined, vente.clientRef)
      setLines([])
      onCreated(order.orderNumber)
      notify(`Commande ${orderNo(order.orderNumber)} enregistrée.`, 'success')
      onClose()
      return
    } catch (e) {
      if (!estUnePanneReseau(e)) {
        notify(e instanceof Error ? e.message : 'Commande refusée.', 'error')
        setSubmitting(false)
        return
      }
    }

    // Le réseau manque : on continue sans lui.
    const numero = prendreUnNumero(journeeDuJour())
    if (numero === null) {
      notify(
        'Réseau coupé et plus aucun numéro en réserve. Encaissez à la main et ' +
          'ressaisissez la vente au retour du réseau.',
        'error',
      )
      setSubmitting(false)
      return
    }

    if (!mettreDeCote({ ...vente, orderNumber: numero })) {
      notify(
        "Cette tablette ne peut rien enregistrer hors ligne. Notez la vente sur " +
          'papier : elle serait perdue.',
        'error',
      )
      setSubmitting(false)
      return
    }

    /**
     * Le ticket, tout de suite.
     *
     * Une caisse qui prend l'argent sans rien donner n'est pas une
     * caisse — et le client a besoin de son numéro : c'est lui qui
     * s'affichera sur l'écran de salle quand son plat sera prêt. On
     * l'imprime depuis ce que la tablette vient d'enregistrer, sans
     * rien demander au serveur.
     */
    try {
      print({
        order: ticketDeSecours({ ...vente, orderNumber: numero }),
        kind: 'receipt',
        cashierName: user?.fullName,
      })
    } catch {
      // Pas d'imprimante : le numéro reste annoncé à l'écran.
    }

    setLines([])
    onCreated(numero)
    notify(
      `${orderNo(numero)} encaissée en espèces, hors ligne. Elle partira au retour du réseau.`,
      'info',
    )
    onClose()
    setSubmitting(false)
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
