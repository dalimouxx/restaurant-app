import { Link } from 'react-router-dom'
import {
  Bike,
  ChefHat,
  LayoutDashboard,
  Monitor,
  Receipt,
  ShoppingBag,
  Tv,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../lib/store'
import { roleLabel } from '../lib/format'
import { Wordmark } from '../components/Shell'
import { Emoji } from '../components/Emoji'
import { HOME_BY_ROLE } from './LoginScreen'

interface Station {
  to: string
  label: string
  description: string
  icon: LucideIcon
}

const STAFF: Station[] = [
  {
    to: '/caisse',
    label: 'Caisse',
    description: 'Encaisser et clôturer le service',
    icon: Receipt,
  },
  {
    to: '/cuisine',
    label: 'Cuisine',
    description: 'Suivre les tickets en préparation',
    icon: ChefHat,
  },
  {
    to: '/gestion',
    label: 'Gestion',
    description: 'Stock, finances et équipe',
    icon: LayoutDashboard,
  },
  {
    to: '/livreur',
    label: 'Livraison',
    description: 'Prendre et confirmer les courses',
    icon: Bike,
  },
]

/**
 * Page d'entrée : les clients commandent, le personnel rejoint son poste.
 * Un écran de borne s'ouvre directement sur /borne et ne passe pas par ici.
 */
export default function PortalScreen() {
  const user = useAuth((s) => s.user)

  return (
    <div className="min-h-dvh bg-ink-900">
      <div className="mx-auto max-w-[940px] px-5 py-10 sm:py-16">
        <Wordmark />

        <h1 className="anim-monte mt-10 max-w-xl text-[32px] leading-[1.1] font-extrabold tracking-[-0.03em] text-white sm:text-[44px]">
          Commandez, suivez, livrez.
        </h1>
        <div className="mt-4 flex gap-3 text-[30px] sm:text-[36px]">
          <Emoji vie="rebondit">🍔</Emoji>
          <Emoji vie="rebondit" retard={180}>🍟</Emoji>
          <Emoji vie="rebondit" retard={360}>🥤</Emoji>
          <Emoji vie="flotte" retard={120}>🛵</Emoji>
        </div>
        <p className="mt-3 max-w-md text-[16px] leading-relaxed text-ink-400">
          Une seule application pour la salle, la cuisine, la caisse et la route.
        </p>

        <div className="anim-cascade mt-9 flex flex-wrap gap-3">
          <Link
            to="/commander"
            className="reagit leve inline-flex h-14 items-center gap-2.5 rounded-[13px] bg-petrol-600 px-7 text-[16px] font-bold text-white transition-colors hover:bg-petrol-500"
          >
            <ShoppingBag size={19} strokeWidth={2.2} />
            Commander en ligne
          </Link>
          <Link
            to="/borne"
            className="reagit leve inline-flex h-14 items-center gap-2.5 rounded-[13px] border border-ink-700 px-7 text-[16px] font-bold text-ink-200 transition-colors hover:border-ink-600 hover:bg-ink-800"
          >
            <Monitor size={19} strokeWidth={2.2} />
            Mode borne
          </Link>
          <Link
            to="/ecran"
            className="reagit leve inline-flex h-14 items-center gap-2.5 rounded-[13px] border border-ink-700 px-7 text-[16px] font-bold text-ink-200 transition-colors hover:border-ink-600 hover:bg-ink-800"
          >
            <Tv size={19} strokeWidth={2.2} />
            Écran de salle
          </Link>
        </div>

        <div className="mt-16 border-t border-ink-800 pt-8">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 className="text-[15px] font-bold text-ink-300">Postes du personnel</h2>
            {user && (
              <Link
                to={HOME_BY_ROLE[user.role]}
                className="text-[13.5px] font-semibold text-petrol-400 hover:text-petrol-200"
              >
                Reprendre comme {roleLabel[user.role].toLowerCase()}
              </Link>
            )}
          </div>

          <div className="anim-cascade grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STAFF.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="reagit leve group rounded-[16px] border border-ink-800 bg-ink-800/40 p-4 transition-colors hover:border-ink-600 hover:bg-ink-800"
              >
                <s.icon
                  size={20}
                  strokeWidth={2}
                  className="text-ink-500 transition-colors group-hover:text-petrol-400"
                />
                <p className="mt-3 text-[15px] font-bold text-white">{s.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">
                  {s.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
