import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, MapPin, Phone } from 'lucide-react'
import { catalog, settingsApi, zones as zonesApi } from '../lib/api'
import { moneyDT } from '../lib/format'
import type { Category, DeliveryZone, Product, Settings, WeekDay } from '../lib/types'
import { Emoji, emojiPlat } from '../components/Emoji'
import { useAuth } from '../lib/store'
import { Wordmark } from '../components/Shell'
import { RepriseCommande } from '../components/RepriseCommande'
import { Skeleton } from '../components/ui'

/**
 * Page d'accueil publique.
 *
 * C'est la vitrine : ce que voit quelqu'un qui tombe sur l'adresse du
 * restaurant, et souvent la seule page qu'il lira avant de décider de
 * commander ou d'aller ailleurs.
 *
 * Elle ne montre donc aucun poste de travail. La cuisine, la caisse, la
 * borne et la gestion existent toujours, à leurs adresses, mais rien ne
 * les annonce ici — un client qui voit « Caisse » et « Gestion » sur la
 * page d'accueil d'un fastfood comprend qu'il regarde un logiciel, pas
 * un restaurant.
 *
 * Tout ce qu'elle affiche vient du serveur : le nom, l'adresse, les
 * horaires, l'état d'ouverture calculé, les zones et leurs tarifs, et
 * de vrais plats de la carte. Une page d'accueil avec des horaires
 * inventés ou des photos de banque d'images se repère immédiatement, et
 * elle coûte la commande.
 */

const JOURS: { cle: WeekDay; nom: string }[] = [
  { cle: 'mon', nom: 'Lundi' },
  { cle: 'tue', nom: 'Mardi' },
  { cle: 'wed', nom: 'Mercredi' },
  { cle: 'thu', nom: 'Jeudi' },
  { cle: 'fri', nom: 'Vendredi' },
  { cle: 'sat', nom: 'Samedi' },
  { cle: 'sun', nom: 'Dimanche' },
]

/** Lundi = 0, pour aligner sur l'ordre d'affichage de la semaine. */
function jourCourant(): number {
  return (new Date().getDay() + 6) % 7
}

