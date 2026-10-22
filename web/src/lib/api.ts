import { etablissementCourant } from './etablissement'
import type {
  Restaurant,
  AuditEntry,
  BoardEntry,
  CancelReason,
  CartLine,
  CashCount,
  CashSession,
  Category,
  DeliveryZone,
  DriverStats,
  Ingredient,
  NetProfitReport,
  InventoryLine,
  Order,
  PaymentMethod,
  PeakHours,
  PeriodComparison,
  ProductMargin,
  Product,
  ProductOption,
  RecipeLine,
  Role,
  Settings,
  TopProduct,
  User,
} from './types'

/**
 * Adresse du backend.
 *
 * Trois situations :
 * 1. `VITE_API_URL` renseigné — un serveur précis, utile pour tester depuis
 *    un téléphone sur le réseau local.
 * 2. Serveur de développement Vite (ports 5173 / 4173) — le backend écoute
 *    à côté, sur le port 4000.
 * 3. Partout ailleurs — l'interface est servie par le backend lui-même,
 *    donc la même origine. Y ajouter un port la rendrait injoignable.
 */
function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_URL as string | undefined
  if (configured) return configured.replace(/\/+$/, '')

  const { protocol, hostname, port, origin } = window.location
  if (port === '5173' || port === '4173') {
    return `${protocol}//${hostname}:4000`
  }
  return origin
}

export const API_BASE = resolveApiBase()

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

  /**
   * L'établissement de cet appareil accompagne chaque requête.
   *
   * La borne et l'écran de salle n'ont pas de session : sans ce repère,
   * le serveur ne sait pas lequel des fastfoods de l'installation leur
   * répondre, et il refuse plutôt que de deviner. Pour un poste connecté
   * le jeton fait foi de toute façon, donc l'envoyer ne coûte rien.
   */
  const etablissement = etablissementCourant()
  if (etablissement) headers['X-Restaurant'] = etablissement

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

export interface ProductInput {
  name: string
  price: number
  /** Temps de préparation annoncé, en minutes. */
  prepMinutes?: number
  categoryId: string
  description?: string | null
  /** Data URL réduite par le navigateur, ou null pour retirer la photo. */
  imageUrl?: string | null
  recipe?: RecipeLine[]
  options?: {
    kind: 'remove' | 'add'
    label: string
    extraPrice?: number
    ingredientId?: string | null
    quantityDelta?: number
  }[]
}

export const catalog = {
  /** Menu public : sans les plats retirés de la carte. */
  products: () => request<Product[]>('/products', { auth: false }),
  categories: () => request<Category[]>('/products/categories', { auth: false }),

  /**
   * Menu prêt à afficher, pour la borne, la caisse et le site.
   *
   * Les catégories sans aucun plat visible sont écartées : une catégorie
   * dont tous les plats ont été retirés de la carte reste en base, parce
   * que les tickets passés s'y rattachent, mais elle ne doit pas donner un
   * onglet vide au client.
   */
  menu: async () => {
    const [categories, products] = await Promise.all([
      catalog.categories(),
      catalog.products(),
    ])
    return {
      products,
      categories: categories.filter((c) =>
        products.some((p) => p.categoryId === c.id),
      ),
    }
  },

  /** Vue du gérant : tout, archives et recettes comprises. */
  all: () => request<Product[]>('/products/all'),

  createProduct: (body: ProductInput) =>
    request<Product>('/products', { method: 'POST', body }),
  updateProduct: (id: string, body: Partial<ProductInput> & { isAvailable?: boolean }) =>
    request<Product>(`/products/${id}`, { method: 'PUT', body }),
  /** Épuisé / de nouveau disponible. */
  toggleAvailable: (id: string) =>
    request<Product>(`/products/${id}/toggle-available`, { method: 'POST' }),
  /** Retire de la carte : supprime si jamais vendu, archive sinon. */
  removeProduct: (id: string) =>
    request<{ ok: true; deleted: boolean }>(`/products/${id}`, { method: 'DELETE' }),
  restoreProduct: (id: string) =>
    request<Product>(`/products/${id}/restore`, { method: 'POST' }),
  reorderProducts: (ids: string[]) =>
    request<{ ok: true }>('/products/reorder', { method: 'PUT', body: { ids } }),

  setRecipe: (id: string, recipe: RecipeLine[]) =>
    request<RecipeLine[]>(`/products/${id}/recipe`, { method: 'PUT', body: { recipe } }),

  createCategory: (name: string) =>
    request<Category>('/products/categories', { method: 'POST', body: { name } }),
  renameCategory: (id: string, name: string) =>
    request<Category>(`/products/categories/${id}`, { method: 'PUT', body: { name } }),
  deleteCategory: (id: string) =>
    request<{ ok: true }>(`/products/categories/${id}`, { method: 'DELETE' }),
  reorderCategories: (ids: string[]) =>
    request<Category[]>('/products/categories/reorder', { method: 'PUT', body: { ids } }),

  addOption: (
    productId: string,
    body: {
      kind: 'remove' | 'add'
      label: string
      extraPrice?: number
      ingredientId?: string | null
      quantityDelta?: number
      displayOrder?: number
    },
  ) => request<ProductOption>(`/products/${productId}/options`, { method: 'POST', body }),
  updateOption: (optionId: string, body: Partial<ProductOption>) =>
    request<ProductOption>(`/products/options/${optionId}`, { method: 'PUT', body }),
  deleteOption: (optionId: string) =>
    request<{ ok: true }>(`/products/options/${optionId}`, { method: 'DELETE' }),
}

