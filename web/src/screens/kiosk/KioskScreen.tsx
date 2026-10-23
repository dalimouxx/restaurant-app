import { useCallback, useEffect, useMemo, useState } from 'react'
import { Minus, Plus, Trash2, UtensilsCrossed } from 'lucide-react'
import { catalog, orders } from '../../lib/api'
import { on } from '../../lib/socket'
import { lineUnitPrice, useKioskCart } from '../../lib/store'
import { moneyDT, orderNo } from '../../lib/format'
import type { Category, Product } from '../../lib/types'
import { Button, EmptyState, Skeleton, useToast } from '../../components/ui'
import { Wordmark } from '../../components/Shell'
import { Emoji, emojiPlat, emojiPour } from '../../components/Emoji'
import { useReglages } from '../../lib/reglages'
import { LineOptions, OptionPicker } from '../../components/OptionPicker'
import { SelecteurLangue } from '../../components/SelecteurLangue'
import { useT, nomTraduit } from '../../lib/traductions'
import { useLangue } from '../../lib/langue'

type Stage = 'ordering' | 'done'

export default function KioskScreen() {
  const t = useT()
  const lang = useLangue()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState<Stage>('ordering')
  const [placedNumber, setPlacedNumber] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'dine_in' | 'pickup'>('dine_in')
  const [picking, setPicking] = useState<Product | null>(null)

  const cart = useKioskCart()
  const { reglages } = useReglages()
  const versCaisse = (reglages?.commandesEnLigne ?? 'caisse') === 'caisse'
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      const { categories: cats, products: prods } = await catalog.menu()
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
    return (
      <KioskDone
        number={placedNumber}
        versCaisse={versCaisse}
        onRestart={() => setStage('ordering')}
      />
    )
  }

  return (
    <div className="flex h-dvh flex-col bg-ink-50 lg:flex-row">
      {/* Menu */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 px-6 pt-6 pb-4 sm:px-10 sm:pt-10">
          <div className="flex items-center justify-between gap-4">
            <Wordmark dark={false} />
            {/* Grand, parce qu'on le touche debout, a bout de bras, et
                qu'il doit se voir sans etre cherche : c'est la premiere
                chose que fait quelqu'un qui ne lit pas le francais. */}
            <SelecteurLangue taille="grande" />
          </div>
          <h1 className="anim-monte mt-5 flex flex-wrap items-center gap-3 text-[30px] leading-[1.15] font-extrabold tracking-[-0.025em] text-ink-900 sm:text-[38px]">
            {t('borne.titre')}
            <Emoji vie="rebondit" className="text-[34px] sm:text-[42px]">🍔</Emoji>
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-500">
            {t('borne.consigne')}{' '}
            {versCaisse ? t('borne.paieCaisse') : t('borne.paieRemise')}
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
                    className={`reagit flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-[15px] font-bold transition-colors ${
                      c.id === activeCat
                        ? 'bg-ink-900 text-white'
                        : 'border border-ink-200 bg-white text-ink-700 hover:border-ink-300'
                    }`}
                  >
                    <Emoji
                      vie={c.id === activeCat ? 'fretille' : 'immobile'}
                      className="text-[19px]"
                    >
                      {emojiPour(c.name)}
                    </Emoji>
                    {nomTraduit(c, lang)}
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
              title={t('carte.rienIci')}
              description="Choisissez une autre catégorie ci-dessus."
            />
          ) : (
            <div
              key={activeCat ?? 'tout'}
              className="anim-cascade grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4"
            >
              {visible.map((p) => (
                <ProductTile
                  key={p.id}
                  categorie={categories.find((c) => c.id === p.categoryId)?.name}
                  product={p}
                  onAdd={() => {
                    // Un plat sans variante part directement au panier.
                    if ((p.options?.length ?? 0) === 0) cart.add(p)
                    else setPicking(p)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panier */}
      <aside className="flex max-h-[52dvh] shrink-0 flex-col border-t border-ink-200 bg-white lg:max-h-none lg:w-[380px] lg:border-t-0 lg:border-l">
        <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="text-[16px] font-bold text-ink-900">{t('borne.votreCommande')}</h2>
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
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <Emoji vie="flotte" className="text-[44px]">🛒</Emoji>
              <p className="text-[15px] font-bold text-ink-700">{t('borne.panierVide')}</p>
              <p className="text-[13px] text-ink-500">{t('borne.panierVideAide')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {cart.lines.map((line, i) => (
                <li
                  key={`${line.product.id}-${i}`}
                  className="anim-surgit flex items-center gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold text-ink-900">
                      {nomTraduit(line.product, lang)}
                    </p>
                    <LineOptions options={line.options} />
                    <p className="num mt-0.5 text-[13px] text-ink-500">
                      {moneyDT(lineUnitPrice(line))}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 rounded-full border border-ink-200 p-0.5">
                    <button
                      onClick={() => cart.decrement(i)}
                      aria-label={t('carte.retirerUn')}
                      className="reagit-fort grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100"
                    >
                      <Minus size={15} strokeWidth={2.4} />
                    </button>
                    <span className="num w-6 text-center text-[15px] font-bold">
                      {line.quantity}
                    </span>
                    <button
                      onClick={() => cart.increment(i)}
                      aria-label={t('carte.ajouterUn')}
                      className="reagit-fort grid size-9 place-items-center rounded-full text-ink-600 transition-colors hover:bg-ink-100"
                    >
                      <Plus size={15} strokeWidth={2.4} />
                    </button>
                  </div>
                  <span className="num w-[72px] shrink-0 text-right text-[14.5px] font-bold">
                    {moneyDT(lineUnitPrice(line) * line.quantity)}
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
                  ['dine_in', t('borne.surPlace')],
                  ['pickup', t('borne.aEmporter')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`reagit flex h-12 items-center justify-center gap-2 rounded-[11px] text-[14.5px] font-bold transition-colors ${
                    mode === value
                      ? 'bg-petrol-50 text-petrol-700 ring-2 ring-petrol-600 ring-inset'
                      : 'border border-ink-200 text-ink-600 hover:border-ink-300'
                  }`}
                >
                  <Emoji vie={mode === value ? 'fretille' : 'immobile'}>
                    {value === 'dine_in' ? '🍽️' : '🥡'}
                  </Emoji>
                  {label}
                </button>
              ))}
            </div>

            <div className="mb-4 flex items-baseline justify-between">
              <span className="text-[15px] font-semibold text-ink-600">{t('carte.total')}</span>
              <span
                key={cart.subtotal()}
                className="anim-surgit num text-[26px] font-extrabold tracking-[-0.02em] text-ink-900"
              >
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

      <OptionPicker
        product={picking}
        open={picking !== null}
        onClose={() => setPicking(null)}
        onConfirm={(options) => {
          if (picking) cart.add(picking, options)
          setPicking(null)
        }}
      />
    </div>
  )
}

function ProductTile({
  product,
  categorie,
  onAdd,
}: {
  product: Product
  categorie?: string
  onAdd: () => void
}) {
  const t = useT()
  const lang = useLangue()
  const out = !product.isAvailable
  const nom = nomTraduit(product, lang)
  const descriptif =
    lang === 'ar' ? product.descriptionAr || product.description : product.description
  return (
    /*
     * `transition-all` a disparu : il animait aussi la position et la
     * taille, que le navigateur ne peut pas confier au compositeur. Sur
     * une borne tactile, le survol est egalement reserve a une vraie
     * souris — au doigt il se declenche au toucher et laisse la tuile
     * allumee apres que le client a retire la main.
     */
    <button
      onClick={onAdd}
      disabled={out}
      className={`reagit group flex flex-col overflow-hidden rounded-[18px] border bg-white text-start ${
        out
          ? 'cursor-not-allowed border-ink-200 opacity-55'
          : 'leve border-ink-200 [transition:border-color_180ms_var(--ease-sortie),box-shadow_180ms_var(--ease-sortie),transform_130ms_var(--ease-sortie)] hover:border-petrol-400 hover:shadow-[0_10px_28px_-10px_rgba(11,107,91,0.45)]'
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
          <div className="grid size-full place-items-center bg-gradient-to-br from-saffron-50 to-petrol-50">
            <Emoji vie="flotte" className="text-[46px]">
              {emojiPlat(product.name, categorie)}
            </Emoji>
          </div>
        )}
        {out && (
          <div className="absolute inset-x-0 bottom-0 bg-ink-900/85 py-1.5 text-center text-[12.5px] font-bold text-white">
            {t('carte.epuise')}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <p className="texte-auto text-[15px] leading-snug font-bold text-ink-900">{nom}</p>
        {descriptif && (
          <p className="texte-auto mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-500">
            {descriptif}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="num text-[16px] font-extrabold text-ink-900">
            {moneyDT(product.price)}
          </span>
          {!out && (
            <span className="grid size-9 place-items-center rounded-full bg-petrol-50 text-petrol-600 [transition:background-color_160ms_var(--ease-sortie),color_160ms_var(--ease-sortie),transform_160ms_var(--ease-ressort)] group-hover:bg-petrol-600 group-hover:text-white group-active:scale-90">
              <Plus size={18} strokeWidth={2.8} />
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function KioskDone({
  number,
  versCaisse,
  onRestart,
}: {
  number: number
  versCaisse: boolean
  onRestart: () => void
}) {
  const t = useT()
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
      <div className="flex gap-3">
        <Emoji vie="rebondit" className="text-[40px]">🎉</Emoji>
        <Emoji vie="rebondit" retard={160} className="text-[40px]">🍟</Emoji>
        <Emoji vie="rebondit" retard={320} className="text-[40px]">🥤</Emoji>
      </div>
      <p className="anim-monte mt-5 text-[17px] font-semibold text-ink-400">
        {t('borne.enregistree')}
      </p>
      <p className="anim-monte mt-2 max-w-md text-[26px] leading-tight font-bold text-white sm:text-[32px]">
        {/* Promettre un comptoir qui n'est pas tenu envoie le client
            attendre devant une caisse vide. */}
        {versCaisse ? t('borne.presentezEnCaisse') : t('borne.gardezCeNumero')}
      </p>

      <div className="anim-surgit mt-10 rounded-[26px] bg-white px-14 py-8 shadow-[0_24px_60px_-20px_rgba(11,107,91,0.6)]">
        <span className="num block text-[84px] leading-none font-bold tracking-[-0.04em] text-petrol-600 sm:text-[110px]">
          {orderNo(number)}
        </span>
      </div>

      <p className="mt-10 text-[14px] text-ink-500">
        {versCaisse
          ? t('borne.demarreApresPaiement')
          : t('borne.dejaCommencee')}
      </p>

      <button
        onClick={onRestart}
        className="reagit mt-8 text-[14px] font-semibold text-ink-400 underline-offset-4 transition-colors hover:text-white hover:underline"
      >
        {t('borne.nouvelleCommande')} ({left})
      </button>
    </div>
  )
}
