import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { settingsApi } from '../lib/api'
import type { Order, Settings } from '../lib/types'
import { Ticket, type TicketKind } from './Ticket'

/**
 * Impression des tickets.
 *
 * Le ticket est monté dans un conteneur dédié, invisible à l'écran et seul
 * visible à l'impression. On passe par la boîte d'impression du navigateur :
 * elle sait parler à toute imprimante installée sur le poste, thermique
 * comprise, sans logiciel intermédiaire.
 */

interface PrintRequest {
  order: Order
  kind: TicketKind
  cashierName?: string
}

const PrintCtx = createContext<{
  print: (req: PrintRequest) => void
  settings: Settings | null
}>({ print: () => {}, settings: null })

export function usePrint() {
  return useContext(PrintCtx)
}

export function PrintHost({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [pending, setPending] = useState<PrintRequest | null>(null)

  useEffect(() => {
    settingsApi
      .get()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [])

  const print = useCallback((req: PrintRequest) => {
    setPending(req)
  }, [])

  // Laisse le ticket se peindre avant d'ouvrir la boîte d'impression,
  // sinon certains navigateurs impriment une page vide.
  useEffect(() => {
    if (!pending) return
    const id = requestAnimationFrame(() => {
      setTimeout(() => {
        window.print()
        setPending(null)
      }, 60)
    })
    return () => cancelAnimationFrame(id)
  }, [pending])

  const value = useMemo(() => ({ print, settings }), [print, settings])

  return (
    <PrintCtx.Provider value={value}>
      {children}
      {pending &&
        settings &&
        createPortal(
          <div className="print-area">
            <Ticket
              order={pending.order}
              settings={settings}
              kind={pending.kind}
              cashierName={pending.cashierName}
            />
          </div>,
          document.body,
        )}
    </PrintCtx.Provider>
  )
}
