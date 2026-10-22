import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/store'
import { roleLabel } from '../lib/format'
import { ConnectionDot } from './ConnectionDot'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: number
}

/**
 * Chassis des écrans métier : rail sombre persistant à gauche sur
 * grand écran, barre d'onglets en bas sur mobile. L'opérateur doit
 * toujours savoir dans quel poste il se trouve.
 */
export function Shell({
  nav,
  title,
  subtitle,
  actions,
  children,
}: {
  nav: NavItem[]
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()

  const signOut = () => {
    logout()
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-dvh bg-ink-50">
      {/* Rail — grand écran */}
      <aside className="dark-surface sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col bg-ink-900 lg:flex">
        <div className="px-5 pt-5 pb-6">
          <Wordmark />
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-ink-800 text-white'
                    : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    size={18}
                    strokeWidth={2.1}
                    className={isActive ? 'text-petrol-400' : ''}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="num rounded-full bg-saffron-500 px-1.5 py-0.5 text-[11px] font-bold text-ink-900">
                      {item.badge}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-800 p-3">
          <div className="mb-2 flex items-center gap-2.5 rounded-[9px] px-2 py-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-petrol-600 text-[13px] font-bold text-white">
              {user?.fullName?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink-100">
                {user?.fullName}
              </p>
              <p className="text-[11.5px] text-ink-500">
                {user ? roleLabel[user.role] : ''}
              </p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13px] font-semibold text-ink-400 transition-colors hover:bg-ink-800 hover:text-coral-500"
          >
            <LogOut size={16} strokeWidth={2.1} />
            Fermer la session
          </button>
        </div>
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        <header className="sticky top-0 z-30 border-b border-ink-200 bg-ink-50/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <h1 className="truncate text-[19px] font-bold tracking-[-0.015em] text-ink-900">
                  {title}
                </h1>
                <ConnectionDot />
              </div>
              {subtitle && (
                <p className="truncate text-[12.5px] text-ink-500">{subtitle}</p>
              )}
            </div>
            {actions}
          </div>
        </header>

        {/*
          * Les pages de gestion arrivent plutot que d'apparaitre.
          *
          * Une seule animation, sur le conteneur : le gerant consulte ces
          * ecrans plusieurs fois par jour, pas trois cents, et une entree
          * discrete aide a lire la hierarchie sans transformer un outil de
          * travail en vitrine. La cle rejoue l'animation a chaque
          * changement de page, sans quoi seule la premiere en profiterait.
          */}
        <main key={title} className="anim-monte flex-1">
          {children}
        </main>
      </div>

      {/* Barre d'onglets — mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ink-800 bg-ink-900 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
                isActive ? 'text-petrol-400' : 'text-ink-500'
              }`
            }
          >
            <item.icon size={20} strokeWidth={2.1} />
            {item.label}
            {item.badge ? (
              <span className="num absolute top-1.5 right-[22%] rounded-full bg-saffron-500 px-1.5 text-[10px] font-bold text-ink-900">
                {item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function Wordmark({ dark = true }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <rect width="26" height="26" rx="7" fill="#0B6B5B" />
        <path
          d="M8 7.5v5.2c0 1.4 1.1 2.5 2.5 2.5S13 14.1 13 12.7V7.5M10.5 15.2V19"
          stroke="white"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M17.5 7.5c-1 1.6-1.4 3-1.4 4.4 0 1 .5 1.6 1.4 1.8V19"
          stroke="white"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`text-[17px] font-extrabold tracking-[-0.02em] ${
          dark ? 'text-white' : 'text-ink-900'
        }`}
      >
        Service
      </span>
    </div>
  )
}
