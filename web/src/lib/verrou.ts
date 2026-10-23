import { useCallback, useEffect, useRef, useState } from 'react'
import type { Poste } from './install'

/**
 * Le poste qui se verrouille quand personne ne s'en occupe.
 *
 * Une tablette de caisse vit sur un comptoir, allumée et connectée toute
 * la journée. Celui qui s'en approche pendant que le caissier est au
 * fond de la cuisine peut encaisser, annuler, remettre une commande.
 * Une tablette de gestion oubliée sur un bureau, c'est pire : les prix,
 * les chiffres, l'équipe.
 *
 * **La session n'est pas fermée, elle est couverte.** Fermer la session
 * fermerait aussi la caisse ouverte et la commande à moitié saisie — et
 * le caissier qui revient des toilettes perdrait son travail. On pose un
 * voile, et le code à quatre chiffres le lève en deux secondes.
 *
 * **Chaque poste a son délai, et deux ne se verrouillent jamais.** Un
 * écran de cuisine qui se verrouille au coup de feu est un danger : le
 * cuisinier a les mains dans la friture et les tickets s'accumulent
 * derrière un mot de passe. Il est d'ailleurs derrière le comptoir,
 * hors de portée. L'écran de salle non plus — il est au mur, et il ne
 * sert qu'à afficher des numéros.
 */

/**
 * Combien de temps sans un geste avant de couvrir l'écran.
 *
 * La gestion part la première : c'est le poste où l'on change les prix
 * et où l'on lit les chiffres. La caisse tient plus longtemps — un
 * caissier touche son écran toutes les vingt secondes en plein service,
 * et un verrou trop prompt se transforme en code tapé cinquante fois
 * par jour, donc en code que tout le monde finit par connaître.
 */
const DELAIS: Partial<Record<Poste, number>> = {
  gestion: 3 * 60 * 1000,
  caisse: 8 * 60 * 1000,
  livreur: 15 * 60 * 1000,
}

export function delaiDuPoste(poste: Poste): number | null {
  return DELAIS[poste] ?? null
}

/** Les gestes qui comptent comme « quelqu'un est là ». */
const SIGNES = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function useVerrouInactivite(poste: Poste, actif: boolean) {
  const delai = delaiDuPoste(poste)
  const [verrouille, setVerrouille] = useState(false)
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const relancer = useCallback(() => {
    if (minuteur.current) clearTimeout(minuteur.current)
    if (!delai) return
    minuteur.current = setTimeout(() => setVerrouille(true), delai)
  }, [delai])

  useEffect(() => {
    if (!actif || !delai || verrouille) {
      if (minuteur.current) clearTimeout(minuteur.current)
      return
    }
    relancer()
    for (const signe of SIGNES) {
      window.addEventListener(signe, relancer, { passive: true })
    }

    /**
     * Revenir d'un autre onglet, ou rallumer la tablette, compte comme
     * une absence : on ne sait pas qui revient. C'est même le cas le
     * plus courant — on verrouille l'écran de la tablette et on la pose.
     */
    const auRetour = () => {
      if (document.visibilityState === 'visible') setVerrouille(true)
    }
    document.addEventListener('visibilitychange', auRetour)

    return () => {
      if (minuteur.current) clearTimeout(minuteur.current)
      for (const signe of SIGNES) window.removeEventListener(signe, relancer)
      document.removeEventListener('visibilitychange', auRetour)
    }
  }, [actif, delai, verrouille, relancer])

  const deverrouiller = useCallback(() => {
    setVerrouille(false)
    relancer()
  }, [relancer])

  return { verrouille, deverrouiller, delai }
}
