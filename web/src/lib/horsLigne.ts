import type { CartLine, Order } from './types'

/**
 * La caisse qui tient sans réseau.
 *
 * Une caisse ne choisit pas le moment où l'ADSL tombe. Elle tombe au
 * coup de feu, parce que c'est là qu'il y a du monde dans la rue et de
 * la charge sur la ligne. Un logiciel de caisse qui s'arrête à ce
 * moment-là ne se fait pas pardonner : le restaurateur ressort son
 * carnet, et il ne revient pas.
 *
 * **Trois choses à tenir, et seulement trois.**
 *
 * La carte, pour pouvoir composer une commande. Elle est recopiée ici à
 * chaque fois qu'on la reçoit du serveur.
 *
 * Des numéros, pour que le ticket du client en porte un. Ils sont
 * réservés d'avance auprès du serveur — jamais inventés : deux caisses
 * qui comptent chacune dans leur coin finiraient par servir deux
 * tickets « 42 » le même midi.
 *
 * Les ventes faites pendant la coupure, pour les rejouer au retour.
 * Chacune porte une référence tirée au sort à sa création, qui garantit
 * qu'elle n'aboutira qu'une fois même si l'envoi est rejoué dix fois.
 *
 * **Ce qu'on ne tient pas, et c'est délibéré.** Ouvrir ou clôturer une
 * caisse hors ligne, modifier la carte, consulter les chiffres :
 * refusé, et dit clairement. Une clôture calculée sur des données
 * partielles vaut moins que pas de clôture du tout — l'écart tomberait
 * sur le caissier, et personne ne saurait d'où il vient.
 */

const BASE = 'service.horsligne'
const CLE_POSTE = `${BASE}.poste`
const CLE_TRANCHE = `${BASE}.tranche`
const CLE_FILE = `${BASE}.file`
const CLE_CARTE = `${BASE}.carte`
const CLE_REGLAGES = `${BASE}.reglages`

/** En dessous, la caisse redemande une tranche tant qu'elle le peut. */
const RESTE_MINIMUM = 10

export interface VenteEnAttente {
  /** Tirée au sort à la création : elle rend l'envoi rejouable. */
  clientRef: string
  orderNumber: number
  /** L'heure réelle de la vente, pas celle du retour du réseau. */
  priseA: string
  fulfillmentType: 'dine_in' | 'pickup'
  items: { productId: string; quantity: number; optionIds: string[] }[]
  customerName?: string
  customerPhone?: string
  /** Ce qu'il faut pour réimprimer le ticket sans le serveur. */
  apercu: { nom: string; quantite: number; prixUnitaire: number }[]
  total: number

  /**
   * L'encaissement, quand il a eu lieu pendant la coupure.
   *
   * Il voyage avec la vente, dans la même requête. Les rejouer en deux
   * appels ouvrait une faille : si la création passait et que
   * l'encaissement échouait, la vente revenait « à encaisser » dans la
   * file — et le client, déjà parti, payait une seconde fois par le
   * suivant qui prenait son numéro.
   */
  paiement?: { methode: 'cash' | 'card' | 'transfer'; quand: string }
}

interface Tranche {
  orderDate: string
  depuis: number
  jusqua: number
  /** Prochain numéro libre dans la tranche. */
  prochain: number
}

/* ─────────────────────── Stockage ─────────────────────── */

function lire<T>(cle: string): T | null {
  try {
    const brut = localStorage.getItem(cle)
    return brut ? (JSON.parse(brut) as T) : null
  } catch {
    return null
  }
}

function ecrire(cle: string, valeur: unknown): boolean {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur))
    return true
  } catch {
    // Navigation privée, ou quota plein. L'appelant doit le savoir :
    // une vente qu'on croit mise de côté et qui ne l'est pas, c'est
    // une vente perdue sans que personne s'en aperçoive.
    return false
  }
}

/**
 * L'identifiant de cette tablette.
 *
 * Il désigne l'appareil et non la personne : c'est la tablette qui
 * travaille hors ligne, et elle garde ses numéros si le caissier change
 * en cours de service.
 */
export function poste(): string {
  let id = lire<string>(CLE_POSTE)
  if (!id) {
    id = `caisse-${Math.random().toString(36).slice(2, 10)}`
    ecrire(CLE_POSTE, id)
  }
  return id
}

