import { io, type Socket } from 'socket.io-client'
import { API_BASE, getToken } from './api'

let socket: Socket | null = null
let socketToken: string | null = null

/**
 * Connexion partagée : une seule par onglet, quel que soit le nombre d'écrans.
 *
 * Le jeton part dès la poignée de main : le serveur refuse l'entrée dans
 * les salles — cuisine, caisse, gestion — à qui ne présente rien. Après une
 * connexion ou une déconnexion, le jeton a changé : on refait la connexion,
 * sinon elle resterait anonyme jusqu'au rechargement de la page.
 */
export function getSocket(): Socket {
  const token = getToken()

  if (socket && socketToken !== token) {
    socket.disconnect()
    socket = null
  }

  if (!socket) {
    socketToken = token
    // Même origine que l'API : le serveur temps réel est le même processus.
    socket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      auth: token ? { token } : undefined,
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
