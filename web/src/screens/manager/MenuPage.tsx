import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Ban,
  ChevronDown,
  ChevronUp,
  ImageOff,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { catalog, stock, type ProductInput } from '../../lib/api'
import { money } from '../../lib/format'
import { ImageError, photoWeight, preparePhoto } from '../../lib/image'
import type { Category, Ingredient, Product, ProductOption, RecipeLine } from '../../lib/types'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionTitle,
  Select,
  Skeleton,
  useToast,
} from '../../components/ui'

/* ───────────────────────── Écran ───────────────────────── */

export default function MenuPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [editingCategories, setEditingCategories] = useState(false)
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      const [p, c, i] = await Promise.all([
        catalog.all(),
        catalog.categories(),
        stock.list(),
      ])
      setProducts(p)
      setCategories(c)
      setIngredients(i)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Carte illisible.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const live = products.filter((p) => !p.isArchived)
  const archived = products.filter((p) => p.isArchived)

  /** Déplace un plat dans sa catégorie et enregistre le nouvel ordre. */
  async function move(product: Product, direction: -1 | 1) {
    const siblings = live
      .filter((p) => p.categoryId === product.categoryId)
      .sort(byOrder)
    const from = siblings.findIndex((p) => p.id === product.id)
    const to = from + direction
    if (to < 0 || to >= siblings.length) return

    const reordered = [...siblings]
    ;[reordered[from], reordered[to]] = [reordered[to], reordered[from]]

    // Affichage immédiat : attendre le serveur donnerait un écran qui traîne.
    setProducts((all) =>
      all.map((p) => {
        const index = reordered.findIndex((r) => r.id === p.id)
        return index === -1 ? p : { ...p, displayOrder: index }
      }),
    )
    try {
      await catalog.reorderProducts(reordered.map((p) => p.id))
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Ordre non enregistré.', 'error')
      load()
    }
  }

  async function toggleAvailable(product: Product) {
    setProducts((all) =>
      all.map((p) => (p.id === product.id ? { ...p, isAvailable: !p.isAvailable } : p)),
    )
    try {
      await catalog.toggleAvailable(product.id)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Changement refusé.', 'error')
      load()
    }
  }

  async function restore(product: Product) {
    try {
      await catalog.restoreProduct(product.id)
      notify(`${product.name} remis à la carte.`, 'success')
      load()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Restauration refusée.', 'error')
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-4 py-6 sm:px-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[76px]" />
        ))}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-ink-500">
          {live.length} plat{live.length > 1 ? 's' : ''} à la carte
          {categories.length > 0 && ` · ${categories.length} catégorie${categories.length > 1 ? 's' : ''}`}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Layers} onClick={() => setEditingCategories(true)}>
            Catégories
          </Button>
          <Button
            icon={Plus}
            disabled={categories.length === 0}
            onClick={() => setEditing('new')}
          >
            Nouveau plat
          </Button>
        </div>
      </div>

      {categories.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="Commencez par une catégorie"
            description="Entrées, plats, boissons… Les plats se rangent ensuite dedans, dans l'ordre que vous choisissez."
            action={
              <Button icon={Plus} onClick={() => setEditingCategories(true)}>
                Créer une catégorie
              </Button>
            }
          />
        </Card>
      ) : live.length === 0 ? (
        <Card>
          <EmptyState
            icon={UtensilsCrossed}
            title="Aucun plat"
            description="Ajoutez votre premier plat : il apparaîtra aussitôt sur la borne, à la caisse et sur le site."
            action={
              <Button icon={Plus} onClick={() => setEditing('new')}>
                Nouveau plat
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {categories.map((category) => {
            const inCategory = live.filter((p) => p.categoryId === category.id).sort(byOrder)
            if (inCategory.length === 0) return null
            return (
              <div key={category.id}>
                <SectionTitle>{category.name}</SectionTitle>
                <Card className="divide-y divide-ink-100">
                  {inCategory.map((product, index) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      isFirst={index === 0}
                      isLast={index === inCategory.length - 1}
                      onEdit={() => setEditing(product)}
                      onMove={(d) => move(product, d)}
                      onToggle={() => toggleAvailable(product)}
                    />
                  ))}
                </Card>
              </div>
            )
          })}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-7">
          <SectionTitle>Retirés de la carte</SectionTitle>
          <Card className="divide-y divide-ink-100">
            {archived.map((product) => (
              <div key={product.id} className="flex items-center gap-3 px-4 py-3">
                <Thumb product={product} muted />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink-500">
                    {product.name}
                  </p>
                  <p className="num text-[12.5px] text-ink-400">{money(product.price)} DT</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => restore(product)}
                >
                  Remettre
                </Button>
              </div>
            ))}
          </Card>
          <p className="mt-2 px-1 text-[12.5px] leading-snug text-ink-500">
            Ces plats ont déjà été vendus : ils sont conservés pour que les tickets et
            les statistiques passés restent justes, mais ils n'apparaissent plus nulle part.
          </p>
        </div>
      )}

      <ProductEditor
        target={editing}
        categories={categories}
        ingredients={ingredients}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
      <CategoryEditor
        open={editingCategories}
        categories={categories}
        products={products}
        onClose={() => setEditingCategories(false)}
        onChanged={load}
      />
    </div>
  )
}

