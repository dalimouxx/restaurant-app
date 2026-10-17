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

export interface Product {
  id: string
  name: string
  description?: string | null
  price: number
  imageUrl?: string | null
  isAvailable: boolean
  categoryId: string
  Category?: Category
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

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  productNameSnapshot: string
  unitPrice: number
  quantity: number
  customization: Record<string, unknown>
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

/** Article du panier, côté client uniquement. */
export interface CartLine {
  product: Product
  quantity: number
  customization: Record<string, unknown>
}
