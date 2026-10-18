import { useMemo, useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import { moneyDT } from '../lib/format'
import type { Product, ProductOption } from '../lib/types'
import { Button, Modal } from './ui'

/**
 * Choix d'un plat, uniquement au doigt : retraits à gauche, ajouts à droite.
 * Rien ne se tape — la cuisine reçoit toujours le même vocabulaire, et le
 * prix se met à jour pendant la sélection.
 */
export function OptionPicker({
  product,
  open,
  onClose,
  onConfirm,
  /** Nombre d'exemplaires modifiable : utile au comptoir, inutile en ligne. */
  withQuantity = false,
}: {
  product: Product | null
  open: boolean
  onClose: () => void
  onConfirm: (options: ProductOption[], quantity: number) => void
  withQuantity?: boolean
}) {
  const [picked, setPicked] = useState<Record<string, ProductOption>>({})
  const [quantity, setQuantity] = useState(1)
  const [lastProductId, setLastProductId] = useState<string | null>(null)

  // Remet à zéro quand on ouvre un autre plat, sans effet de bord.
  if (product && product.id !== lastProductId) {
    setLastProductId(product.id)
    setPicked({})
    setQuantity(1)
  }

  const options = product?.options ?? []
  const removes = useMemo(() => options.filter((o) => o.kind === 'remove'), [options])
  const adds = useMemo(() => options.filter((o) => o.kind === 'add'), [options])

  const chosen = Object.values(picked)
  const extras = chosen.reduce((s, o) => s + o.extraPrice, 0)
  const unit = (product?.price ?? 0) + extras
  const total = unit * quantity

  function toggle(option: ProductOption) {
    setPicked((cur) => {
      const next = { ...cur }
      if (next[option.id]) delete next[option.id]
      else next[option.id] = option
      return next
    })
  }

  if (!product) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product.name}
      description={
        options.length === 0
          ? 'Aucune variante pour ce produit.'
          : 'Touchez les choix du client.'
      }
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => onConfirm(chosen, quantity)}>
            Ajouter — {moneyDT(total)}
          </Button>
        </>
      }
    >
      {options.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {removes.length > 0 && (
            <section>
              <h4 className="mb-2 text-[13px] font-bold text-ink-700">Retirer</h4>
              <div className="flex flex-wrap gap-2">
                {removes.map((o) => (
                  <OptionChip
                    key={o.id}
                    label={o.label}
                    active={!!picked[o.id]}
                    tone="coral"
                    onClick={() => toggle(o)}
                  />
                ))}
              </div>
            </section>
          )}

          {adds.length > 0 && (
            <section>
              <h4 className="mb-2 text-[13px] font-bold text-ink-700">Ajouter</h4>
              <div className="flex flex-wrap gap-2">
                {adds.map((o) => (
                  <OptionChip
                    key={o.id}
                    label={o.label}
                    price={o.extraPrice}
                    active={!!picked[o.id]}
                    tone="petrol"
                    onClick={() => toggle(o)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {withQuantity && (
        <div className="mt-5 flex items-center justify-between border-t border-ink-100 pt-4">
          <span className="text-[14px] font-semibold text-ink-700">Quantité</span>
          <div className="flex items-center gap-1 rounded-full border border-ink-200 p-1">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Retirer un"
              className="grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100"
            >
              <Minus size={16} strokeWidth={2.4} />
            </button>
            <span className="num w-8 text-center text-[17px] font-bold">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              aria-label="Ajouter un"
              className="grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100"
            >
              <Plus size={16} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      )}

      {chosen.length > 0 && (
        <p className="mt-4 rounded-[9px] bg-ink-50 px-3 py-2.5 text-[12.5px] leading-snug text-ink-600">
          Pour la cuisine : <KitchenPreview options={chosen} />
        </p>
      )}
    </Modal>
  )
}

function OptionChip({
  label,
  price,
  active,
  tone,
  onClick,
}: {
  label: string
  price?: number
  active: boolean
  tone: 'coral' | 'petrol'
  onClick: () => void
}) {
  const palette = active
    ? tone === 'coral'
      ? 'border-coral-500 bg-coral-50 text-coral-700'
      : 'border-petrol-600 bg-petrol-50 text-petrol-700'
    : 'border-ink-200 text-ink-700 hover:border-ink-300'

  return (
    <button
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-[9px] border px-3.5 text-[14px] font-semibold transition-colors ${palette}`}
    >
      {active && <Check size={14} strokeWidth={3} />}
      {tone === 'coral' ? `Sans ${label.toLowerCase()}` : label}
      {price ? <span className="num text-[12.5px] opacity-80">+{price}</span> : null}
    </button>
  )
}

/** Aperçu de ce que lira la cuisine, pour lever le doute avant validation. */
function KitchenPreview({ options }: { options: ProductOption[] }) {
  const removed = options.filter((o) => o.kind === 'remove')
  const added = options.filter((o) => o.kind === 'add')
  return (
    <>
      {removed.length > 0 && (
        <span className="font-semibold text-coral-700">
          sans {removed.map((o) => o.label.toLowerCase()).join(', ')}
        </span>
      )}
      {removed.length > 0 && added.length > 0 && ' · '}
      {added.length > 0 && (
        <span className="font-semibold text-petrol-700">
          extra {added.map((o) => o.label.toLowerCase()).join(', ')}
        </span>
      )}
    </>
  )
}

/** Résumé d'une ligne de panier, réutilisé partout où elle s'affiche. */
export function LineOptions({ options }: { options: ProductOption[] }) {
  if (options.length === 0) return null
  const removed = options.filter((o) => o.kind === 'remove')
  const added = options.filter((o) => o.kind === 'add')
  return (
    <span className="text-[12.5px]">
      {removed.length > 0 && (
        <span className="text-coral-600">
          sans {removed.map((o) => o.label.toLowerCase()).join(', ')}
        </span>
      )}
      {removed.length > 0 && added.length > 0 && <span className="text-ink-400"> · </span>}
      {added.length > 0 && (
        <span className="text-petrol-600">
          extra {added.map((o) => o.label.toLowerCase()).join(', ')}
        </span>
      )}
    </span>
  )
}