/* ─────────── Commandes ─────────── */

/**
 * N'envoie que des identifiants : prix et intitulés sont relus en base par
 * le serveur, qui refuse tout choix ne figurant pas sur le plat.
 */
const toItemsPayload = (lines: CartLine[]) =>
  lines.map((l) => ({
    productId: l.product.id,
    quantity: l.quantity,
    optionIds: l.options.map((o) => o.id),
  }))

export const orders = {
  createFromKiosk: (lines: CartLine[], fulfillmentType: 'dine_in' | 'pickup') =>
    request<Order>('/orders/kiosk', {
      method: 'POST',
      body: { items: toItemsPayload(lines), fulfillmentType },
      auth: false,
    }),

  /** Prise de commande au comptoir, par le caissier. */
  createAtCounter: (
    lines: CartLine[],
    fulfillmentType: 'dine_in' | 'pickup',
    contact?: { customerName?: string; customerPhone?: string },
  ) =>
    request<Order>('/orders/counter', {
      method: 'POST',
      body: {
        items: toItemsPayload(lines),
        fulfillmentType,
        customerName: contact?.customerName,
        customerPhone: contact?.customerPhone,
      },
    }),

  createOnline: (
    lines: CartLine[],
    fulfillmentType: 'pickup' | 'delivery',
    extra?: {
      address?: string
      lat?: number
      lng?: number
      zoneId?: string
      customerName?: string
      customerPhone?: string
    },
  ) =>
    request<Order>('/orders/online', {
      method: 'POST',
      body: {
        items: toItemsPayload(lines),
        fulfillmentType,
        deliveryAddress: extra?.address,
        deliveryLat: extra?.lat,
        deliveryLng: extra?.lng,
        deliveryZoneId: extra?.zoneId,
        customerName: extra?.customerName,
        customerPhone: extra?.customerPhone,
      },
    }),

  pendingPayment: () => request<Order[]>('/orders/pending-payment'),
  pay: (id: string, paymentMethod: PaymentMethod) =>
    request<Order>(`/orders/${id}/pay`, { method: 'POST', body: { paymentMethod } }),

  kitchenQueue: () => request<Order[]>('/orders/kitchen/queue'),
  setKitchenStatus: (id: string, status: 'in_kitchen' | 'preparing' | 'ready') =>
    request<Order>(`/orders/${id}/kitchen-status`, { method: 'POST', body: { status } }),

  /**
   * Le jeton part s'il existe, mais son absence ne bloque pas : une
   * commande passee sans compte doit rester suivable par celui qui en
   * detient l'adresse. Le serveur refuse quand meme celles qui
   * appartiennent a un compte.
   */
  byId: (id: string) => request<Order>(`/orders/${id}`, { auth: true }),
  forCustomer: (customerId: string) => request<Order[]>(`/orders/customer/${customerId}`),

  /** Commandes de la journée : réimpression d'un reçu, rattrapage d'une erreur. */
  recent: () => request<Order[]>('/orders/recent'),

  /** Écran mural : lecture publique, numéros seulement. */
  board: () => request<BoardEntry[]>('/orders/board', { auth: false }),
  cancelReasons: () => request<CancelReason[]>('/orders/cancel-reasons'),

  /** Commandes garées, en attente du retour du client. */
  parked: () => request<Order[]>('/orders/parked'),
  park: (id: string, parked = true) =>
    request<Order>(`/orders/${id}/park`, { method: 'POST', body: { parked } }),

  discountOptions: () =>
    request<{ reasons: CancelReason[]; steps: number[]; cashierMaxPercent: number }>(
      '/orders/discount-reasons',
    ),
  applyDiscount: (id: string, percent: number, reason: string) =>
    request<Order>(`/orders/${id}/discount`, { method: 'POST', body: { percent, reason } }),
  clearDiscount: (id: string) =>
    request<Order>(`/orders/${id}/discount`, { method: 'DELETE' }),

  split: (id: string, parts: number) =>
    request<Order>(`/orders/${id}/split`, { method: 'POST', body: { parts } }),
  cancel: (id: string, reason: string) =>
    request<Order>(`/orders/${id}/cancel`, { method: 'POST', body: { reason } }),
}

