import { useCallback, useEffect, useRef, useState } from 'react'
import { catalog, orders } from './api'
import { journeeDuJour } from './format'
import {
  fileDAttente,
  navigateurHorsLigne,
  numerosRestants,
  poserTranche,
  poste,
  retenirLaCarte,
  retirerDeLaFile,
  trancheABientotEpuisee,
} from './horsLigne'

/**
 * Le va-et-vient de la caisse entre le réseau et son absence.
 *
 * Deux travaux, et ils tournent tous les deux en fond pendant que le
 * caissier encaisse — il n'a rien à déclencher, rien à comprendre, et
 * surtout rien à décider au coup de feu.
 *
 * **Garder des numéros d'avance.** Tant que le lien tient, la caisse se
 * fait réserver une tranche et la renouvelle dès qu'elle en a brûlé
 * l'essentiel. Le bon moment pour préparer une coupure est celui où
 * tout va bien.
 *
 * **Rejouer ce qui attend.** Au retour du réseau, les ventes de la
 * coupure repartent une par une, dans l'ordre où elles ont été faites.
 * Chacune porte sa référence : si l'envoi passe mais que la réponse se
 * perd, la tentative suivante reconnaît la vente au lieu d'en créer une
 * seconde.
 *
 * **Une vente qui échoue ne bloque pas les suivantes et n'est jamais
 * jetée.** Un plat retiré de la carte pendant la coupure fait échouer
 * sa vente pour toujours : la file s'arrêterait là, et tout le service
 * resterait coincé derrière. On passe donc à la suivante, et ce qui
 * résiste reste visible — c'est au gérant de trancher, pas au logiciel
 * d'effacer une vente encaissée.
 */

/** Toutes les deux minutes : assez pour suivre, assez peu pour se faire oublier. */
const RYTHME_MS = 2 * 60 * 1000

export interface VenteBloquee {
  clientRef: string
  orderNumber: number
  priseA: string
  total: number
  /** Ce que le serveur a répondu, pour que quelqu'un puisse décider. */
  motif: string
}

export interface EtatReprise {
  /** Ventes faites hors ligne et pas encore remontées. */
  enAttente: number
  /** Ventes que le serveur refuse, et qui demandent un arbitrage. */
  bloquees: number
  /** Le détail, pour que quelqu'un puisse trancher. */
  detailBloquees: VenteBloquee[]
  /** Numéros encore utilisables si le réseau tombe maintenant. */
  numeros: number
  /** Le lien est-il coupé, autant qu'on puisse le dire. */
  coupe: boolean
  /** Une remontée est en cours. */
  enCours: boolean
}

