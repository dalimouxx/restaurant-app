/**
 * Installation sur téléphone et tablette.
 *
 * Chaque poste a son propre manifeste : installée depuis la caisse,
 * l'application s'ouvre sur la caisse, avec son nom et son icône à elle.
 * Android et iOS la traitent alors comme une application distincte, ce qui
 * est exactement ce qu'on veut — un même téléphone peut porter la borne et
 * la cuisine côte à côte.
 */

export type Poste = 'client' | 'borne' | 'caisse' | 'cuisine' | 'ecran' | 'livreur' | 'gestion'

export const POSTE_LABELS: Record<Poste, string> = {
  client: 'Commander',
  borne: 'Borne',
  caisse: 'Caisse',
  cuisine: 'Cuisine',
  ecran: 'Écran de salle',
  livreur: 'Livreur',
  gestion: 'Gestion',
}

/** Quel poste correspond à l'adresse affichée. */
export function posteFor(pathname: string): Poste {
  if (pathname.startsWith('/borne')) return 'borne'
  if (pathname.startsWith('/caisse')) return 'caisse'
  if (pathname.startsWith('/cuisine')) return 'cuisine'
  if (pathname.startsWith('/ecran')) return 'ecran'
  if (pathname.startsWith('/livreur')) return 'livreur'
  if (pathname.startsWith('/gestion')) return 'gestion'
  return 'client'
}

/** Pointe la balise manifest vers le poste courant. */
export function applyManifest(poste: Poste) {
  try {
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'manifest'
      document.head.appendChild(link)
    }
    const href = `/manifest-${poste}.webmanifest`
    if (!link.href.endsWith(href)) link.href = href
  } catch {
    /* un navigateur sans manifeste reste parfaitement utilisable */
  }
}

/** Déjà installée et lancée depuis l'écran d'accueil ? */
export function estInstallee(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

/**
 * iOS ne propose aucune invite : l'ajout se fait à la main depuis le menu
 * de partage. Il faut donc l'expliquer, au lieu d'attendre un événement
 * qui ne viendra jamais.
 */
export function estIOS(): boolean {
  try {
    const ua = navigator.userAgent
    return /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1)
  } catch {
    return false
  }
}

export interface InvitePromptable {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Enregistre le service worker : sans lui, pas d'installation possible. */
export function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  // En développement, le serveur Vite ne sert pas /sw.js : inutile d'essayer.
  if (location.port === '5173') return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* refusé en navigation privée ou sans HTTPS : sans conséquence */
    })
  })
}
