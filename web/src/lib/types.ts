export type Role =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'cook'
  | 'driver'
  | 'customer'

export type OrderStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'in_kitchen'
  | 'preparing'
  | 'ready'
  | 'awaiting_driver'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled'

export type FulfillmentType = 'dine_in' | 'pickup' | 'delivery'
export type OrderSource = 'kiosk' | 'counter' | 'online'
export type PaymentMethod = 'cash' | 'card' | 'cash_on_delivery'

export interface User {
  id: string
  fullName: string
  role: Role
  phone?: string | null
  email?: string | null
  isActive: boolean
}

export interface Category {
  id: string
  name: string
  /** Nom arabe, facultatif : vide, la carte arabe garde le nom d'origine. */
  nameAr?: string | null
  displayOrder: number
}

/** Choix prédéfini d'un plat : rien n'est saisi à la main. */
export interface ProductOption {
  id: string
  kind: 'remove' | 'add'
  label: string
  extraPrice: number
  displayOrder?: number
  /** Ingrédient à bouger en stock quand le choix est retenu. */
  ingredientId?: string | null
  quantityDelta?: number
}

/** Une ligne de recette : ce qu'un plat consomme par unité vendue. */
export interface RecipeLine {
  ingredientId: string
  quantityNeeded: number
}

export interface Product {
  id: string
  name: string
  description?: string | null
  /** Nom et description en arabe, facultatifs. Vides, l'original tient. */
  nameAr?: string | null
  descriptionAr?: string | null
  price: number
  imageUrl?: string | null
  /** Épuisé pour aujourd'hui — réversible d'un geste. */
  isAvailable: boolean
  /** Retiré de la carte. Absent du menu public. */
  isArchived?: boolean
  displayOrder?: number
  categoryId: string
  Category?: Category
  options?: ProductOption[]
  /** Temps de préparation annoncé, en minutes. */
  prepMinutes?: number
  /** Fournie seulement par la vue du gérant. */
  recipe?: RecipeLine[]
}

export interface Ingredient {
  id: string
  name: string
  unit: 'g' | 'kg' | 'ml' | 'l' | 'piece'
  quantityInStock: number
  alertThreshold: number
  costPerUnit: number
  supplierName?: string | null
  isLow?: boolean
}

/** Ce que la cuisine doit lire, figé au moment de la commande. */
export interface ItemCustomization {
  removed?: { id: string; label: string }[]
  added?: { id: string; label: string; price: number }[]
}

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  productNameSnapshot: string
  /** Figé à la commande : la recette peut changer, le ticket non. */
  prepMinutes?: number
  /** Prix du plat, suppléments compris. */
  unitPrice: number
  quantity: number
  customization: ItemCustomization
}

/** Motif d'annulation prédéfini : le caissier choisit, il n'écrit pas. */
export interface CancelReason {
  code: string
  label: string
}

/** Une ligne du registre des opérations sensibles. */
export interface AuditEntry {
  id: string
  userId?: string | null
  userName: string
  userRole: string
  action: string
  entityType?: string | null
  entityId?: string | null
  summary: string
  details?: Record<string, unknown> | null
  createdAt: string
}

export interface Order {
  id: string
  orderNumber: number
  /** Journée commerciale : le numéro repart à 1 chaque matin. */
  orderDate?: string | null
  source: OrderSource
  fulfillmentType: FulfillmentType
  status: OrderStatus
  customerId?: string | null
  cashierId?: string | null
  driverId?: string | null
  subtotal: number
  deliveryFee: number
  tipAmount: number
  totalAmount: number
  paymentMethod?: PaymentMethod | null
  paidAt?: string | null
  deliveryAddress?: string | null
  deliveryLat?: number | null
  deliveryLng?: number | null
  qrToken?: string | null
  customerName?: string | null
  customerPhone?: string | null
  deliveryZoneId?: string | null
  discountAmount?: number
  discountReason?: string | null
  isParked?: boolean
  splitCount?: number
  splitPaidCount?: number
  splitPayments?: { method: PaymentMethod; amount: number; at: string }[] | null
  cancelReason?: string | null
  cancelledById?: string | null
  cancelledAt?: string | null
  createdAt: string
  updatedAt: string
  items?: OrderItem[]
}

/** Coupures tunisiennes, pour le comptage de clôture. */
export interface CashCount {
  [denomination: string]: number
}

