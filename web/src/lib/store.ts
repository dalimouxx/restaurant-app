import { create } from 'zustand'
import { clearSession, getStoredUser } from './api'
import type { CartLine, Product, ProductOption, User } from './types'

/* ───────────────────────── Session ───────────────────────── */

interface AuthState {
  user: User | null
  setUser: (user: User | null) => void
  logout: () => void
}

export const useAuth = create<AuthState>((set) => ({
  user: getStoredUser(),
  setUser: (user) => set({ user }),
  logout: () => {
    clearSession()
    set({ user: null })
  },
}))

/* ───────────────────────── Panier ───────────────────────── */

/**
 * Deux paniers coexistent : la borne (anonyme, remis à zéro après
 * chaque commande) et le client connecté. Ils ne doivent pas se mélanger,
 * d'où une fabrique plutôt qu'un store unique.
 */
interface CartState {
  lines: CartLine[]
  add: (product: Product, options?: ProductOption[]) => void
  increment: (index: number) => void
  decrement: (index: number) => void
  remove: (index: number) => void
  clear: () => void
  subtotal: () => number
  count: () => number
}

/** Prix d'une ligne : le plat plus ses suppléments. */
export function lineUnitPrice(line: CartLine): number {
  return line.product.price + line.options.reduce((s, o) => s + o.extraPrice, 0)
}

/** Deux lignes fusionnent si c'est le même plat avec exactement les mêmes choix. */
function sameLine(a: CartLine, product: Product, options: ProductOption[]) {
  if (a.product.id !== product.id) return false
  if (a.options.length !== options.length) return false
  const ids = new Set(a.options.map((o) => o.id))
  return options.every((o) => ids.has(o.id))
}

function createCart() {
  return create<CartState>((set, get) => ({
    lines: [],

    add: (product, options = []) =>
      set((s) => {
        const i = s.lines.findIndex((l) => sameLine(l, product, options))
        if (i >= 0) {
          const lines = [...s.lines]
          lines[i] = { ...lines[i], quantity: lines[i].quantity + 1 }
          return { lines }
        }
        return { lines: [...s.lines, { product, quantity: 1, options }] }
      }),

    increment: (index) =>
      set((s) => {
        const lines = [...s.lines]
        lines[index] = { ...lines[index], quantity: lines[index].quantity + 1 }
        return { lines }
      }),

    decrement: (index) =>
      set((s) => {
        const lines = [...s.lines]
        if (lines[index].quantity > 1) {
          lines[index] = { ...lines[index], quantity: lines[index].quantity - 1 }
        } else {
          lines.splice(index, 1)
        }
        return { lines }
      }),

    remove: (index) =>
      set((s) => {
        const lines = [...s.lines]
        lines.splice(index, 1)
        return { lines }
      }),

    clear: () => set({ lines: [] }),

    subtotal: () =>
      get().lines.reduce((sum, l) => sum + lineUnitPrice(l) * l.quantity, 0),
    count: () => get().lines.reduce((sum, l) => sum + l.quantity, 0),
  }))
}

export const useKioskCart = createCart()
export const useCustomerCart = createCart()