/* ─────────── Caisse ─────────── */

export const cashier = {
  currentSession: () => request<CashSession | null>('/cashier/current'),
  open: (openingFloat: number) =>
    request<CashSession>('/cashier/open', { method: 'POST', body: { openingFloat } }),
  close: (closingAmount: number, breakdown?: CashCount) =>
    request<CashSession>('/cashier/close', {
      method: 'POST',
      body: { closingAmount, breakdown },
    }),
}

/* ─────────── Livraison ─────────── */

export const delivery = {
  available: () => request<Order[]>('/delivery/available'),
  /** La course assignée au livreur, s'il en a une. */
  mine: () => request<Order | null>('/delivery/mine'),
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
  wasteReasons: () => request<CancelReason[]>('/stock/waste-reasons'),
  declareWaste: (id: string, quantity: number, reason: string) =>
    request<Ingredient>(`/stock/${id}/waste`, {
      method: 'POST',
      body: { quantity, reason },
    }),
  inventory: (counts: { ingredientId: string; counted: number }[]) =>
    request<{ lines: InventoryLine[]; value: number; shortages: number }>(
      '/stock/inventory',
      { method: 'POST', body: { counts } },
    ),

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
  peakHours: (days = 7) => request<PeakHours>(`/reports/peak-hours?days=${days}`),
  margins: () => request<ProductMargin[]>('/reports/margins'),
  compare: (days = 7) => request<PeriodComparison>(`/reports/compare?days=${days}`),

  /**
   * Export comptable. Le téléchargement passe par un blob : le jeton est
   * dans l'en-tête, pas dans l'adresse, donc un simple lien ne suffirait pas.
   */
  exportCsv: async (from?: Date, to?: Date) => {
    const p = new URLSearchParams()
    if (from) p.set('from', from.toISOString())
    if (to) p.set('to', to.toISOString())
    const res = await fetch(`${API}/reports/export${p.toString() ? `?${p}` : ''}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
    })
    if (!res.ok) throw new ApiError('Export impossible.', res.status)
    return res.blob()
  },

  /** Registre des opérations sensibles, en lecture seule. */
  audit: (filters: { action?: string; limit?: number } = {}) => {
    const p = new URLSearchParams()
    if (filters.action) p.set('action', filters.action)
    if (filters.limit) p.set('limit', String(filters.limit))
    const q = p.toString()
    return request<AuditEntry[]>(`/reports/audit${q ? `?${q}` : ''}`)
  },
  lowStock: () => request<Ingredient[]>('/reports/low-stock'),
  cashSessions: () => request<CashSession[]>('/reports/cash-sessions'),
}

/* ─────────── Zones de livraison ─────────── */

export const zones = {
  list: () => request<DeliveryZone[]>('/zones', { auth: false }),
  all: () => request<DeliveryZone[]>('/zones/all'),
  create: (body: Partial<DeliveryZone>) =>
    request<DeliveryZone>('/zones', { method: 'POST', body }),
  update: (id: string, body: Partial<DeliveryZone>) =>
    request<DeliveryZone>(`/zones/${id}`, { method: 'PUT', body }),
  disable: (id: string) => request<{ ok: true }>(`/zones/${id}`, { method: 'DELETE' }),
}

/* ─────────── Réglages de l'établissement ─────────── */

export const settingsApi = {
  get: () => request<Settings>('/settings', { auth: false }),
  save: (patch: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PUT', body: patch }),
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

/**
 * Les établissements de l'installation.
 *
 * Réservé au super admin : c'est le seul rôle qui voit au-dessus des
 * cloisons. Un gérant administre son restaurant et ignore jusqu'à
 * l'existence des autres.
 */
export const restaurants = {
  list: () => request<Restaurant[]>('/restaurants'),
  create: (body: { name: string; slug?: string; notes?: string; logoUrl?: string }) =>
    request<Restaurant>('/restaurants', { method: 'POST', body }),
  update: (
    id: string,
    body: Partial<{ name: string; notes: string; logoUrl: string | null; isActive: boolean }>,
  ) => request<Restaurant>(`/restaurants/${id}`, { method: 'PATCH', body }),
}
