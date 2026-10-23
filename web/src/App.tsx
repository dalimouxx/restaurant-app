import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react'
import {
  Building2,
  LayoutDashboard,
  Package,
  Receipt,
  ScrollText,
  Settings,
  UtensilsCrossed,
  Users,
  Wallet,
} from 'lucide-react'
import { Spinner, ToastHost } from './components/ui'
import { PrintHost } from './components/PrintHost'
import { InstallBanner } from './components/InstallBanner'
import { Shell, type NavItem } from './components/Shell'
import { useAuth } from './lib/store'
import { quandLaSessionFinit } from './lib/api'
import type { Role } from './lib/types'
import LoginScreen from './screens/LoginScreen'
import PortalScreen from './screens/PortalScreen'
import LandingScreen from './screens/LandingScreen'
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

/** Combien de fois on a déjà rechargé pour cause de mise à jour. */
const CLE_RECHARGE = 'service.rechargeApresMaj'

/**
 * Un écran qui survit à une mise à jour du serveur.
 *
 * Chaque déploiement renomme les fichiers de l'application — c'est ce
 * qui permet au navigateur de les garder en cache sans jamais servir
 * une version périmée. Mais un client qui avait la page ouverte garde
 * l'ancienne liste de noms : au moment où il touche « Suivre », le
 * fichier demandé n'existe plus, et il reçoit un écran blanc. Au milieu
 * d'une commande.
 *
 * On recharge donc la page une fois, ce qui va rechercher la nouvelle
 * liste et reprend là où il en était. **Une seule fois** : si le
 * chargement échoue encore, c'est que le réseau est coupé ou le serveur
 * à terre, et une boucle de rechargements rendrait le téléphone
 * inutilisable sans rien réparer.
 */
function aLaDemande<T extends { default: ComponentType<unknown> }>(
  charger: () => Promise<T>,
) {
  return lazy(() =>
    charger().catch((err) => {
      let dejaFait = false
      try {
        dejaFait = sessionStorage.getItem(CLE_RECHARGE) === 'oui'
        sessionStorage.setItem(CLE_RECHARGE, 'oui')
      } catch {
        /* navigation privée : on tente quand même, une fois */
      }
      if (!dejaFait) {
        window.location.reload()
        // La page s'en va : on rend une promesse qui ne se résout pas,
        // plutôt qu'une erreur qui ferait clignoter un écran mort.
        return new Promise<T>(() => {})
      }
      throw err
    }),
  )
}

const TrackingScreen = aLaDemande(() => import('./screens/customer/TrackingScreen'))
const DriverScreen = aLaDemande(() => import('./screens/driver/DriverScreen'))
const FinancePage = aLaDemande(() => import('./screens/manager/FinancePage'))
const RestaurantsPage = aLaDemande(() => import('./screens/admin/RestaurantsPage'))
const StockPage = aLaDemande(() => import('./screens/manager/StockPage'))
const TeamPage = aLaDemande(() => import('./screens/manager/TeamPage'))
const CashSessionsPage = aLaDemande(() => import('./screens/manager/CashSessionsPage'))
const SettingsPage = aLaDemande(() => import('./screens/manager/SettingsPage'))
const MenuPage = aLaDemande(() => import('./screens/manager/MenuPage'))
const JournalPage = aLaDemande(() => import('./screens/manager/JournalPage'))
const BoardScreen = aLaDemande(() => import('./screens/board/BoardScreen'))

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

  if (!user) return <LoginScreen intent={intent} allow={allow} />

  /**
   * Connecté, mais ce compte n'a pas accès à ce poste — le cas courant est
   * un client qui a commandé en ligne sur l'appareil, puis un employé qui
   * ouvre la caisse. Rediriger vers l'accueil donnait l'impression que le
   * lien ne marchait pas : on affiche l'écran de connexion en expliquant.
   */
  if (!allow.includes(user.role)) {
    return <LoginScreen intent={intent} signedInAs={user} />
  }

  return <>{children}</>
}

/* Clients connectés : on exige seulement une session, quel que soit le rôle. */
function RequireSession({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user)
  if (!user) return <Navigate to="/commander" replace />
  return <>{children}</>
}

/**
 * L'entree « Établissements » n'apparait que pour le super admin.
 *
 * Un gerant administre son restaurant et ignore jusqu'a l'existence des
 * autres : lui montrer une porte qui se referme sur un refus serait
 * doublement inutile.
 */
function navDuRole(role: string | undefined): NavItem[] {
  const base = MANAGER_NAV
  if (role === 'super_admin' || role === 'admin') {
    return [
      { to: '/gestion/etablissements', label: 'Établissements', icon: Building2 },
      ...base,
    ]
  }
  return base
}

