import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Package, Plus } from 'lucide-react'
import { stock } from '../../lib/api'
import { money } from '../../lib/format'
import type { Ingredient } from '../../lib/types'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  useToast,
} from '../../components/ui'

const UNITS = [
  { value: 'piece', label: 'pièce' },
  { value: 'kg', label: 'kilogramme' },
  { value: 'g', label: 'gramme' },
  { value: 'l', label: 'litre' },
  { value: 'ml', label: 'millilitre' },
]

export default function StockPage() {
  const [items, setItems] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [restocking, setRestocking] = useState<Ingredient | null>(null)
  const [creating, setCreating] = useState(false)
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      setItems(await stock.list())
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Stock illisible.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const low = items.filter((i) => i.isLow)

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-[13.5px] text-ink-500">
          {items.length} référence{items.length > 1 ? 's' : ''} suivies
        </p>
        <Button icon={Plus} onClick={() => setCreating(true)}>
          Nouvel ingrédient
        </Button>
      </div>

      {low.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-[13px] border border-saffron-500/35 bg-saffron-50 px-4 py-3.5">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-saffron-600"
            strokeWidth={2.2}
          />
          <p className="text-[13.5px] leading-snug text-saffron-700">
            <span className="font-bold">À réapprovisionner :</span>{' '}
            {low.map((i) => i.name).join(', ')}
          </p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[72px]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Package}
            title="Aucun ingrédient"
            description="Ajoutez vos matières premières pour que le stock se déduise à chaque vente."
            action={
              <Button icon={Plus} onClick={() => setCreating(true)}>
                Nouvel ingrédient
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100">
          {items.map((it) => (
            <StockRow key={it.id} item={it} onRestock={() => setRestocking(it)} />
          ))}
        </Card>
      )}

      <RestockModal
        item={restocking}
        onClose={() => setRestocking(null)}
        onDone={() => {
          setRestocking(null)
          load()
        }}
      />
      <CreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false)
          load()
        }}
      />
    </div>
  )
}

function StockRow({ item, onRestock }: { item: Ingredient; onRestock: () => void }) {
  // Jauge relative au seuil : à 100 % on est pile au seuil d'alerte.
  const ratio =
    item.alertThreshold > 0
      ? Math.min(item.quantityInStock / (item.alertThreshold * 3), 1)
      : 1

  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14.5px] font-semibold text-ink-900">{item.name}</p>
          {item.isLow && (
            <span className="shrink-0 rounded-full bg-saffron-100 px-2 py-0.5 text-[11px] font-bold text-saffron-700">
              Stock bas
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2.5">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-ink-100">
            <div
              className={`h-full rounded-full ${
                item.isLow ? 'bg-saffron-500' : 'bg-petrol-500'
              }`}
              style={{ width: `${Math.max(ratio * 100, 4)}%` }}
            />
          </div>
          <span className="num text-[12.5px] text-ink-500">
            {item.quantityInStock.toFixed(2)} {item.unit} · seuil{' '}
            {item.alertThreshold.toFixed(0)}
          </span>
        </div>
      </div>

      <span className="num hidden shrink-0 text-[13px] text-ink-500 sm:block">
        {money(item.costPerUnit)} DT/{item.unit}
      </span>

      <Button variant="secondary" size="sm" onClick={onRestock}>
        Réappro
      </Button>
    </div>
  )
}

function RestockModal({
  item,
  onClose,
  onDone,
}: {
  item: Ingredient | null
  onClose: () => void
  onDone: () => void
}) {
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (item) setQty('')
  }, [item])

  async function submit() {
    if (!item) return
    const value = Number(qty.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) {
      notify('Entrez une quantité positive.', 'error')
      return
    }
    setBusy(true)
    try {
      await stock.restock(item.id, value, 'Réapprovisionnement')
      notify(`${item.name} réapprovisionné.`, 'success')
      onDone()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Réappro refusée.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title={item ? `Réapprovisionner ${item.name}` : ''}
      description={
        item
          ? `Stock actuel : ${item.quantityInStock.toFixed(2)} ${item.unit}`
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy}>
            Ajouter au stock
          </Button>
        </>
      }
    >
      <Field label={`Quantité reçue (${item?.unit ?? ''})`}>
        <Input
          autoFocus
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="0"
          className="num h-13 text-[20px] font-bold"
        />
      </Field>
    </Modal>
  )
}

function CreateModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('piece')
  const [qty, setQty] = useState('')
  const [threshold, setThreshold] = useState('')
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (open) {
      setName('')
      setUnit('piece')
      setQty('')
      setThreshold('')
      setCost('')
    }
  }, [open])

  async function submit() {
    if (name.trim().length < 2) {
      notify("Donnez un nom à l'ingrédient.", 'error')
      return
    }
    setBusy(true)
    try {
      await stock.create({
        name: name.trim(),
        unit,
        quantityInStock: Number(qty.replace(',', '.')) || 0,
        alertThreshold: Number(threshold.replace(',', '.')) || 0,
        costPerUnit: Number(cost.replace(',', '.')) || 0,
      })
      notify('Ingrédient ajouté.', 'success')
      onDone()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Création refusée.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvel ingrédient"
      description="Le coût d'achat sert au calcul du bénéfice net."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy}>
            Ajouter
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Nom">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Unité">
          <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantité initiale">
            <Input
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              className="num"
            />
          </Field>
          <Field label="Seuil d'alerte" hint="Alerte en dessous">
            <Input
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="0"
              className="num"
            />
          </Field>
        </div>
        <Field label="Coût d'achat par unité" hint="En dinars">
          <Input
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0,00"
            className="num"
          />
        </Field>
      </div>
    </Modal>
  )
}
