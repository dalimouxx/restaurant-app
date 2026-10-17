import type {
  CartLine,
  CashSession,
  Category,
  DriverStats,
  Ingredient,
  NetProfitReport,
  Order,
  PaymentMethod,
  Product,
  Role,
  TopProduct,
  User,
} from './types'

/**
 * Adresse du backend. En développement, `VITE_API_URL` dans un fichier
 * `.env` permet de pointer vers une autre machine sans toucher au code.
 */
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  `${window.location.protocol}//${window.location.hostname}:4000`

const API = `${API_BASE}/api`

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
  /** Un autre livreur a déjà pris la course. */
  get isTaken() {
    return this.status === 409
  }
  get isUnauthorized() {
    return this.status === 401
  }
}

const TOKEN_KEY = 'service.token'
const USER_KEY = 'service.user'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function storeSession(token: string, user: User) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* mode privé : la session vit le temps de l'onglet */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = options
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(
      'Serveur injoignable. Vérifiez que le backend est démarré.',
      0,
    )
  }

  if (!res.ok) {
    let message = `Erreur serveur (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      /* réponse sans corps JSON */
    }
    if (res.status === 401) clearSession()
    throw new ApiError(message, res.status)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/* ─────────── Authentification ─────────── */

interface AuthResponse {
  token: string
  user: User
}

export const auth = {
  health: () => request<{ status: string; time: string }>('/../health', { auth: false }),

  login: async (email: string, password: string) => {
    const r = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    })
    storeSession(r.token, r.user)
    return r.user
  },

  loginWithCode: async (loginCode: string) => {
    const r = await request<AuthResponse>('/auth/login-code', {
      method: 'POST',
      body: { loginCode },
      auth: false,
    })
    storeSession(r.token, r.user)
    return r.user
  },

  loginWithQr: async (qrToken: string) => {
    const r = await request<AuthResponse>('/auth/login-qr', {
      method: 'POST',
      body: { qrToken },
      auth: false,
    })
    storeSession(r.token, r.user)
    return r.user
  },

  registerCustomer: async (input: {
    fullName: string
    phone: string
    email?: string
    password?: string
  }) => {
    const r = await request<AuthResponse>('/auth/register-customer', {
      method: 'POST',
      body: input,
      auth: false,
    })
    storeSession(r.token, r.user)
    return r.user
  },
}

/* ─────────── Catalogue ─────────── */

export const catalog = {
  products: () => request<Product[]>('/products', { auth: false }),
  categories: () => request<Category[]>('/products/categories', { auth: false }),
  createProduct: (body: {
    name: string
    description?: string
    price: number
    categoryId: string
    imageUrl?: string
    recipe?: { ingredientId: string; quantityNeeded: number }[]
  }) => request<Product>('/products', { method: 'POST', body }),
  updateProduct: (id: string, body: Partial<Product>) =>
    request<Product>(`/products/${id}`, { method: 'PUT', body }),
}

/* ─────────── Commandes ─────────── */

const toItemsPayload = (lines: CartLine[]) =>
  lines.map((l) => ({
    productId: l.product.id,
    quantity: l.quantity,
    customization: l.customization,
  }))

export const orders = {
  createFromKiosk: (lines: CartLine[], fulfillmentType: 'dine_in' | 'pickup') =>
    request<Order>('/orders/kiosk', {
      method: 'POST',
      body: { items: toItemsPayload(lines), fulfillmentType },
      auth: false,
    }),

  createOnline: (
    lines: CartLine[],
    fulfillmentType: 'pickup' | 'delivery',
    delivery?: { address: string; lat?: number; lng?: number },
  ) =>
    request<Order>('/orders/online', {
      method: 'POST',
      body: {
        items: toItemsPayload(lines),
        fulfillmentType,
        deliveryAddress: delivery?.address,
        deliveryLat: delivery?.lat,
        deliveryLng: delivery?.lng,
      },
    }),

  pendingPayment: () => request<Order[]>('/orders/pending-payment'),
  pay: (id: string, paymentMethod: PaymentMethod) =>
    request<Order>(`/orders/${id}/pay`, { method: 'POST', body: { paymentMethod } }),

  kitchenQueue: () => request<Order[]>('/orders/kitchen/queue'),
  setKitchenStatus: (id: string, status: 'preparing' | 'ready') =>
    request<Order>(`/orders/${id}/kitchen-status`, { method: 'POST', body: { status } }),

  byId: (id: string) => request<Order>(`/orders/${id}`),
  forCustomer: (customerId: string) => request<Order[]>(`/orders/customer/${customerId}`),
}

/* ─────────── Caisse ─────────── */

export const cashier = {
  currentSession: () => request<CashSession | null>('/cashier/current'),
  open: (openingFloat: number) =>
    request<CashSession>('/cashier/open', { method: 'POST', body: { openingFloat } }),
  close: (closingAmount: number) =>
    request<CashSession>('/cashier/close', { method: 'POST', body: { closingAmount } }),
}

/* ─────────── Livraison ─────────── */

export const delivery = {
  available: () => request<Order[]>('/delivery/available'),
  accept: (id: string) => request<Order>(`/delivery/${id}/accept`, { method: 'POST' }),
  confirm: (id: string, qrToken: string) =>
    request<Order>(`/delivery/${id}/confirm-delivery`, { method: 'POST', body: { qrToken } }),
  pushLocation: (lat: number, lng: number) =>
    request<unknown>('/delivery/location', { method: 'POST', body: { lat, lng } }),
  addTip: (id: string, tipAmount: number) =>
    request<Order>(`/delivery/${id}/tip`, { method: 'POST', body: { tipAmount } }),
  myStats: () => request<DriverStats>('/delivery/my-stats'),
}

/* ─────────── Stock ─────────── */

export const stock = {
  list: () => request<Ingredient[]>('/stock'),
  create: (body: {
    name: string
    unit: string
    quantityInStock: number
    alertThreshold: number
    costPerUnit: number
    supplierName?: string
  }) => request<Ingredient>('/stock', { method: 'POST', body }),
  restock: (id: string, quantity: number, note: string) =>
    request<Ingredient>(`/stock/${id}/restock`, { method: 'POST', body: { quantity, note } }),
  adjust: (id: string, quantity: number, note: string, type = 'adjustment') =>
    request<Ingredient>(`/stock/${id}/adjust`, {
      method: 'POST',
      body: { quantity, note, type },
    }),
  movements: (id: string) =>
    request<
      { id: string; type: string; quantity: number; note?: string; createdAt: string }[]
    >(`/stock/${id}/movements`),
}

/* ─────────── Rapports ─────────── */

export const reports = {
  netProfit: (from?: Date, to?: Date) => {
    const p = new URLSearchParams()
    if (from) p.set('from', from.toISOString())
    if (to) p.set('to', to.toISOString())
    const q = p.toString()
    return request<NetProfitReport>(`/reports/net-profit${q ? `?${q}` : ''}`)
  },
  topProducts: () => request<TopProduct[]>('/reports/top-products'),
  lowStock: () => request<Ingredient[]>('/reports/low-stock'),
  cashSessions: () => request<CashSession[]>('/reports/cash-sessions'),
}

/* ─────────── Employés ─────────── */

export const users = {
  list: () => request<(User & { qrToken?: string; loginCode?: string })[]>('/users'),
  create: (body: {
    fullName: string
    role: Role
    phone?: string
    email?: string
    password?: string
    loginCode?: string
  }) => request<User & { qrToken: string }>('/users', { method: 'POST', body }),
  badge: (id: string) =>
    request<{ fullName: string; role: Role; qrImage: string }>(`/users/${id}/badge`),
  toggleActive: (id: string) =>
    request<User>(`/users/${id}/toggle-active`, { method: 'POST' }),
}