const byOrder = (a: Product, b: Product) =>
  (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name)

/* ───────────────────────── Ligne de plat ───────────────────────── */

function Thumb({ product, muted = false }: { product: Product; muted?: boolean }) {
  if (product.imageUrl) {
    return (
      <img
        src={product.imageUrl}
        alt=""
        className={`size-11 shrink-0 rounded-[9px] object-cover ${muted ? 'opacity-45' : ''}`}
      />
    )
  }
  return (
    <div className="grid size-11 shrink-0 place-items-center rounded-[9px] bg-ink-100 text-ink-400">
      <ImageOff size={16} />
    </div>
  )
}

function ProductRow({
  product,
  isFirst,
  isLast,
  onEdit,
  onMove,
  onToggle,
}: {
  product: Product
  isFirst: boolean
  isLast: boolean
  onEdit: () => void
  onMove: (direction: -1 | 1) => void
  onToggle: () => void
}) {
  const options = product.options ?? []
  const recipe = product.recipe ?? []

  return (
    <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
      {/* Flèches d'ordre : c'est l'ordre vu par le client sur la borne. */}
      <div className="hidden flex-col sm:flex">
        <ArrowButton direction="up" disabled={isFirst} onClick={() => onMove(-1)} />
        <ArrowButton direction="down" disabled={isLast} onClick={() => onMove(1)} />
      </div>

      <button onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Thumb product={product} muted={!product.isAvailable} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14.5px] font-semibold text-ink-900">{product.name}</p>
            {!product.isAvailable && <Chip tone="saffron">Épuisé</Chip>}
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-500">
            <span className="num font-semibold text-ink-700">{money(product.price)} DT</span>
            {options.length > 0 && ` · ${options.length} choix`}
            {recipe.length > 0
              ? ` · recette ${recipe.length} ingrédient${recipe.length > 1 ? 's' : ''}`
              : ' · sans recette'}
          </p>
        </div>
      </button>

      {/* Un verbe, jamais un état : « Épuisé » seul laisserait croire que
          le plat l'est déjà. L'état se lit sur la pastille et la vignette. */}
      <button
        onClick={onToggle}
        className={`hidden h-9 shrink-0 rounded-[9px] px-3 text-[12.5px] font-bold transition-colors sm:block ${
          product.isAvailable
            ? 'bg-ink-100 text-ink-600 hover:bg-saffron-100 hover:text-saffron-700'
            : 'bg-saffron-500 text-ink-900 hover:bg-saffron-400'
        }`}
      >
        {product.isAvailable ? 'Marquer épuisé' : 'Remettre'}
      </button>

      <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit} aria-label="Modifier" />
    </div>
  )
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'up' | 'down'
  disabled: boolean
  onClick: () => void
}) {
  const Icon = direction === 'up' ? ChevronUp : ChevronDown
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'up' ? 'Monter' : 'Descendre'}
      className="grid size-6 place-items-center rounded-[5px] text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 disabled:opacity-25 disabled:hover:bg-transparent"
    >
      <Icon size={15} strokeWidth={2.4} />
    </button>
  )
}