export default function LandingScreen() {
  const connecte = useAuth((s) => s.user !== null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [produits, setProduits] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [charge, setCharge] = useState(false)

  useEffect(() => {
    // Chacune de son côté : une page d'accueil ne doit pas rester vide
    // parce qu'une seule des trois sources est lente ou en panne.
    settingsApi.get().then(setSettings).catch(() => {})
    zonesApi.list().then(setZones).catch(() => setZones([]))
    catalog
      .menu()
      .then(({ categories: c, products: p }) => {
        setCategories(c)
        setProduits(p)
      })
      .catch(() => {})
      .finally(() => setCharge(true))
  }, [])

  /** Quelques plats disponibles, pour montrer de quoi il s'agit. */
  const vitrine = useMemo(
    () => produits.filter((p) => p.isAvailable).slice(0, 6),
    [produits],
  )

  const nomCategorie = (id: string) => categories.find((c) => c.id === id)?.name

  const ouvert = settings?.opening.open ?? false
  const zoneLaMoinsChere = zones.length
    ? zones.reduce((a, z) => (z.fee < a.fee ? z : a), zones[0])
    : null

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* ───────────────────────── Bandeau ───────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-ink-50/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5">
          <Wordmark dark={false} />
          <Link
            to="/commander"
            className="reagit inline-flex h-10 items-center gap-2 rounded-full bg-ink-900 px-5 text-[14px] font-bold text-white transition-colors hover:bg-ink-800"
          >
            Commander
            <ArrowRight size={16} strokeWidth={2.4} />
          </Link>
        </div>
      </header>

      <div className="px-5 pt-4">
        <RepriseCommande />
      </div>

      {/* ───────────────────────── Accroche ───────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Décor posé derrière le texte, et jamais devant : il ne doit
            rien gêner ni intercepter un appui. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
          <span className="emoji-flotte absolute top-10 left-[6%] text-[80px] opacity-[0.07]">
            🍔
          </span>
          <span
            className="emoji-flotte absolute top-32 right-[8%] text-[96px] opacity-[0.07]"
            style={{ animationDelay: '900ms' }}
          >
            🍟
          </span>
          <span
            className="emoji-flotte absolute bottom-6 left-[42%] text-[70px] opacity-[0.06]"
            style={{ animationDelay: '1800ms' }}
          >
            🥤
          </span>
        </div>

        <div className="relative mx-auto max-w-5xl px-5 pt-14 pb-16 sm:pt-20 sm:pb-20">
          <span
            className={`anim-surgit inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-bold ${
              ouvert
                ? 'bg-petrol-100 text-petrol-800'
                : 'bg-ink-200 text-ink-600'
            }`}
          >
            <span
              className={`size-2 rounded-full ${
                ouvert ? 'anim-halo bg-petrol-600' : 'bg-ink-400'
              }`}
            />
            {ouvert
              ? 'Ouvert maintenant'
              : settings?.opening.opensAt
                ? `Fermé — ouvre à ${settings.opening.opensAt}${
                    settings.opening.opensDay ? ` ${settings.opening.opensDay}` : ''
                  }`
                : 'Fermé'}
          </span>

          <h1 className="anim-monte mt-5 max-w-2xl text-[40px] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink-900 sm:text-[62px]">
            {settings?.restaurantName ?? 'Notre fastfood'}
          </h1>

          <p className="anim-monte mt-4 max-w-md text-[17px] leading-relaxed text-ink-600">
            Commandez depuis votre téléphone, suivez la préparation en direct,
            et venez récupérer{zoneLaMoinsChere ? ' — ou on vous livre' : ''}.
          </p>

          <div className="anim-cascade mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/commander"
              className="reagit leve inline-flex h-14 items-center gap-2.5 rounded-[14px] bg-petrol-600 px-7 text-[16px] font-bold text-white shadow-[0_14px_34px_-12px_rgba(11,107,91,0.75)] transition-colors hover:bg-petrol-500"
            >
              <Emoji vie="rebondit" className="text-[20px]">🍔</Emoji>
              Commander en ligne
            </Link>
            {/*
              * Seul un client inscrit a un historique. L'afficher a tout
              * le monde envoyait les autres — la majorite, maintenant que
              * le compte est facultatif — droit sur un mur de connexion
              * depuis le bouton principal de la page d'accueil. Ceux qui
              * ont commande sans compte retrouvent leur suivi par le
              * bandeau de reprise, juste au-dessus.
              */}
            {connecte && (
              <Link
                to="/mes-commandes"
                className="reagit inline-flex h-14 items-center gap-2 rounded-[14px] border border-ink-200 bg-white px-6 text-[15px] font-bold text-ink-700 transition-colors hover:border-ink-300"
              >
                Mes commandes
              </Link>
            )}
          </div>

          {/* Les trois chiffres qui répondent aux vraies questions :
              quand, combien, et à partir de quand ça part. */}
          <dl className="anim-cascade mt-12 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
            <Repere
              emoji="🕒"
              vie="bat"
              titre="Aujourd'hui"
              valeur={
                settings
                  ? (() => {
                      const j = settings.openingHours[JOURS[jourCourant()].cle]
                      return j?.closed ? 'Fermé' : `${j?.open} – ${j?.close}`
                    })()
                  : '—'
              }
            />
            <Repere
              emoji="🛵"
              vie="flotte"
              titre="Livraison"
              valeur={
                zoneLaMoinsChere ? `dès ${moneyDT(zoneLaMoinsChere.fee)}` : 'Retrait seul'
              }
            />
            <Repere
              emoji="🍽️"
              vie="fretille"
              titre="À la carte"
              valeur={charge ? `${produits.length} plats` : '—'}
            />
          </dl>
        </div>
      </section>

      {/* ───────────────────────── La carte ───────────────────────── */}
      {vitrine.length > 0 && (
        <section className="mx-auto max-w-5xl px-5 pb-16">
          <div className="mb-5 flex items-end justify-between gap-4">
            <h2 className="flex items-center gap-2.5 text-[24px] font-extrabold tracking-[-0.02em] text-ink-900">
              <Emoji vie="rebondit" className="text-[24px]">🔥</Emoji>
              Ce qu'on sert
            </h2>
            <Link
              to="/commander"
              className="shrink-0 text-[14px] font-bold text-petrol-700 underline-offset-4 hover:underline"
            >
              Toute la carte
            </Link>
          </div>

          <div className="anim-cascade grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {vitrine.map((p) => (
              <Link
                key={p.id}
                to="/commander"
                className="reagit leve flex items-center gap-3.5 rounded-[16px] border border-ink-200 bg-white p-3.5 transition-colors hover:border-petrol-300"
              >
                <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-gradient-to-br from-saffron-50 to-petrol-50">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Emoji vie="flotte" className="text-[26px]">
                      {emojiPlat(p.name, nomCategorie(p.categoryId))}
                    </Emoji>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-ink-900">
                    {p.name}
                  </span>
                  {p.description && (
                    <span className="mt-0.5 block truncate text-[12.5px] text-ink-500">
                      {p.description}
                    </span>
                  )}
                </span>
                <span className="num shrink-0 text-[15px] font-extrabold text-ink-900">
                  {moneyDT(p.price)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ───────────────────────── Comment ça marche ───────────────────────── */}
      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-5xl px-5 py-14">
          <h2 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink-900">
            Comment ça marche
          </h2>
          <ol className="anim-cascade mt-7 grid gap-5 sm:grid-cols-3">
            {[
              { e: '📱', v: 'fretille' as const, t: 'Vous commandez', d: 'Depuis votre téléphone, en deux minutes. Pas de compte obligatoire.' },
              { e: '👨‍🍳', v: 'bat' as const, t: 'On prépare', d: 'Votre ticket part directement en cuisine. Vous suivez l\'avancement en direct.' },
              { e: '🎉', v: 'rebondit' as const, t: 'C\'est prêt', d: 'Votre numéro s\'affiche en salle. Vous payez sur place, à la réception.' },
            ].map((e, i) => (
              <li key={e.t}>
                <span className="flex items-center gap-2.5">
                  <Emoji vie={e.v} retard={i * 220} className="text-[30px]">
                    {e.e}
                  </Emoji>
                  <span className="num text-[13px] font-bold text-ink-400">
                    0{i + 1}
                  </span>
                </span>
                <p className="mt-3 text-[16px] font-bold text-ink-900">{e.t}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">{e.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────────────────────── Infos pratiques ───────────────────────── */}
      <section className="mx-auto max-w-5xl px-5 py-14">
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink-900">
              Nous trouver
            </h2>
            <ul className="mt-5 space-y-3.5">
              {settings?.address && (
                <Ligne icon={MapPin} texte={settings.address} />
              )}
              {settings?.phone && (
                <Ligne
                  icon={Phone}
                  texte={settings.phone}
                  href={`tel:${settings.phone.replace(/\s/g, '')}`}
                />
              )}
            </ul>

            {zones.length > 0 && (
              <>
                <h3 className="mt-8 flex items-center gap-2 text-[15px] font-bold text-ink-900">
                  <Emoji vie="flotte">🛵</Emoji>
                  On livre dans
                </h3>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {zones.map((z) => (
                    <li
                      key={z.id}
                      className="rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-[13px] text-ink-700"
                    >
                      <span className="font-bold text-ink-900">{z.name}</span>
                      <span className="num ml-1.5 text-ink-500">
                        {moneyDT(z.fee)} · ~{z.estimatedMinutes} min
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div>
            <h2 className="flex items-center gap-2.5 text-[24px] font-extrabold tracking-[-0.02em] text-ink-900">
              <Clock size={20} className="text-ink-400" />
              Horaires
            </h2>
            {settings ? (
              <ul className="mt-5 divide-y divide-ink-200/70 overflow-hidden rounded-[16px] border border-ink-200 bg-white">
                {JOURS.map((j, i) => {
                  const h = settings.openingHours[j.cle]
                  const cestAujourdhui = i === jourCourant()
                  return (
                    <li
                      key={j.cle}
                      className={`flex items-center justify-between px-4 py-2.5 text-[14px] ${
                        cestAujourdhui ? 'bg-petrol-50' : ''
                      }`}
                    >
                      <span
                        className={
                          cestAujourdhui
                            ? 'font-bold text-petrol-800'
                            : 'text-ink-600'
                        }
                      >
                        {j.nom}
                      </span>
                      <span
                        className={`num ${
                          h?.closed
                            ? 'text-ink-400'
                            : cestAujourdhui
                              ? 'font-bold text-petrol-800'
                              : 'text-ink-900'
                        }`}
                      >
                        {h?.closed ? 'Fermé' : `${h?.open} – ${h?.close}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Skeleton className="mt-5 h-[260px]" />
            )}
          </div>
        </div>
      </section>

      {/* ───────────────────────── Pied de page ─────────────────────────
          L'accès au personnel vit ici, discret. Il faut qu'un caissier
          puisse l'atteindre sans retenir une adresse, et qu'un client
          n'ait aucune raison de cliquer dessus. */}
      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-ink-500">
            {settings?.restaurantName ?? 'Service'}
            {settings?.address ? ` · ${settings.address}` : ''}
          </p>
          <Link
            to="/espace"
            className="text-[12.5px] font-semibold text-ink-400 underline-offset-4 transition-colors hover:text-ink-700 hover:underline"
          >
            Espace personnel
          </Link>
        </div>
      </footer>
    </div>
  )
}

function Repere({
  emoji,
  vie,
  titre,
  valeur,
}: {
  emoji: string
  vie: 'bat' | 'flotte' | 'fretille'
  titre: string
  valeur: string
}) {
  return (
    <div className="rounded-[16px] border border-ink-200 bg-white p-4">
      <Emoji vie={vie} className="text-[24px]">
        {emoji}
      </Emoji>
      <dt className="mt-2 text-[12.5px] font-semibold text-ink-500">{titre}</dt>
      <dd className="num mt-0.5 text-[16px] font-extrabold text-ink-900">{valeur}</dd>
    </div>
  )
}

function Ligne({
  icon: Icon,
  texte,
  href,
}: {
  icon: typeof MapPin
  texte: string
  href?: string
}) {
  const contenu = (
    <>
      <Icon size={17} className="mt-0.5 shrink-0 text-ink-400" />
      <span className="text-[14.5px] leading-snug text-ink-700">{texte}</span>
    </>
  )
  return (
    <li className="flex items-start gap-2.5">
      {href ? (
        <a href={href} className="flex items-start gap-2.5 hover:text-petrol-700">
          {contenu}
        </a>
      ) : (
        contenu
      )}
    </li>
  )
}