/* ─────────────────────── La carte ─────────────────────── */

export function retenirLaCarte(carte: unknown) {
  ecrire(CLE_CARTE, { quand: Date.now(), carte })
}

export function carteRetenue<T>(): { quand: number; carte: T } | null {
  return lire<{ quand: number; carte: T }>(CLE_CARTE)
}

/* ─────────────────────── Les réglages ─────────────────────── */

/**
 * Le nom du restaurant, la monnaie, le déroulé du service.
 *
 * Le service worker fait démarrer l'application sans réseau, mais il ne
 * met jamais l'API en cache — et il a raison : un stock ou une file
 * périmés valent moins que rien. Les réglages, eux, ne changent pas
 * trois fois par jour. Sans eux, une tablette rechargée pendant une
 * coupure s'ouvre sur une caisse sans nom d'établissement, sans monnaie,
 * et incapable d'imprimer le moindre ticket.
 */
export function retenirLesReglages(reglages: unknown) {
  ecrire(CLE_REGLAGES, { quand: Date.now(), reglages })
}

export function reglagesRetenus<T>(): T | null {
  return lire<{ quand: number; reglages: T }>(CLE_REGLAGES)?.reglages ?? null
}

/* ─────────────────────── Les numéros ─────────────────────── */

export function trancheCourante(): Tranche | null {
  return lire<Tranche>(CLE_TRANCHE)
}

export function poserTranche(t: { orderDate: string; depuis: number; jusqua: number }) {
  ecrire(CLE_TRANCHE, { ...t, prochain: t.depuis })
}

/** Combien de numéros restent utilisables, aujourd'hui. */
export function numerosRestants(aujourdhui: string): number {
  const t = trancheCourante()
  // Une tranche de la veille ne vaut rien : les numéros repartent à 1
  // chaque journée de service, et ceux d'hier sont déjà servis.
  if (!t || t.orderDate !== aujourdhui) return 0
  return Math.max(0, t.jusqua - t.prochain + 1)
}

export function trancheABientotEpuisee(aujourdhui: string): boolean {
  return numerosRestants(aujourdhui) <= RESTE_MINIMUM
}

/**
 * Prend le prochain numéro de la tranche, et l'écarte.
 *
 * Rend `null` quand il n'en reste plus : la caisse doit alors refuser
 * la vente plutôt que d'inventer un numéro. C'est désagréable, et c'est
 * le moindre mal — un numéro inventé réapparaît au comptoir, sur le
 * ticket d'un autre client.
 */
export function prendreUnNumero(aujourdhui: string): number | null {
  const t = trancheCourante()
  if (!t || t.orderDate !== aujourdhui || t.prochain > t.jusqua) return null
  const numero = t.prochain
  return ecrire(CLE_TRANCHE, { ...t, prochain: numero + 1 }) ? numero : null
}

/* ─────────────────────── La file des ventes ─────────────────────── */

export function fileDAttente(): VenteEnAttente[] {
  return lire<VenteEnAttente[]>(CLE_FILE) ?? []
}

/**
 * Met une vente de côté.
 *
 * Rend `false` si le stockage refuse. L'appelant doit alors annoncer la
 * vente comme non enregistrée : une vente qu'on croit sauvée et qui ne
 * l'est pas disparaît sans bruit, et l'écart de caisse du soir est
 * inexplicable.
 */
export function mettreDeCote(vente: VenteEnAttente): boolean {
  const file = fileDAttente()
  file.push(vente)
  return ecrire(CLE_FILE, file)
}

export function retirerDeLaFile(clientRef: string) {
  ecrire(
    CLE_FILE,
    fileDAttente().filter((v) => v.clientRef !== clientRef),
  )
}

/* ─────────────────────── Composer une vente ─────────────────────── */

