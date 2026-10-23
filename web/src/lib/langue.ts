import { useSyncExternalStore } from 'react'

/**
 * Français et arabe, côté client.
 *
 * **Ce que la traduction couvre, et pourquoi pas le reste.** Les écrans
 * que voit le public — la page d'accueil, la commande en ligne, la
 * borne du comptoir, l'écran de salle, le suivi — sont traduits. Les
 * postes du personnel et la gestion restent en français : l'équipe est
 * formée sur un vocabulaire, et deux vocabulaires pour une même caisse
 * produisent des erreurs de clôture, pas du confort.
 *
 * **Pourquoi un choix explicite et pas la langue du navigateur.** Un
 * téléphone vendu en Tunisie est très souvent réglé en français alors
 * que son propriétaire lit l'arabe plus volontiers, et une borne de
 * salle n'a pas de propriétaire du tout. On montre donc un sélecteur,
 * on retient le choix, et on ne devine rien.
 *
 * **Le sens de lecture suit la langue.** `dir="rtl"` est posé sur le
 * document : les marges logiques de Tailwind (`ms-`, `me-`, `ps-`,
 * `pe-`, `start-`, `end-`) se retournent d'elles-mêmes, ce qui est
 * exactement la raison pour laquelle elles sont employées partout où la
 * direction compte.
 */

export type Langue = 'fr' | 'ar'

const CLE = 'service.langue'

export const LANGUES: { code: Langue; nom: string; court: string }[] = [
  { code: 'fr', nom: 'Français', court: 'FR' },
  { code: 'ar', nom: 'العربية', court: 'ع' },
]

function lire(): Langue {
  try {
    return localStorage.getItem(CLE) === 'ar' ? 'ar' : 'fr'
  } catch {
    // Navigation privée : le français, et le sélecteur reste à portée.
    return 'fr'
  }
}

let courante: Langue = lire()
const abonnes = new Set<() => void>()

/** Pose la langue sur le document : c'est elle qui retourne la page. */
function appliquer(langue: Langue) {
  try {
    document.documentElement.lang = langue
    document.documentElement.dir = langue === 'ar' ? 'rtl' : 'ltr'
  } catch {
    /* sans document, rien à poser */
  }
}

appliquer(courante)

export function langue(): Langue {
  return courante
}

export function changerLangue(nouvelle: Langue) {
  if (nouvelle === courante) return
  courante = nouvelle
  try {
    localStorage.setItem(CLE, nouvelle)
  } catch {
    /* le choix ne survivra pas à la visite, mais il vaut pour maintenant */
  }
  appliquer(nouvelle)
  abonnes.forEach((f) => f())
}

function abonner(f: () => void) {
  abonnes.add(f)
  return () => abonnes.delete(f)
}

/** La langue courante, qui redessine l'écran quand elle change. */
export function useLangue(): Langue {
  return useSyncExternalStore(abonner, langue, () => 'fr')
}

export function estRTL(): boolean {
  return courante === 'ar'
}
