import { io, type Socket } from 'socket.io-client'
import { API_BASE } from './api'

let socket: Socket | null = null

/** Connexion partagée : une seule par onglet, quel que soit le nombre d'écrans. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    })
  }
  return socket
}

/** Rejoint une salle et la quitte au démontage. */
export function joinRoom(room: string): () => void {
  const s = getSocket()
  const join = () => s.emit('join', room)
  join()
  s.on('connect', join)
  return () => {
    s.off('connect', join)
    s.emit('leave', room)
  }
}

/** Abonnement typé à un événement, avec désabonnement. */
export function on<T = unknown>(event: string, handler: (payload: T) => void): () => void {
  const s = getSocket()
  s.on(event, handler as (...args: unknown[]) => void)
  return () => s.off(event, handler as (...args: unknown[]) => void)
}

export function emitDriverLocation(payload: {
  driverId: string
  orderId: string
  lat: number
  lng: number
}) {
  getSocket().emit('driver:location', payload)
}
