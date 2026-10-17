import { create } from 'zustand'
import { clearSession, getStoredUser } from './api'
import type { CartLine, Product, User } from './types'

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
  add: (product: Product, customization?: Record<string, unknown>) => void
  increment: (index: number) => void
  decrement: (index: number) => void
  remove: (index: number) => void
  clear: () => void
  subtotal: () => number
  count: () => number
}

const sameLine = (a: CartLine, product: Product, custom: Record<string, unknown>) =>
  a.product.id === product.id && JSON.stringify(a.customization) === JSON.stringify(custom)

function createCart() {
  return create<CartState>((set, get) => ({
    lines: [],

    add: (product, customization = {}) =>
      set((s) => {
        const i = s.lines.findIndex((l) => sameLine(l, product, customization))
        if (i >= 0) {
          const lines = [...s.lines]
          lines[i] = { ...lines[i], quantity: lines[i].quantity + 1 }
          return { lines }
        }
        return { lines: [...s.lines, { product, quantity: 1, customization }] }
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

    subtotal: () => get().lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0),
    count: () => get().lines.reduce((sum, l) => sum + l.quantity, 0),
  }))
}

export const useKioskCart = createCart()
export const useCustomerCart = createCart()