export function useReprise(
  actif: boolean,
): EtatReprise & { relancer: () => void; solder: (clientRef: string) => void } {
  const [etat, setEtat] = useState<EtatReprise>(() => ({
    enAttente: fileDAttente().length,
    bloquees: 0,
    detailBloquees: [],
    numeros: numerosRestants(journeeDuJour()),
    coupe: navigateurHorsLigne(),
    enCours: false,
  }))

  // Les références qui ont déjà résisté, et pourquoi : on ne les
  // retente qu'au prochain tour, pour ne pas tourner en boucle sur la
  // même — et le motif permet à quelqu'un de trancher.
  const bloquees = useRef<Map<string, string>>(new Map())
  const occupe = useRef(false)

  const rafraichir = useCallback(() => {
    const file = fileDAttente()
    setEtat((e) => ({
      ...e,
      enAttente: file.length,
      bloquees: bloquees.current.size,
      detailBloquees: file
        .filter((v) => bloquees.current.has(v.clientRef))
        .map((v) => ({
          clientRef: v.clientRef,
          orderNumber: v.orderNumber,
          priseA: v.priseA,
          total: v.total,
          motif: bloquees.current.get(v.clientRef) ?? 'Refusée par le serveur',
        })),
      numeros: numerosRestants(journeeDuJour()),
      coupe: navigateurHorsLigne(),
    }))
  }, [])

  const tourner = useCallback(async () => {
    if (!actif || occupe.current || navigateurHorsLigne()) return
    occupe.current = true
    setEtat((e) => ({ ...e, enCours: true }))

    try {
      // Les ventes d'abord : elles portent de l'argent déjà encaissé.
      const file = fileDAttente()
      for (const vente of file) {
        try {
          await orders.rejouer(vente)
          retirerDeLaFile(vente.clientRef)
          bloquees.current.delete(vente.clientRef)
        } catch (err) {
          /**
           * Un refus du serveur — un plat retiré de la carte pendant
           * la coupure — ne se résoudra jamais tout seul. On la laisse
           * dans la file, visible, et on passe à la suivante : une
           * vente bloquée ne doit pas retenir tout le service derrière
           * elle. Une panne de réseau, elle, interrompt le tour : rien
           * ne passera tant que le lien n'est pas revenu.
           */
          if (estUnRefus(err)) {
            bloquees.current.set(
              vente.clientRef,
              err instanceof Error ? err.message : 'Refusée par le serveur',
            )
          } else break
        }
        rafraichir()
      }

      // Puis les numéros, pour la prochaine coupure.
      if (trancheABientotEpuisee(journeeDuJour())) {
        try {
          poserTranche(await orders.reserverNumeros(poste()))
        } catch {
          /* Sans réseau, on garde ce qu'on a. */
        }
      }

      /**
       * Et la carte, pour pouvoir composer une commande sans réseau.
       *
       * Elle était recopiée seulement à l'ouverture du panneau de
       * vente. Un caissier qui prenait son poste et dont l'ADSL tombait
       * avant sa première commande n'avait donc rien en mémoire : les
       * numéros mis de côté dormaient pour rien, faute de plats à
       * afficher. On la recopie maintenant d'office, pendant que tout
       * va bien — c'est le seul moment où l'on peut.
       */
      try {
        retenirLaCarte(await catalog.menu())
      } catch {
        /* Sans réseau, on garde celle qu'on a. */
      }
    } finally {
      occupe.current = false
      setEtat((e) => ({ ...e, enCours: false }))
      rafraichir()
    }
  }, [actif, rafraichir])

  useEffect(() => {
    if (!actif) return
    void tourner()

    const horloge = setInterval(() => void tourner(), RYTHME_MS)
    // Le retour du réseau est le moment où il faut agir, pas deux
    // minutes plus tard : le caissier attend de voir sa file se vider.
    const auRetour = () => {
      rafraichir()
      void tourner()
    }
    window.addEventListener('online', auRetour)
    window.addEventListener('offline', rafraichir)
    return () => {
      clearInterval(horloge)
      window.removeEventListener('online', auRetour)
      window.removeEventListener('offline', rafraichir)
    }
  }, [actif, tourner, rafraichir])

  /**
   * Solder une vente que le serveur refuse définitivement.
   *
   * Sans cette porte de sortie, le bandeau d'alerte resterait affiché
   * pour toujours : la vente ne passera jamais, et un avertissement
   * permanent cesse d'être un avertissement. Celui qui la retire sait
   * ce qu'il fait — il a le ticket sous les yeux, et la vente sera
   * ressaisie à la main.
   */
  const solder = useCallback(
    (clientRef: string) => {
      retirerDeLaFile(clientRef)
      bloquees.current.delete(clientRef)
      rafraichir()
    },
    [rafraichir],
  )

  return { ...etat, relancer: () => void tourner(), solder }
}

/**
 * Le serveur a-t-il refusé pour toujours, ou seulement pour l'instant ?
 *
 * La distinction décide du sort de la vente : un refus définitif demande
 * un arbitrage humain, tout le reste se retente tout seul.
 *
 * **Toutes les erreurs 4xx ne se valent pas.** La première version
 * traitait la famille entière comme définitive — session expirée
 * comprise. Un caissier dont le jeton venait d'expirer voyait alors
 * TOUTES ses ventes marquées « ne passeront jamais », alors qu'il
 * suffisait de se reconnecter. Une authentification refusée, un accès
 * refusé, un débit bridé : ceux-là changent d'eux-mêmes.
 *
 * Ce qui ne changera pas : une commande vide, un plat qui n'existe
 * plus, une règle que la vente viole. Là, personne d'autre qu'un humain
 * ne peut trancher.
 */
const REFUS_DEFINITIFS = [400, 404, 409, 410, 422]

function estUnRefus(err: unknown): boolean {
  const statut = (err as { status?: number })?.status
  return typeof statut === 'number' && REFUS_DEFINITIFS.includes(statut)
}
