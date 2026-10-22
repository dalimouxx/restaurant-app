/**
 * La dernière commande passée sur cet appareil.
 *
 * Sans elle, un client qui ferme son onglet après avoir commandé n'a
 * plus aucun chemin de retour : le numéro s'est affiché une fois, il
 * n'a pas de compte, et l'adresse de suivi contient un identifiant
 * qu'il n'a aucune raison d'avoir noté. Il rappelle le restaurant pour
 * demander où en est sa commande — ce que ce suivi devait justement
 * éviter.
 *
 * On ne retient que l'identifiant et le numéro : juste assez pour
 * proposer « reprendre », et rien qui mérite de traîner sur un
 * téléphone partagé.
 */

const CLE = 'service.derniereCommande'

/** Au-delà, elle est servie depuis longtemps : la proposer serait absurde. */
const DUREE_MS = 4 * 60 * 60 * 1000

export interface Reprise {
  id: string
  numero: number
  le: number
}

export function retenirCommande(id: string, numero: number) {
  try {
    localStorage.setItem(CLE, JSON.stringify({ id, numero, le: Date.now() }))
  } catch {
    /* mode privé */
  }
}

export function commandeAReprendre(): Reprise | null {
  try {
    const brut = localStorage.getItem(CLE)
    if (!brut) return null
    const r = JSON.parse(brut) as Reprise
    if (!r?.id || typeof r.numero !== 'number') return null
    if (Date.now() - r.le > DUREE_MS) {
      localStorage.removeItem(CLE)
      return null
    }
    return r
  } catch {
    return null
  }
}

export function oublierCommande() {
  try {
    localStorage.removeItem(CLE)
  } catch {
    /* mode privé */
  }
}
