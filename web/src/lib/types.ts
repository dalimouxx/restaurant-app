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
  displayOrder: number
}

/** Choix prédéfini d'un plat : rien n'est saisi à la main. */
export interface ProductOption {
  id: string
  kind: 'remove' | 'add'
  label: string
  extraPrice: number
  displayOrder?: number
}

export interface Product {
  id: string
  name: string
  description?: string | null
  price: number
  imageUrl?: string | null
  isAvailable: boolean
  categoryId: string
  Category?: Category
  options?: ProductOption[]
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
  /** Prix du plat, suppléments compris. */
  unitPrice: number
  quantity: number
  customization: ItemCustomization
}

export interface Order {
  id: string
  orderNumber: number
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
  createdAt: string
  updatedAt: string
  items?: OrderItem[]
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
}

export interface NetProfitReport {
  totalRevenue: number
  ingredientCost: number
  driverPayout: number
  netProfit: number
  ordersCount: number
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

/** Article du panier, côté navigateur uniquement. */
export interface CartLine {
  product: Product
  quantity: number
  /** Choix retenus. Le serveur recalcule prix et intitulés à partir d'eux. */
  options: ProductOption[]
}
