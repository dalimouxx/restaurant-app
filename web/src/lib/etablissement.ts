/**
 * De quel fastfood dépend cet appareil.
 *
 * Une installation peut héberger plusieurs établissements. Les postes
 * avec session portent le leur dans leur jeton, mais la borne et l'écran
 * de salle n'ont personne de connecté : rien, dans leurs requêtes, ne dit
 * où ils sont posés. Sans ce repère, une borne installée à Gabès
 * afficherait la carte de celle de Sfax.
 *
 * On le retient sur l'appareil, parce qu'une borne est configurée une
 * fois pour toutes puis laissée en place des mois. Le poser par l'adresse
 * — `/borne?restaurant=gabes-centre` — suffit à l'installer : le signet
 * de l'écran tactile devient toute sa configuration.
 *
 * Une installation à un seul établissement n'a rien à faire : le serveur
 * le devine, puisqu'il n'y a pas d'ambiguïté.
 */

const CLE = 'service.etablissement'

function depuisAdresse(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('restaurant')?.trim() || null
  } catch {
    return null
  }
}

function retenu(): string | null {
  try {
    return localStorage.getItem(CLE) || null
  } catch {
    // Navigation privée : le repère de l'adresse continue de fonctionner,
    // il faudra simplement qu'il y soit à chaque ouverture.
    return null
  }
}

/** Le repère courant, et il s'inscrit s'il vient d'arriver par l'adresse. */
export function etablissementCourant(): string | null {
  const parAdresse = depuisAdresse()
  if (parAdresse) {
    try {
      localStorage.setItem(CLE, parAdresse)
    } catch {
      /* mode privé */
    }
    return parAdresse
  }
  return retenu()
}

export function definirEtablissement(repere: string | null) {
  try {
    if (repere) localStorage.setItem(CLE, repere)
    else localStorage.removeItem(CLE)
  } catch {
    /* mode privé */
  }
}
