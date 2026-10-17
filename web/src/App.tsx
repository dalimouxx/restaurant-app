import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, type ReactNode } from 'react'
import { LayoutDashboard, Package, Receipt, Users, Wallet } from 'lucide-react'
import { Spinner, ToastHost } from './components/ui'
import { Shell, type NavItem } from './components/Shell'
import { useAuth } from './lib/store'
import type { Role } from './lib/types'
import LoginScreen, { HOME_BY_ROLE } from './screens/LoginScreen'
import PortalScreen from './screens/PortalScreen'
import KioskScreen from './screens/kiosk/KioskScreen'
import CashierScreen from './screens/cashier/CashierScreen'
import KitchenScreen from './screens/kitchen/KitchenScreen'
import CustomerScreen from './screens/customer/CustomerScreen'
import MyOrdersScreen from './screens/customer/MyOrdersScreen'

/**
 * Chargées à la demande : la carte (Leaflet) et les graphiques (Recharts)
 * pèsent lourd et ne concernent qu'une minorité d'écrans. Une borne ou une
 * caisse ne doit pas les télécharger pour rien.
 */
const TrackingScreen = lazy(() => import('./screens/customer/TrackingScreen'))
const DriverScreen = lazy(() => import('./screens/driver/DriverScreen'))
const FinancePage = lazy(() => import('./screens/manager/FinancePage'))
const StockPage = lazy(() => import('./screens/manager/StockPage'))
const TeamPage = lazy(() => import('./screens/manager/TeamPage'))
const CashSessionsPage = lazy(() => import('./screens/manager/CashSessionsPage'))

function Loading() {
  return (
    <div className="grid min-h-[50dvh] place-items-center">
      <Spinner />
    </div>
  )
}

const STAFF_PLUS = ['manager', 'admin', 'super_admin'] as const

/** Vérifie la session et le rôle avant d'ouvrir un poste. */
function Guard({
  allow,
  intent,
  children,
}: {
  allow: readonly Role[]
  intent?: 'cashier' | 'kitchen' | 'manager' | 'driver'
  children: ReactNode
}) {
  const user = useAuth((s) => s.user)
  const location = useLocation()

  if (!user) return <LoginScreen intent={intent} />

  // Connecté mais sur le mauvais poste : on renvoie chez soi plutôt que
  // d'afficher une impasse.
  if (!allow.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role]} replace state={{ from: location }} />
  }

  return <>{children}</>
}

/* Clients connectés : on exige seulement une session, quel que soit le rôle. */
function RequireSession({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user)
  if (!user) return <Navigate to="/commander" replace />
  return <>{children}</>
}

const MANAGER_NAV: NavItem[] = [
  { to: '/gestion', label: 'Finances', icon: LayoutDashboard, end: true },
  { to: '/gestion/stock', label: 'Stock', icon: Package },
  { to: '/gestion/equipe', label: 'Équipe', icon: Users },
  { to: '/gestion/caisses', label: 'Caisses', icon: Wallet },
]

function ManagerShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <Shell nav={MANAGER_NAV} title={title} subtitle={subtitle}>
      {children}
    </Shell>
  )
}

export default function App() {
  return (
    <ToastHost>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<PortalScreen />} />

          {/* Client */}
          <Route path="/commander" element={<CustomerScreen />} />
          <Route
            path="/commande/:id"
            element={
              <RequireSession>
                <TrackingScreen />
              </RequireSession>
            }
          />
          <Route
            path="/mes-commandes"
            element={
              <RequireSession>
                <MyOrdersScreen />
              </RequireSession>
            }
          />

          {/* Borne en libre-service : aucune connexion */}
          <Route path="/borne" element={<KioskScreen />} />

          {/* Caisse */}
          <Route
            path="/caisse"
            element={
              <Guard allow={['cashier', ...STAFF_PLUS]} intent="cashier">
                <Shell
                  nav={[{ to: '/caisse', label: 'Encaissement', icon: Receipt, end: true }]}
                  title="Encaissement"
                  subtitle="Une commande payée part aussitôt en cuisine"
                >
                  <CashierScreen />
                </Shell>
              </Guard>
            }
          />

          {/* Cuisine : plein écran, sans rail, pour tenir sur un moniteur mural */}
          <Route
            path="/cuisine"
            element={
              <Guard allow={['cook', ...STAFF_PLUS]} intent="kitchen">
                <KitchenScreen />
              </Guard>
            }
          />

          {/* Livreur : plein écran mobile */}
          <Route
            path="/livreur"
            element={
              <Guard allow={['driver', ...STAFF_PLUS]} intent="driver">
                <DriverScreen />
              </Guard>
            }
          />

          {/* Gestion */}
          <Route
            path="/gestion"
            element={
              <Guard allow={STAFF_PLUS} intent="manager">
                <ManagerShell
                  title="Finances"
                  subtitle="Ce qui entre, ce qui sort, ce qui reste"
                >
                  <FinancePage />
                </ManagerShell>
              </Guard>
            }
          />
          <Route
            path="/gestion/stock"
            element={
              <Guard allow={STAFF_PLUS} intent="manager">
                <ManagerShell
                  title="Stock"
                  subtitle="Déduit automatiquement à chaque vente"
                >
                  <StockPage />
                </ManagerShell>
              </Guard>
            }
          />
          <Route
            path="/gestion/equipe"
            element={
              <Guard allow={STAFF_PLUS} intent="manager">
                <ManagerShell
                  title="Équipe"
                  subtitle="Comptes, badges et accès"
                >
                  <TeamPage />
                </ManagerShell>
              </Guard>
            }
          />
          <Route
            path="/gestion/caisses"
            element={
              <Guard allow={STAFF_PLUS} intent="manager">
                <ManagerShell
                  title="Caisses"
                  subtitle="Ouvertures, clôtures et écarts"
                >
                  <CashSessionsPage />
                </ManagerShell>
              </Guard>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastHost>
  )
}
