import { useEffect, useState } from 'react'
import { settingsApi } from './api'
import type { Settings } from './types'
import { reglagesRetenus, retenirLesReglages } from './horsLigne'

/**
 * Réglages de l'établissement, partagés par tous les écrans.
 *
 * Une seule requête pour toute la session : la caisse, la cuisine, la
 * borne et l'écran de salle ont tous besoin du même déroulé de service,
 * et quatre appels au démarrage retarderaient l'ouverture de chacun.
 *
 * Le déroulé change en plein service — le gérant coupe la livraison
 * quand son livreur part, retire une étape de cuisine au coup de feu.
 * `rafraichirReglages()` oublie la réponse en cache, et l'écran des
 * réglages l'appelle après chaque enregistrement pour que les autres
 * postes prennent la nouvelle consigne au rechargement suivant.
 */
let promesse: Promise<Settings> | null = null

/**
 * Les réglages, du serveur ou de la mémoire du poste.
 *
 * Le service worker fait démarrer l'application sans réseau, mais il ne
 * met jamais l'API en cache — et il a raison : un stock ou une file
 * périmés valent moins que rien. Les réglages, eux, ne changent pas
 * trois fois par jour. Sans ce repli, une tablette rechargée pendant
 * une coupure s'ouvrait sur une caisse sans nom d'établissement, sans
 * monnaie, et incapable d'imprimer le moindre ticket.
 */
export function reglages(): Promise<Settings> {
  if (!promesse) {
    promesse = settingsApi
      .get()
      .then((s) => {
        retenirLesReglages(s)
        return s
      })
      .catch((e) => {
        const retenus = reglagesRetenus<Settings>()
        if (retenus) return retenus
        // Rien en mémoire non plus : l'appelant a ses valeurs de repli,
        // et une promesse qui échoue vaut mieux qu'un écran figé.
        promesse = null
        throw e
      })
  }
  return promesse
}

export function rafraichirReglages() {
  promesse = null
}

/** Valeurs de repli : le poste reste utilisable si les réglages tardent. */
const REPLI = {
  etapesCuisine: 'deux',
  livraisonActive: 'oui',
  caisseSimplifiee: 'non',
} as const

export function useReglages() {
  const [valeurs, setValeurs] = useState<Settings | null>(null)

  useEffect(() => {
    let vivant = true
    reglages()
      .then((s) => vivant && setValeurs(s))
      .catch(() => {})
    return () => {
      vivant = false
    }
  }, [])

  return {
    reglages: valeurs,
    etapes: valeurs?.etapesCuisine ?? REPLI.etapesCuisine,
    livraison: (valeurs?.livraisonActive ?? REPLI.livraisonActive) === 'oui',
    caisseSimplifiee: (valeurs?.caisseSimplifiee ?? REPLI.caisseSimplifiee) === 'oui',
  }
}