export function composerVente(
  lignes: CartLine[],
  fulfillmentType: 'dine_in' | 'pickup',
  orderNumber: number,
  contact?: { customerName?: string; customerPhone?: string },
  paiement?: VenteEnAttente['paiement'],
): VenteEnAttente {
  return {
    paiement,
    clientRef: reference(),
    orderNumber,
    priseA: new Date().toISOString(),
    fulfillmentType,
    items: lignes.map((l) => ({
      productId: l.product.id,
      quantity: l.quantity,
      optionIds: (l.options ?? []).map((o) => o.id),
    })),
    customerName: contact?.customerName,
    customerPhone: contact?.customerPhone,
    apercu: lignes.map((l) => ({
      nom: l.product.name,
      quantite: l.quantity,
      prixUnitaire: l.product.price + (l.options ?? []).reduce((s, o) => s + o.extraPrice, 0),
    })),
    total: lignes.reduce(
      (s, l) =>
        s +
        l.quantity * (l.product.price + (l.options ?? []).reduce((a, o) => a + o.extraPrice, 0)),
      0,
    ),
  }
}

/**
 * Une référence unique, tirée au sort.
 *
 * `crypto.randomUUID` n'existe pas sur les navigateurs anciens ni hors
 * HTTPS — et une caisse de fastfood tourne parfois sur une tablette
 * Android de 2019 branchée en HTTP sur le réseau local. On retombe donc
 * sur `getRandomValues`, puis sur `Math.random` : moins bon, mais une
 * vente sans référence vaut toujours mieux qu'une vente refusée.
 */
function reference(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const o = crypto.getRandomValues(new Uint8Array(16))
      o[6] = (o[6] & 0x0f) | 0x40
      o[8] = (o[8] & 0x3f) | 0x80
      const h = [...o].map((b) => b.toString(16).padStart(2, '0')).join('')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    }
  } catch {
    /* on retombe plus bas */
  }
  const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${r()}${r()}-${r()}-4${r().slice(1)}-a${r().slice(1)}-${r()}${r()}${r()}`
}

/* ─────────────────────── L'état du lien ─────────────────────── */

/**
 * Le navigateur dit « en ligne » dès qu'une carte réseau est active —
 * y compris branché sur un routeur qui ne mène nulle part, ce qui est
 * exactement ce qui arrive quand l'ADSL tombe. On ne s'y fie donc que
 * dans un sens : hors ligne veut dire hors ligne, en ligne ne veut rien
 * dire. C'est l'échec d'un vrai appel qui tranche.
 */
export function navigateurHorsLigne(): boolean {
  try {
    return navigator.onLine === false
  } catch {
    return false
  }
}

/** Une panne de réseau, par opposition à un refus du serveur. */
export function estUnePanneReseau(e: unknown): boolean {
  if (navigateurHorsLigne()) return true
  // `fetch` lève un TypeError quand la requête ne part pas du tout.
  return e instanceof TypeError
}

/**
 * Le ticket d'une vente hors ligne.
 *
 * Une caisse qui prend l'argent sans rien donner n'est pas une caisse.
 * Et le client a besoin de son numéro : c'est lui qui s'affichera sur
 * l'écran de salle quand son plat sera prêt. Sans papier, il doit le
 * retenir de tête au milieu du bruit.
 *
 * On reconstitue donc un reçu à partir de ce que la tablette a gardé.
 * Il porte tout ce qui compte pour le client — le numéro, les plats, le
 * total, le moyen de paiement — et se présente exactement comme les
 * autres : ce n'est pas le moment de lui faire remarquer qu'il y a eu
 * un incident technique.
 */
export function ticketDeSecours(vente: VenteEnAttente): Order {
  const lignes = vente.apercu.map((l, i) => ({
    id: `horsligne-${vente.clientRef}-${i}`,
    orderId: vente.clientRef,
    productId: '',
    productNameSnapshot: l.nom,
    quantity: l.quantite,
    unitPrice: l.prixUnitaire,
    customization: { removed: [], added: [] },
  }))

  return {
    id: vente.clientRef,
    orderNumber: vente.orderNumber,
    orderDate: vente.priseA.slice(0, 10),
    source: 'counter',
    fulfillmentType: vente.fulfillmentType,
    status: vente.paiement ? 'in_kitchen' : 'awaiting_payment',
    subtotal: vente.total,
    deliveryFee: 0,
    totalAmount: vente.total,
    discountAmount: 0,
    tipAmount: 0,
    paymentMethod: vente.paiement?.methode ?? null,
    createdAt: vente.priseA,
    items: lignes,
  } as unknown as Order
}

export type { Order }