/* ───────────────────────── Éditeur de plat ───────────────────────── */

/** Choix en cours d'édition : un identifiant temporaire tant qu'il n'existe pas en base. */
interface DraftOption {
  id: string
  isNew: boolean
  kind: 'remove' | 'add'
  label: string
  extraPrice: number
  ingredientId: string | null
  quantityDelta: number
}

let tempSeq = 0
const nextTempId = () => `tmp-${++tempSeq}`

function toDraft(option: ProductOption): DraftOption {
  return {
    id: option.id,
    isNew: false,
    kind: option.kind,
    label: option.label,
    extraPrice: option.extraPrice,
    ingredientId: option.ingredientId ?? null,
    quantityDelta: option.quantityDelta ?? 0,
  }
}

function ProductEditor({
  target,
  categories,
  ingredients,
  onClose,
  onSaved,
}: {
  target: Product | 'new' | null
  categories: Category[]
  ingredients: Ingredient[]
  onClose: () => void
  onSaved: () => void
}) {
  const product = target === 'new' || target === null ? null : target
  const open = target !== null

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [prepMinutes, setPrepMinutes] = useState('')
  const [options, setOptions] = useState<DraftOption[]>([])
  const [recipe, setRecipe] = useState<RecipeLine[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const original = useRef<DraftOption[]>([])
  const { notify } = useToast()

  useEffect(() => {
    if (!open) return
    setName(product?.name ?? '')
    setPrice(product ? String(product.price) : '')
    setDescription(product?.description ?? '')
    setCategoryId(product?.categoryId ?? categories[0]?.id ?? '')
    setPhoto(product?.imageUrl ?? null)
    setPrepMinutes(product?.prepMinutes ? String(product.prepMinutes) : '')
    const drafts = (product?.options ?? []).map(toDraft)
    setOptions(drafts)
    original.current = drafts
    setRecipe(product?.recipe ?? [])
    setConfirmRemove(false)
  }, [open, product, categories])

  async function save() {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      notify('Donnez un nom au plat.', 'error')
      return
    }
    const value = Number(price.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) {
      notify('Prix invalide.', 'error')
      return
    }
    if (!categoryId) {
      notify('Choisissez une catégorie.', 'error')
      return
    }

    const payload: ProductInput = {
      name: trimmed,
      price: value,
      categoryId,
      description: description.trim() || null,
      imageUrl: photo,
      prepMinutes: Number(prepMinutes) || 0,
      recipe: recipe.filter((r) => r.ingredientId && r.quantityNeeded > 0),
    }

    setBusy(true)
    try {
      if (!product) {
        await catalog.createProduct({
          ...payload,
          options: options.map((o) => ({
            kind: o.kind,
            label: o.label,
            extraPrice: o.extraPrice,
            ingredientId: o.ingredientId,
            quantityDelta: o.quantityDelta,
          })),
        })
        notify(`${trimmed} ajouté à la carte.`, 'success')
      } else {
        await catalog.updateProduct(product.id, payload)
        await syncOptions(product.id)
        notify('Plat enregistré.', 'success')
      }
      onSaved()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Enregistrement refusé.', 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Rien ne bouge en base avant « Enregistrer » : on compare l'état d'arrivée
   * à l'état de départ et on n'envoie que les différences.
   */
  async function syncOptions(productId: string) {
    const kept = new Set(options.filter((o) => !o.isNew).map((o) => o.id))
    for (const before of original.current) {
      if (!kept.has(before.id)) await catalog.deleteOption(before.id)
    }
    for (const [index, draft] of options.entries()) {
      if (draft.isNew) {
        await catalog.addOption(productId, {
          kind: draft.kind,
          label: draft.label,
          extraPrice: draft.extraPrice,
          ingredientId: draft.ingredientId,
          quantityDelta: draft.quantityDelta,
          displayOrder: index,
        })
        continue
      }
      const before = original.current.find((o) => o.id === draft.id)
      const changed =
        !before ||
        before.label !== draft.label ||
        before.extraPrice !== draft.extraPrice ||
        before.ingredientId !== draft.ingredientId ||
        before.quantityDelta !== draft.quantityDelta
      if (changed) {
        await catalog.updateOption(draft.id, {
          label: draft.label,
          extraPrice: draft.extraPrice,
          ingredientId: draft.ingredientId,
          quantityDelta: draft.quantityDelta,
          displayOrder: index,
        })
      }
    }
  }

  async function remove() {
    if (!product) return
    setBusy(true)
    try {
      const result = await catalog.removeProduct(product.id)
      notify(
        result.deleted
          ? `${product.name} supprimé.`
          : `${product.name} retiré de la carte (conservé pour l'historique).`,
        'success',
      )
      onSaved()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Retrait refusé.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={product ? product.name : 'Nouveau plat'}
      description="Tout ce qui est renseigné ici est ce que la caisse et la borne pourront toucher — sans rien écrire."
      footer={
        <>
          {product && (
            <div className="mr-auto">
              {confirmRemove ? (
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-coral-700">Retirer ?</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                    Non
                  </Button>
                  <Button variant="danger" size="sm" onClick={remove} loading={busy}>
                    Oui, retirer
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => setConfirmRemove(true)}
                >
                  Retirer de la carte
                </Button>
              )}
            </div>
          )}
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* ─── Identité du plat ─── */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <PhotoPicker value={photo} onChange={setPhoto} />
          <div className="min-w-0 flex-1 space-y-3.5">
            <Field label="Nom">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sandwich thon"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prix" hint="En dinars">
                <Input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0,000"
                  className="num"
                />
              </Field>
              <Field label="Catégorie">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Temps de préparation"
              hint="En minutes. Donne son minuteur à la cuisine ; 0 = pas de minuteur"
            >
              <Input
                inputMode="numeric"
                value={prepMinutes}
                onChange={(e) => setPrepMinutes(e.target.value)}
                placeholder="0"
                className="num w-24"
              />
            </Field>
            <Field label="Description" hint="Affichée sur la borne et le site">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Thon, œuf, harissa, olives"
              />
            </Field>
          </div>
        </div>

        {/* ─── Choix prédéfinis ─── */}
        <div>
          <div className="mb-2.5 border-t border-ink-100 pt-4">
            <h4 className="text-[14px] font-bold text-ink-900">Choix prédéfinis</h4>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">
              Ce que le client peut retirer ou ajouter. La caisse ne fait que toucher ces
              boutons, jamais écrire — la cuisine lit donc toujours le même vocabulaire.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionColumn
              kind="remove"
              drafts={options}
              ingredients={ingredients}
              onChange={setOptions}
            />
            <OptionColumn
              kind="add"
              drafts={options}
              ingredients={ingredients}
              onChange={setOptions}
            />
          </div>
        </div>

        {/* ─── Recette ─── */}
        <div>
          <div className="mb-2.5 border-t border-ink-100 pt-4">
            <h4 className="text-[14px] font-bold text-ink-900">Recette</h4>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">
              Ce qu'une unité consomme. C'est ce qui fait baisser le stock à chaque vente et
              qui donne le coût réel du plat dans le bénéfice net. Sans recette, ce plat ne
              bouge aucun stock.
            </p>
          </div>
          <RecipeEditor lines={recipe} ingredients={ingredients} onChange={setRecipe} />
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────────────── Photo ───────────────────────── */

function PhotoPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (value: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { notify } = useToast()

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      onChange(await preparePhoto(file))
    } catch (e) {
      notify(
        e instanceof ImageError ? e.message : 'Photo illisible.',
        'error',
      )
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group relative grid size-[120px] place-items-center overflow-hidden rounded-[11px] border border-dashed border-ink-300 bg-ink-50 text-ink-400 transition-colors hover:border-petrol-500 hover:text-petrol-600 disabled:opacity-60"
      >
        {value ? (
          <>
            <img src={value} alt="" className="absolute inset-0 size-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-ink-950/60 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
              Changer
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1.5 px-2 text-center">
            <ImageOff size={20} />
            <span className="text-[12px] font-semibold leading-tight">
              {busy ? 'Préparation…' : 'Ajouter une photo'}
            </span>
          </span>
        )}
      </button>
      {value && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="num text-[11.5px] text-ink-500">{photoWeight(value)}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11.5px] font-semibold text-coral-600 hover:underline"
          >
            Retirer
          </button>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── Colonne de choix ───────────────────────── */

function OptionColumn({
  kind,
  drafts,
  ingredients,
  onChange,
}: {
  kind: 'remove' | 'add'
  drafts: DraftOption[]
  ingredients: Ingredient[]
  onChange: (next: DraftOption[]) => void
}) {
  const [label, setLabel] = useState('')
  const [extra, setExtra] = useState('')
  const [ingredientId, setIngredientId] = useState('')
  const [delta, setDelta] = useState('')
  const { notify } = useToast()

  const mine = drafts.filter((d) => d.kind === kind)
  const isRemove = kind === 'remove'

  function add() {
    const trimmed = label.trim()
    if (trimmed.length < 2) {
      notify('Donnez un intitulé au choix.', 'error')
      return
    }
    onChange([
      ...drafts,
      {
        id: nextTempId(),
        isNew: true,
        kind,
        label: trimmed,
        extraPrice: isRemove ? 0 : Number(extra.replace(',', '.')) || 0,
        ingredientId: ingredientId || null,
        quantityDelta: Number(delta.replace(',', '.')) || 0,
      },
    ])
    setLabel('')
    setExtra('')
    setIngredientId('')
    setDelta('')
  }

  const unit = ingredients.find((i) => i.id === ingredientId)?.unit

  return (
    <div className="rounded-[11px] border border-ink-200 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        {isRemove ? (
          <Ban size={14} className="text-coral-500" strokeWidth={2.6} />
        ) : (
          <Plus size={14} className="text-saffron-600" strokeWidth={2.8} />
        )}
        <h5 className="text-[13px] font-bold text-ink-900">
          {isRemove ? 'Retraits' : 'Ajouts'}
        </h5>
        <span className="text-[11.5px] text-ink-500">
          {isRemove ? 'toujours gratuits' : 'gratuits ou payants'}
        </span>
      </div>

      {mine.length === 0 ? (
        <p className="py-2 text-[12.5px] text-ink-400">
          {isRemove ? 'Aucun retrait proposé.' : 'Aucun ajout proposé.'}
        </p>
      ) : (
        <ul className="mb-2.5 space-y-1.5">
          {mine.map((draft) => (
            <li
              key={draft.id}
              className="flex items-center gap-2 rounded-[7px] bg-ink-50 py-1.5 pl-2.5 pr-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-800">
                {isRemove ? 'Sans ' : 'Extra '}
                {draft.label}
              </span>
              {draft.extraPrice > 0 && (
                <span className="num shrink-0 text-[12.5px] font-bold text-saffron-700">
                  +{money(draft.extraPrice)}
                </span>
              )}
              {draft.ingredientId && (
                <span
                  title="Mouvement de stock associé"
                  className="num shrink-0 text-[11px] text-ink-500"
                >
                  {isRemove ? '−' : '+'}
                  {draft.quantityDelta}
                </span>
              )}
              <button
                type="button"
                aria-label="Supprimer ce choix"
                onClick={() => onChange(drafts.filter((d) => d.id !== draft.id))}
                className="grid size-6 shrink-0 place-items-center rounded-[5px] text-ink-400 transition-colors hover:bg-coral-100 hover:text-coral-700"
              >
                <X size={13} strokeWidth={2.6} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-ink-100 pt-2.5">
        <div className="flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            placeholder={isRemove ? 'Oignon' : 'Fromage'}
            className="h-10 text-[13px]"
          />
          {!isRemove && (
            <Input
              inputMode="decimal"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="0,000"
              aria-label="Supplément en dinars"
              className="num h-10 w-24 text-[13px]"
            />
          )}
        </div>

        {/* Lier un ingrédient garde le stock et le bénéfice net justes. */}
        <div className="flex gap-2">
          <Select
            value={ingredientId}
            onChange={(e) => setIngredientId(e.target.value)}
            aria-label="Ingrédient concerné"
            className="h-10 text-[13px]"
          >
            <option value="">Sans effet sur le stock</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
          {ingredientId && (
            <Input
              inputMode="decimal"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder={unit ?? '0'}
              aria-label="Quantité"
              className="num h-10 w-24 text-[13px]"
            />
          )}
        </div>

        <Button variant="secondary" size="sm" icon={Plus} onClick={add} className="w-full">
          Ajouter {isRemove ? 'un retrait' : 'un ajout'}
        </Button>
      </div>
    </div>
  )
}

/* ───────────────────────── Recette ───────────────────────── */

function RecipeEditor({
  lines,
  ingredients,
  onChange,
}: {
  lines: RecipeLine[]
  ingredients: Ingredient[]
  onChange: (next: RecipeLine[]) => void
}) {
  const used = new Set(lines.map((l) => l.ingredientId))
  const available = ingredients.filter((i) => !used.has(i.id))

  const cost = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const ingredient = ingredients.find((i) => i.id === line.ingredientId)
        return sum + (ingredient ? ingredient.costPerUnit * line.quantityNeeded : 0)
      }, 0),
    [lines, ingredients],
  )

  if (ingredients.length === 0) {
    return (
      <p className="rounded-[9px] bg-ink-100 px-3.5 py-3 text-[12.5px] leading-snug text-ink-600">
        Aucun ingrédient en stock pour l'instant. Ajoutez vos matières premières dans
        Stock, puis revenez composer la recette.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {lines.map((line, index) => {
        const ingredient = ingredients.find((i) => i.id === line.ingredientId)
        return (
          <div key={`${line.ingredientId}-${index}`} className="flex items-center gap-2">
            <Select
              value={line.ingredientId}
              aria-label="Ingrédient"
              onChange={(e) =>
                onChange(
                  lines.map((l, i) =>
                    i === index ? { ...l, ingredientId: e.target.value } : l,
                  ),
                )
              }
              className="h-10 text-[13px]"
            >
              {ingredient && <option value={ingredient.id}>{ingredient.name}</option>}
              {available.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
            <Input
              inputMode="decimal"
              value={String(line.quantityNeeded)}
              aria-label="Quantité nécessaire"
              onChange={(e) =>
                onChange(
                  lines.map((l, i) =>
                    i === index
                      ? { ...l, quantityNeeded: Number(e.target.value.replace(',', '.')) || 0 }
                      : l,
                  ),
                )
              }
              className="num h-10 w-24 text-[13px]"
            />
            <span className="w-10 shrink-0 text-[12.5px] text-ink-500">
              {ingredient?.unit ?? ''}
            </span>
            <button
              type="button"
              aria-label="Retirer cet ingrédient"
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
              className="grid size-8 shrink-0 place-items-center rounded-[7px] text-ink-400 transition-colors hover:bg-coral-100 hover:text-coral-700"
            >
              <X size={15} strokeWidth={2.4} />
            </button>
          </div>
        )
      })}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          disabled={available.length === 0}
          onClick={() =>
            onChange([...lines, { ingredientId: available[0].id, quantityNeeded: 0 }])
          }
        >
          Ajouter un ingrédient
        </Button>
        {lines.length > 0 && (
          <span className="num text-[12.5px] text-ink-500">
            Coût matière : {money(cost)} DT
          </span>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────── Catégories ───────────────────────── */

function CategoryEditor({
  open,
  categories,
  products,
  onClose,
  onChanged,
}: {
  open: boolean
  categories: Category[]
  products: Product[]
  onClose: () => void
  onChanged: () => void
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const { notify } = useToast()

  useEffect(() => {
    if (open) {
      setDraft('')
      setRenaming(null)
    }
  }, [open])

  const countIn = (categoryId: string) =>
    products.filter((p) => p.categoryId === categoryId && !p.isArchived).length

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      notify(success, 'success')
      onChanged()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Action refusée.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reorder(index: number, direction: -1 | 1) {
    const to = index + direction
    if (to < 0 || to >= categories.length) return
    const ids = categories.map((c) => c.id)
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    await run(() => catalog.reorderCategories(ids), 'Ordre enregistré.')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catégories"
      description="Elles donnent les onglets de la borne et du site, dans cet ordre."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      }
    >
      <div className="space-y-2">
        {categories.length === 0 && (
          <p className="py-1 text-[13px] text-ink-500">Aucune catégorie pour l'instant.</p>
        )}

        {categories.map((category, index) => (
          <div key={category.id} className="flex items-center gap-2">
            <div className="flex flex-col">
              <ArrowButton
                direction="up"
                disabled={index === 0 || busy}
                onClick={() => reorder(index, -1)}
              />
              <ArrowButton
                direction="down"
                disabled={index === categories.length - 1 || busy}
                onClick={() => reorder(index, 1)}
              />
            </div>

            {renaming === category.id ? (
              <>
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      run(
                        () => catalog.renameCategory(category.id, renameValue),
                        'Catégorie renommée.',
                      ).then(() => setRenaming(null))
                    }
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="h-10 flex-1 text-[13.5px]"
                />
                <Button
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    run(
                      () => catalog.renameCategory(category.id, renameValue),
                      'Catégorie renommée.',
                    ).then(() => setRenaming(null))
                  }
                >
                  Valider
                </Button>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-ink-900">
                    {category.name}
                  </p>
                  <p className="text-[12px] text-ink-500">
                    {countIn(category.id)} plat{countIn(category.id) > 1 ? 's' : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Pencil}
                  aria-label="Renommer"
                  onClick={() => {
                    setRenaming(category.id)
                    setRenameValue(category.name)
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  aria-label="Supprimer"
                  disabled={busy}
                  onClick={() =>
                    run(() => catalog.deleteCategory(category.id), 'Catégorie supprimée.')
                  }
                />
              </>
            )}
          </div>
        ))}

        <div className="flex gap-2 border-t border-ink-100 pt-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim().length >= 2) {
                run(() => catalog.createCategory(draft.trim()), 'Catégorie créée.').then(() =>
                  setDraft(''),
                )
              }
            }}
            placeholder="Sandwichs"
            className="h-10 text-[13.5px]"
          />
          <Button
            icon={Plus}
            loading={busy}
            disabled={draft.trim().length < 2}
            onClick={() =>
              run(() => catalog.createCategory(draft.trim()), 'Catégorie créée.').then(() =>
                setDraft(''),
              )
            }
          >
            Créer
          </Button>
        </div>
      </div>
    </Modal>
  )
}