const MANAGER_NAV: NavItem[] = [
  { to: '/gestion', label: 'Finances', icon: LayoutDashboard, end: true },
  { to: '/gestion/carte', label: 'Carte', icon: UtensilsCrossed },
  { to: '/gestion/stock', label: 'Stock', icon: Package },
  { to: '/gestion/equipe', label: 'Équipe', icon: Users },
  { to: '/gestion/caisses', label: 'Caisses', icon: Wallet },
  { to: '/gestion/journal', label: 'Journal', icon: ScrollText },
  { to: '/gestion/reglages', label: 'Réglages', icon: Settings },
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
    <Shell nav={navDuRole(useAuth((s) => s.user?.role))} title={title} subtitle={subtitle}>
      {children}
    </Shell>
  )
}

export default function App() {
  /*
   * Quand le serveur refuse le jeton, l'application doit le savoir.
   *
   * Effacer le stockage ne suffisait pas : l'ecran restait visuellement
   * connecte, chaque appel echouait, et rien ne disait quoi faire. Le
   * `Guard` rend maintenant l'ecran de connexion de lui-meme, qui
   * explique et remet en selle sans perdre l'adresse en cours.
   */
  const deconnecter = useAuth((s) => s.logout)
  useEffect(() => {
    quandLaSessionFinit(deconnecter)
  }, [deconnecter])

  return (
    <ToastHost>
      <PrintHost>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
        <Routes>
          {/*
            * L'adresse racine est la vitrine du restaurant, pas un
            * sommaire de postes de travail. Un client qui voit
            * « Caisse » et « Gestion » sur la page d'accueil d'un
            * fastfood comprend qu'il regarde un logiciel.
            *
            * Les postes gardent leurs adresses ; l'ancien sommaire vit
            * desormais sous /espace, atteignable par le pied de page.
            */}
          <Route path="/" element={<LandingScreen />} />
          {/*
            * L'espace de travail demande de s'identifier.
            *
            * Il etait ouvert : n'importe qui tombant sur l'adresse
            * lisait la liste des postes du restaurant, leurs noms et ce
            * qu'ils font. Aucune donnee ne fuyait — chaque poste a
            * toujours eu sa garde — mais on offrait le plan des lieux a
            * qui passait.
            *
            * Un employe s'identifie avec ce qu'il a deja : son code a
            * quatre chiffres, son badge, ou son mot de passe. Et il ne
            * voit ensuite que les postes qu'il peut reellement ouvrir.
            */}
          <Route
            path="/espace"
            element={
              <Guard allow={['cashier', 'cook', 'driver', ...STAFF_PLUS]}>
                <PortalScreen />
              </Guard>
            }
          />

          {/* Client */}
          <Route path="/commander" element={<CustomerScreen />} />
          {/*
            * Le suivi n'exige plus de session.
            *
            * Une commande passee sans compte — celle de quelqu'un qui a
            * scanne le code pose sur sa table — n'a aucun autre chemin
            * de retour. Le serveur arbitre : il sert les commandes sans
            * proprietaire a qui en detient l'adresse, et garde celles
            * d'un client inscrit derriere sa session.
            */}
          <Route path="/commande/:id" element={<TrackingScreen />} />
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

          {/* Écran mural des commandes prêtes : aucune connexion non plus,
              il n'affiche que des numéros. */}
          <Route path="/ecran" element={<BoardScreen />} />

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
            path="/gestion/carte"
            element={
              <Guard allow={STAFF_PLUS} intent="manager">
                <ManagerShell
                  title="Carte"
                  subtitle="Catégories, plats, choix prédéfinis et recettes"
                >
                  <MenuPage />
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

          <Route
            path="/gestion/journal"
            element={
              <Guard allow={STAFF_PLUS} intent="manager">
                <ManagerShell
                  title="Journal"
                  subtitle="Annulations, changements de prix, écarts de caisse"
                >
                  <JournalPage />
                </ManagerShell>
              </Guard>
            }
          />

          <Route
            path="/gestion/reglages"
            element={
              <Guard allow={STAFF_PLUS} intent="manager">
                <ManagerShell
                  title="Réglages"
                  subtitle="Informations imprimées sur les tickets"
                >
                  <SettingsPage />
                </ManagerShell>
              </Guard>
            }
          />

          {/*
            * Les etablissements : le seul ecran qui voit au-dessus des
            * cloisons, donc le seul reserve au super admin. Un gerant
            * qui tomberait dessus n'y verrait rien, le serveur refusant
            * de lui repondre.
            */}
          <Route
            path="/gestion/etablissements"
            element={
              <Guard allow={['super_admin', 'admin']} intent="manager">
                <ManagerShell
                  title="Établissements"
                  subtitle="Les fastfoods de cette installation"
                >
                  <RestaurantsPage />
                </ManagerShell>
              </Guard>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <InstallBanner />
        </Suspense>
      </BrowserRouter>
      </PrintHost>
    </ToastHost>
  )
}
