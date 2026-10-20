import { useEffect, useState } from 'react'
import { settingsApi } from './api'
import type { Settings } from './types'

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

export function reglages(): Promise<Settings> {
  if (!promesse) promesse = settingsApi.get()
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