export interface CashSession {
  id: string
  cashierId: string
  openingFloat: number
  closingAmount?: number | null
  expectedAmount?: number | null
  discrepancy?: number | null
  isOpen: boolean
  openedAt: string
  closedAt?: string | null
  countBreakdown?: CashCount | null
}

export interface NetProfitReport {
  totalRevenue: number
  totalDiscounts?: number
  ingredientCost: number
  wasteCost?: number
  driverPayout: number
  netProfit: number
  ordersCount: number
}

/** Une heure de service, avec ce qu'elle a produit. */
export interface PeakHour {
  hour: number
  orders: number
  revenue: number
}

export interface PeakHours {
  days: number
  hours: PeakHour[]
  busiest: PeakHour | null
}

/** Ce que rapporte un plat, une fois ses ingrédients payés. */
export interface ProductMargin {
  id: string
  name: string
  price: number
  cost: number
  margin: number
  marginPercent: number
  hasRecipe: boolean
  soldCount: number
  totalMargin: number
}

/** Comparaison avec la période précédente. */
export interface PeriodComparison {
  days: number
  current: { orders: number; revenue: number; averageTicket: number }
  previous: { orders: number; revenue: number; averageTicket: number }
  change: {
    revenue: number | null
    orders: number | null
    averageTicket: number | null
  }
}

/** Une ligne d'inventaire physique : théorique contre compté. */
export interface InventoryLine {
  ingredientId: string
  name: string
  unit: string
  expected: number
  counted: number
  gap: number
  value: number
}

export interface TopProduct {
  name: string
  quantitySold: number
  revenue: number
}

export interface DriverStats {
  commissionPercent: number
  totalCollected: number
  totalDriverEarnings: number
  totalTips: number
  deliveriesCount: number
  orders: {
    orderId: string
    orderNumber: number
    totalAmount: number
    deliveryFee: number
    tip: number
    driverEarning: number
    date: string
  }[]
}

/** Horaires d'un jour. Une fermeture avant l'ouverture passe minuit. */
export interface DayHours {
  open: string
  close: string
  closed: boolean
}

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/** État d'ouverture calculé par le serveur : personne ne le refait. */
export interface OpeningState {
  open: boolean
  opensAt: string | null
  opensDay?: string | null
  dayLabel?: string
}

/** Informations de l'établissement, imprimées sur les tickets. */
export interface Settings {
  restaurantName: string
  address: string
  phone: string
  taxId: string
  ticketFooter: string
  currency: string
  /** Fond de carte du suivi : adresse des tuiles du fournisseur, clé comprise. */
  mapTileUrl: string
  mapAttribution: string
  /** Déroulé du service, réglable en plein coup de feu. */
  etapesCuisine: 'deux' | 'une' | 'aucune'
  livraisonActive: 'oui' | 'non'
  caisseSimplifiee: 'oui' | 'non'
  commandeSansCompte: 'oui' | 'non'
  /** Où part une commande passée en ligne ou en scannant le code de table. */
  commandesEnLigne: 'caisse' | 'cuisine'
  openingHours: Record<WeekDay, DayHours>
  opening: OpeningState
  /** L'établissement servi : logo, et repère pour le code à scanner. */
  etablissement: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
  } | null
}

/** Zone de livraison : un quartier, un tarif. */
export interface DeliveryZone {
  id: string
  name: string
  fee: number
  minimumOrder: number
  estimatedMinutes: number
  isActive: boolean
  displayOrder: number
}

/** Ligne de l'écran mural : rien que le numéro et son état. */
export interface BoardEntry {
  orderNumber: number
  status: OrderStatus
  since: string
}

/** Article du panier, côté navigateur uniquement. */
export interface CartLine {
  product: Product
  quantity: number
  /** Choix retenus. Le serveur recalcule prix et intitulés à partir d'eux. */
  options: ProductOption[]
}

/**
 * Un établissement de l'installation, vu par le super admin.
 *
 * Les deux compteurs ne sont pas décoratifs : avec trente fastfoods, ils
 * sont le seul moyen de repérer d'un coup d'œil celui qui ne travaille
 * plus — zéro employé, zéro commande — et celui qu'il ne faut surtout
 * pas suspendre en plein service.
 */
export interface Restaurant {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  isActive: boolean
  notes: string | null
  createdAt: string
  employes: number
  commandesEnCours: number
}
