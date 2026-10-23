import type { FulfillmentType, OrderSource, OrderStatus, Role } from './types'

/** Montants en dinar tunisien, 3 décimales en usage local arrondi à 2 pour l'affichage. */
export function money(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  return n.toLocaleString('fr-TN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function moneyDT(value: number | null | undefined): string {
  return `${money(value)} DT`
}

export function orderNo(n: number): string {
  return `#${String(n).padStart(3, '0')}`
}

/** La journée commerciale d'aujourd'hui, au fuseau du restaurant. */
export function journeeDuJour(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Ce ticket vient-il d'un service precedent ?
 *
 * Les numeros repartent a 1 chaque journee commerciale. Un ticket pris
 * a 23 h 50 reste en cuisine apres minuit, et peut donc porter le meme
 * numero qu'un ticket du jour. Le cuisinier a besoin de les distinguer
 * d'un coup d'oeil — d'ou la mention « hier » a cote du numero, plutot
 * que de masquer le plus ancien : le plat, lui, est bien reel.
 */
export function vientDeLaVeille(orderDate?: string | null): boolean {
  if (!orderDate) return false
  // Une date seule (AAAA-MM-JJ) se compare telle quelle ; un horodatage
  // complet doit d'abord etre ramene au fuseau du restaurant, sinon une
  // caisse ouverte a 23 h paraitrait dater de la veille.
  const jour = orderDate.length === 10
    ? orderDate
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Tunis',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(orderDate))
  return jour !== journeeDuJour()
}

/** « mercredi 22 octobre » — pour nommer un jour sans ambiguite. */
export function dateLongue(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    timeZone: 'Africa/Tunis',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/**
 * L'heure seule aujourd'hui, la date et l'heure sinon.
 *
 * « Ouverte a 14:32 » se lit comme aujourd'hui, quel que soit le jour
 * ou la caisse a reellement ete ouverte.
 */
export function dateEtHeure(iso: string): string {
  return vientDeLaVeille(iso)
    ? `le ${dateLongue(iso)} à ${timeShort(iso)}`
    : `à ${timeShort(iso)}`
}

export function timeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** « il y a 4 min » — utilisé pour l'âge d'un ticket en cuisine. */
export function elapsed(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${String(min % 60).padStart(2, '0')}`
}

export function elapsedMinutes(iso: string, now = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 60000)
}

export const statusLabel: Record<OrderStatus, string> = {
  awaiting_payment: 'À encaisser',
  paid: 'Payée',
  in_kitchen: 'Envoyée en cuisine',
  preparing: 'En préparation',
  ready: 'Prête',
  awaiting_driver: 'Attend un livreur',
  out_for_delivery: 'En livraison',
  delivered: 'Livrée',
  completed: 'Terminée',
  cancelled: 'Annulée',
}

export const fulfillmentLabel: Record<FulfillmentType, string> = {
  dine_in: 'Sur place',
  pickup: 'À emporter',
  delivery: 'Livraison',
}

export const sourceLabel: Record<OrderSource, string> = {
  kiosk: 'Borne',
  counter: 'Comptoir',
  online: 'En ligne',
}

export const roleLabel: Record<Role, string> = {
  super_admin: 'Super admin',
  admin: 'Administrateur',
  manager: 'Gérant',
  cashier: 'Caissier',
  cook: 'Cuisinier',
  driver: 'Livreur',
  customer: 'Client',
}

/** Étapes visibles par le client, selon le mode de réception. */
export function trackingSteps(fulfillment: FulfillmentType): string[] {
  return fulfillment === 'delivery'
    ? ['Reçue', 'En cuisine', 'Préparation', 'Prête', 'En livraison', 'Livrée']
    : ['Reçue', 'En cuisine', 'Préparation', 'Prête à récupérer']
}

export function trackingIndex(status: OrderStatus): number {
  const order: OrderStatus[] = [
    'awaiting_payment',
    'in_kitchen',
    'preparing',
    'ready',
    'out_for_delivery',
    'delivered',
  ]
  if (status === 'awaiting_driver') return 3
  if (status === 'completed') return order.length - 1
  const i = order.indexOf(status)
  return i < 0 ? 0 : i
}

/** Distance à vol d'oiseau en km (Haversine). */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
