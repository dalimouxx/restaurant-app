import { useEffect, useRef, useState } from 'react'

/**
 * Emoji animés.
 *
 * Décoratifs, et rien d'autre : ils sont marqués `aria-hidden`, sans
 * quoi un lecteur d'écran annoncerait « emoji hamburger » au milieu du
 * nom d'un plat. L'information reste dans le texte.
 *
 * `inline-block` est obligatoire : un `<span>` en flux ne se transforme
 * pas, et l'animation ne se verrait tout simplement pas.
 *
 * Où les mettre : sur ce que regarde le client — la borne, la commande
 * en ligne, le suivi, l'écran de salle. Pas sur un poste de travail. Un
 * élément qui bouge en permanence dans le champ de vision d'un cuisinier
 * en plein coup de feu finit par être ignoré, et avant d'être ignoré, il
 * fatigue.
 */

type Vie = 'rebondit' | 'fretille' | 'flotte' | 'bat' | 'tourne' | 'immobile'

const CLASSES: Record<Vie, string> = {
  rebondit: 'emoji-rebondit',
  fretille: 'emoji-fretille',
  flotte: 'emoji-flotte',
  bat: 'emoji-bat',
  tourne: 'emoji-tourne',
  immobile: '',
}

/**
 * Un seul observateur pour toute la page.
 *
 * Une carte de soixante-dix plats affichait soixante-dix emoji animés
 * en boucle — dont la soixantaine qui se trouve hors de l'écran. Mesuré
 * sur la carte en ligne : cent sept animations infinies tournant en
 * même temps, sur un téléphone, pendant qu'on fait défiler. C'est de la
 * batterie brûlée pour un mouvement que personne ne voit, et c'est
 * précisément ce qui rend un défilement saccadé.
 *
 * L'emoji ne s'anime donc que tant qu'il est visible. Un observateur
 * partagé plutôt qu'un par emoji : soixante-dix observateurs coûteraient
 * ce qu'on cherche à économiser.
 */
const abonnes = new WeakMap<Element, (visible: boolean) => void>()

const observateur =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (entrees) => {
          for (const e of entrees) abonnes.get(e.target)?.(e.isIntersecting)
        },
        // Une marge : l'emoji est déjà en mouvement quand il arrive,
        // au lieu de démarrer sous les yeux du client.
        { rootMargin: '120px' },
      )

export function Emoji({
  children,
  vie = 'immobile',
  retard,
  className = '',
}: {
  children: string
  vie?: Vie
  /** Décale le départ : une rangée d'emoji synchronisés fait mécanique. */
  retard?: number
  className?: string
}) {
  const noeud = useRef<HTMLSpanElement | null>(null)
  /* Visible par défaut : sans observateur — navigateur ancien, rendu
     côté serveur — mieux vaut un emoji qui bouge qu'un emoji figé. */
  const [envue, setEnvue] = useState(true)

  useEffect(() => {
    const el = noeud.current
    if (!el || !observateur || vie === 'immobile') return
    abonnes.set(el, setEnvue)
    observateur.observe(el)
    return () => {
      observateur.unobserve(el)
      abonnes.delete(el)
    }
  }, [vie])

  return (
    <span
      ref={noeud}
      aria-hidden="true"
      className={`inline-block ${envue ? CLASSES[vie] : ''} ${className}`}
      style={retard ? { animationDelay: `${retard}ms` } : undefined}
    >
      {children}
    </span>
  )
}

/* ───────────────────────── Correspondances ───────────────────────── */

/**
 * L'emoji d'une catégorie, deviné d'après son nom.
 *
 * Deviné, parce qu'un gérant nomme ses catégories comme il veut et ne
 * viendra jamais choisir un pictogramme dans un menu déroulant. Faute
 * de correspondance, on retombe sur une assiette — jamais sur rien, un
 * trou dans une rangée se voit plus qu'un emoji approximatif.
 */
const PAR_MOT: [RegExp, string][] = [
  [/burger|hamburger/i, '🍔'],
  [/pizza/i, '🍕'],
  [/sandwich|panini|baguette/i, '🥪'],
  [/tacos|taco|wrap|durum/i, '🌯'],
  [/frite|potato/i, '🍟'],
  [/poulet|chicken|grill/i, '🍗'],
  [/pâtes|pates|spaghetti|macaroni|penne/i, '🍝'],
  [/salade|crudit/i, '🥗'],
  [/boisson|soda|cola|jus|drink/i, '🥤'],
  [/café|cafe|thé|the\b/i, '☕'],
  [/dessert|gâteau|gateau|crêpe|crepe|glace/i, '🍰'],
  [/soupe|chorba|harira/i, '🍲'],
  [/poisson|fruits de mer/i, '🐟'],
  [/couscous|plat|menu/i, '🍛'],
  [/brik|chapati|malfouf/i, '🥟'],
  [/œuf|oeuf|omelette|ojja/i, '🍳'],
  [/kebab|chawarma|shawarma/i, '🥙'],
  [/entrée|entree|apér|aper/i, '🫒'],
  [/accompagnement|supplément|supplement|side/i, '🍟'],
  [/makloub|mlawi|tabouna/i, '🫓'],
  [/libanais|libanaise/i, '🥙'],
  [/escalope|viande|steak|bœuf|boeuf/i, '🥩'],
  [/thon/i, '🐟'],
  [/fromage|cheese/i, '🧀'],
  [/eau\b/i, '💧'],
]

export function emojiPour(nom: string | undefined | null): string {
  if (!nom) return '🍽️'
  for (const [motif, emoji] of PAR_MOT) {
    if (motif.test(nom)) return emoji
  }
  return '🍽️'
}

/**
 * L'emoji d'un plat.
 *
 * Le nom du plat passe avant celui de sa catégorie : sans cela, les
 * douze sandwichs d'une carte affichent douze fois le même pictogramme,
 * et une grille de tuiles identiques se lit moins bien qu'une grille
 * sans aucune image. La catégorie ne sert que de filet.
 */
export function emojiPlat(
  nomPlat: string | undefined | null,
  nomCategorie?: string | null,
): string {
  const parLePlat = emojiPour(nomPlat)
  if (parLePlat !== '🍽️') return parLePlat
  return emojiPour(nomCategorie)
}

/** L'emoji d'un état de commande, pour l'écran de salle et le suivi. */
export const EMOJI_ETAT: Record<string, { emoji: string; vie: Vie }> = {
  awaiting_payment: { emoji: '🧾', vie: 'immobile' },
  in_kitchen: { emoji: '👨‍🍳', vie: 'fretille' },
  preparing: { emoji: '🔥', vie: 'bat' },
  ready: { emoji: '🎉', vie: 'rebondit' },
  awaiting_driver: { emoji: '📦', vie: 'flotte' },
  out_for_delivery: { emoji: '🛵', vie: 'rebondit' },
  delivered: { emoji: '✅', vie: 'immobile' },
  completed: { emoji: '✅', vie: 'immobile' },
  cancelled: { emoji: '❌', vie: 'immobile' },
}
