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

/** L'adresse propre d'un poste : celle qu'il faut charger pour l'installer. */
export const CHEMIN_POSTE: Record<Poste, string> = {
  client: '/commander',
  borne: '/borne',
  caisse: '/caisse',
  cuisine: '/cuisine',
  ecran: '/ecran',
  livreur: '/livreur',
  gestion: '/gestion',
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

/**
 * Le poste pour lequel la page a ete CHARGEE, et non celui qu'on
 * regarde.
 *
 * C'est toute la difference, et elle expliquait le defaut. Le
 * navigateur decide de ce qu'il installera au chargement de la page,
 * d'apres le manifeste present a ce moment-la. Un gerant qui arrive par
 * la vitrine puis navigue vers la gestion voit bien « Installer
 * Gestion » a l'ecran — mais le navigateur, lui, tient toujours
 * l'application cliente, et c'est elle qu'il installe.
 *
 * On retient donc le poste du chargement, une fois pour toutes. Tant
 * qu'il differe de celui qu'on regarde, aucune invitation capturee
 * n'est valable.
 */
const POSTE_AU_CHARGEMENT: Poste = (() => {
  try {
    return posteFor(location.pathname)
  } catch {
    return 'client'
  }
})()

export function posteDuChargement(): Poste {
  return POSTE_AU_CHARGEMENT
}

/**
 * Recharger a l'adresse du poste pour pouvoir l'installer.
 *
 * Le navigateur ne revient pas sur sa decision en cours de route : il
 * faut lui presenter une page neuve, dont le manifeste est le bon des
 * le premier octet. On note au passage qu'une installation est en
 * cours, pour la reprendre aussitot la page revenue — sinon le gerant
 * appuie sur « Installer », la page se recharge, et il ne se passe
 * plus rien.
 */
const CLE_REPRISE = 'service.install.reprise'

export function rechargerPourInstaller(poste: Poste) {
  try {
    sessionStorage.setItem(CLE_REPRISE, poste)
  } catch {
    /* navigation privee : l'invitation reviendra d'elle-meme */
  }
  location.assign(CHEMIN_POSTE[poste] + location.search)
}

/** Une installation etait-elle en cours avant ce rechargement ? */
export function installationAReprendre(poste: Poste): boolean {
  try {
    const attendu = sessionStorage.getItem(CLE_REPRISE)
    if (attendu !== poste) return false
    sessionStorage.removeItem(CLE_REPRISE)
    return true
  } catch {
    return false
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

/**
 * L'invitation du navigateur, captee au plus tot et une seule fois.
 *
 * `beforeinstallprompt` ne se declenche qu'une fois par chargement, et
 * tot. Le capter dans un composant, c'est dependre du moment ou ce
 * composant est monte — et le manquer des que l'ecran est un peu lent.
 * On ecoute donc ici, des l'import, avant que React n'existe.
 *
 * Cela sert aussi a repondre a une question qu'on ne peut pas poser
 * autrement : ce navigateur sait-il installer une application ? Sans
 * invitation captee, on ne propose rien — mieux vaut se taire que
 * promettre un bouton qui ne fera rien.
 */
let inviteCaptee: InvitePromptableInterne | null = null
const auditeurs = new Set<() => void>()

interface InvitePromptableInterne {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

try {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    inviteCaptee = e as unknown as InvitePromptableInterne
    auditeurs.forEach((f) => f())
  })
} catch {
  /* hors navigateur : rien a capter */
}

export function inviteDisponible(): InvitePromptable | null {
  return inviteCaptee
}

/** Previent quand l'invitation arrive, puisqu'elle arrive apres coup. */
export function surInvite(f: () => void): () => void {
  auditeurs.add(f)
  return () => auditeurs.delete(f)
}

/** Une invitation consommee ne vaut plus : le navigateur n'en redonne pas. */
export function oublierInvite() {
  inviteCaptee = null
  auditeurs.forEach((f) => f())
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
