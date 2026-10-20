import { useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { stock as stockApi } from '../../lib/api'
import { money } from '../../lib/format'
import type { CancelReason, Ingredient, InventoryLine } from '../../lib/types'
import { Button, Field, Input, Modal, useToast } from '../../components/ui'

/**
 * Inventaire physique.
 *
 * On compte réellement, et l'écart avec le stock théorique se voit. C'est
 * la seule façon de repérer la démarque : tant que personne ne compte, un
 * stock théorique parfait peut cacher n'importe quoi.
 */
export function InventoryModal({
  open,
  ingredients,
  onClose,
  onDone,
}: {
  open: boolean
  ingredients: Ingredient[]
  onClose: () => void
  onDone: () => void
}) {
  const [comptes, setComptes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [resultat, setResultat] = useState<{
    lines: InventoryLine[]
    value: number
    shortages: number
  } | null>(null)
  const { notify } = useToast()

  useEffect(() => {
    if (open) {
      setComptes({})
      setResultat(null)
    }
  }, [open])

  const saisies = Object.entries(comptes).filter(([, v]) => v.trim() !== '')

  async function valider() {
    if (saisies.length === 0) {
      notify('Comptez au moins une référence.', 'error')
      return
    }
    setBusy(true)
    try {
      setResultat(
        await stockApi.inventory(
          saisies.map(([ingredientId, v]) => ({
            ingredientId,
            counted: Number(v.replace(',', '.')) || 0,
          })),
        ),
      )
      onDone()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Inventaire refusé.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (resultat) {
    const ecarts = resultat.lines.filter((l) => Math.abs(l.gap) >= 0.001)
    return (
      <Modal
        open={open}
        onClose={onClose}
        width="max-w-lg"
        title="Inventaire terminé"
        footer={<Button onClick={onClose}>Fermer</Button>}
      >
        <div
          className={`mb-4 rounded-[11px] p-4 ${
            Math.abs(resultat.value) < 0.001
              ? 'bg-petrol-50'
              : resultat.value < 0
                ? 'bg-coral-50'
                : 'bg-sky-50'
          }`}
        >
          <p className="text-[13px] text-ink-600">
            {ecarts.length === 0
              ? 'Aucun écart : le stock théorique correspond au comptage.'
              : `${ecarts.length} écart${ecarts.length > 1 ? 's' : ''} constaté${
                  ecarts.length > 1 ? 's' : ''
                }, dont ${resultat.shortages} manquant${resultat.shortages > 1 ? 's' : ''}.`}
          </p>
          {Math.abs(resultat.value) >= 0.001 && (
            <p
              className={`num mt-1 text-[24px] font-bold ${
                resultat.value < 0 ? 'text-coral-700' : 'text-sky-700'
              }`}
            >
              {resultat.value > 0 ? '+' : ''}
              {money(resultat.value)} DT
            </p>
          )}
        </div>

        {ecarts.length > 0 && (
          <ul className="space-y-1.5">
            {ecarts.map((l) => (
              <li
                key={l.ingredientId}
                className="flex items-center justify-between gap-3 rounded-[8px] bg-ink-50 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-900">
                  {l.name}
                </span>
                <span className="num text-[12.5px] text-ink-500">
                  {l.expected.toFixed(2)} → {l.counted.toFixed(2)} {l.unit}
                </span>
                <span
                  className={`num shrink-0 text-[13px] font-bold ${
                    l.gap < 0 ? 'text-coral-600' : 'text-sky-700'
                  }`}
                >
                  {l.gap > 0 ? '+' : ''}
                  {l.gap.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[12.5px] leading-snug text-ink-500">
          Le stock a été corrigé et l'inventaire inscrit au journal.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-lg"
      title="Inventaire physique"
      description="Comptez ce que vous avez réellement. Laissez vide ce que vous ne comptez pas."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={valider} loading={busy} disabled={saisies.length === 0}>
            Valider {saisies.length > 0 && `(${saisies.length})`}
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        {ingredients.map((i) => {
          const saisi = comptes[i.id] ?? ''
          const compte = saisi.trim() === '' ? null : Number(saisi.replace(',', '.'))
          const ecart = compte === null || !Number.isFinite(compte)
            ? null
            : compte - i.quantityInStock
          return (
            <div key={i.id} className="flex items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink-900">{i.name}</p>
                <p className="num text-[12px] text-ink-500">
                  théorique {i.quantityInStock.toFixed(2)} {i.unit}
                </p>
              </div>
              <Input
                inputMode="decimal"
                value={saisi}
                onChange={(e) => setComptes((c) => ({ ...c, [i.id]: e.target.value }))}
                placeholder="—"
                aria-label={`Quantité comptée de ${i.name}`}
                className="num h-10 w-24 text-center"
              />
              <span
                className={`num w-16 shrink-0 text-right text-[12.5px] font-bold ${
                  ecart === null
                    ? 'text-transparent'
                    : Math.abs(ecart) < 0.001
                      ? 'text-petrol-600'
                      : ecart < 0
                        ? 'text-coral-600'
                        : 'text-sky-700'
                }`}
              >
                {ecart === null
                  ? '—'
                  : Math.abs(ecart) < 0.001
                    ? 'juste'
                    : `${ecart > 0 ? '+' : ''}${ecart.toFixed(2)}`}
              </span>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

/* ───────────────────────── Déclaration de perte ───────────────────────── */

/**
 * Un ingrédient sort du stock sans vente : cassé, brûlé, périmé, mangé par
 * le personnel. Sans ce geste, le gérant voit un stock qui fond sans
 * jamais savoir pourquoi.
 */
export function WasteModal({
  ingredient,
  onClose,
  onDone,
}: {
  ingredient: Ingredient | null
  onClose: () => void
  onDone: () => void
}) {
  const [motifs, setMotifs] = useState<CancelReason[]>([])
  const [quantite, setQuantite] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (!ingredient) return
    setQuantite('')
    stockApi.wasteReasons().then(setMotifs).catch(() => setMotifs([]))
  }, [ingredient])

  async function declarer(motif: CancelReason) {
    if (!ingredient) return
    const q = Number(quantite.replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0) {
      notify('Indiquez la quantité perdue.', 'error')
      return
    }
    setBusy(true)
    try {
      await stockApi.declareWaste(ingredient.id, q, motif.code)
      notify(`Perte déclarée — ${motif.label.toLowerCase()}.`, 'success')
      onDone()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Déclaration refusée.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const q = Number(quantite.replace(',', '.'))
  const valeur = Number.isFinite(q) && ingredient ? q * ingredient.costPerUnit : 0

  return (
    <Modal
      open={ingredient !== null}
      onClose={onClose}
      title={ingredient ? `Perte sur ${ingredient.name}` : ''}
      description="Ce qui sort du stock sans avoir été vendu. Inscrit au journal."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Annuler
        </Button>
      }
    >
      <div className="space-y-4">
        <Field
          label={`Quantité perdue (${ingredient?.unit ?? ''})`}
          hint={
            valeur > 0
              ? `Soit ${money(valeur)} DT de matière`
              : `Stock actuel : ${ingredient?.quantityInStock.toFixed(2) ?? '0'}`
          }
        >
          <Input
            autoFocus
            inputMode="decimal"
            value={quantite}
            onChange={(e) => setQuantite(e.target.value)}
            placeholder="0"
            className="num h-12 text-[18px] font-bold"
          />
        </Field>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-700">
            <ClipboardCheck size={14} className="text-ink-400" />
            Motif
          </p>
          <div className="space-y-2">
            {motifs.map((m) => (
              <button
                key={m.code}
                disabled={busy || !(q > 0)}
                onClick={() => declarer(m)}
                className="flex h-11 w-full items-center rounded-[9px] border border-ink-200 px-4 text-left text-[14px] font-semibold text-ink-900 transition-colors hover:border-coral-500 hover:bg-coral-50 disabled:opacity-40"
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
