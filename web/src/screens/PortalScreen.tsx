import { Link } from 'react-router-dom'
import {
  Bike,
  ChefHat,
  LayoutDashboard,
  Monitor,
  Receipt,
  Tv,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../lib/store'
import { roleLabel } from '../lib/format'
import { useReglages } from '../lib/reglages'
import { Wordmark } from '../components/Shell'
import { Emoji } from '../components/Emoji'
import { HOME_BY_ROLE } from './LoginScreen'

interface Station {
  to: string
  label: string
  description: string
  icon: LucideIcon
  /** Reconnaissable de loin, et avant d'avoir lu quoi que ce soit. */
  emoji: string
  vie: 'rebondit' | 'fretille' | 'bat' | 'flotte'
}

const STAFF: Station[] = [
  {
    to: '/caisse',
    label: 'Caisse',
    description: 'Encaisser et clôturer le service',
    icon: Receipt,
    emoji: '💸',
    vie: 'bat',
  },
  {
    to: '/cuisine',
    label: 'Cuisine',
    description: 'Suivre les tickets en préparation',
    icon: ChefHat,
    emoji: '👨‍🍳',
    vie: 'fretille',
  },
  {
    to: '/gestion',
    label: 'Gestion',
    description: 'Stock, finances et équipe',
    icon: LayoutDashboard,
    emoji: '📊',
    vie: 'flotte',
  },
  {
    to: '/livreur',
    label: 'Livraison',
    description: 'Prendre et confirmer les courses',
    icon: Bike,
    emoji: '🛵',
    vie: 'rebondit',
  },
  {
    to: '/borne',
    label: 'Borne de salle',
    description: 'L\'écran tactile du comptoir',
    icon: Monitor,
    emoji: '🖥️',
    vie: 'flotte',
  },
  {
    to: '/ecran',
    label: 'Écran de salle',
    description: 'Les numéros appelés, au mur',
    icon: Tv,
    emoji: '📺',
    vie: 'bat',
  },
]

/**
 * Page d'entrée : les clients commandent, le personnel rejoint son poste.
 * Un écran de borne s'ouvre directement sur /borne et ne passe pas par ici.
 */
export default function PortalScreen() {
  const user = useAuth((s) => s.user)
  const { reglages } = useReglages()
  const logo = reglages?.etablissement?.logoUrl
  const nom = reglages?.restaurantName

  return (
    <div className="min-h-dvh bg-ink-900">
      <div className="mx-auto max-w-[940px] px-5 py-10 sm:py-16">
        {/* La maison d'abord. Un employé qui prend son poste travaille
            chez Mohamed, pas « chez Service » — et sur une installation
            qui en compte plusieurs, c'est aussi comme ça qu'il voit sur
            quel établissement cette tablette est réglée. */}
        {logo ? (
          <div className="anim-surgit flex items-center gap-3">
            <span className="grid size-11 place-items-center overflow-hidden rounded-[13px] bg-white">
              <img src={logo} alt="" className="size-full object-contain p-1" />
            </span>
            {nom && (
              <span className="text-[17px] font-extrabold tracking-[-0.01em] text-white">
                {nom}
              </span>
            )}
          </div>
        ) : (
          <Wordmark />
        )}

        <h1 className="anim-monte mt-10 max-w-xl text-[32px] leading-[1.1] font-extrabold tracking-[-0.03em] text-white sm:text-[44px]">
          Votre poste vous attend.
        </h1>
        <p className="anim-monte mt-3 max-w-xl text-[16px] leading-relaxed text-ink-400">
          La salle, la cuisine, la caisse et la route — chacun son écran.
        </p>

        {/* La commande en ligne a disparu d'ici : c'est un espace de
            travail, et un caissier qui prend son poste n'a rien a y
            faire. Les clients l'atteignent depuis la page d'accueil. */}

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

          <div className="anim-cascade grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STAFF.map((s, i) => (
              <Link
                key={s.to}
                to={s.to}
                /**
                 * Un vrai chargement de page, et non une navigation
                 * interne.
                 *
                 * Le navigateur decide de ce qu'il installera au
                 * chargement, d'apres le manifeste present a cet
                 * instant. Entrer dans la caisse sans recharger, c'est
                 * y arriver avec le manifeste de la page d'avant — et
                 * installer « Caisse » posait alors l'application
                 * cliente.
                 *
                 * Le cout est nul la ou il compte : on ouvre son poste
                 * une fois le matin et on y reste. Un chargement franc
                 * donne en prime des fichiers a jour et un ecran
                 * propre.
                 */
                reloadDocument
                className="reagit leve group relative overflow-hidden rounded-[18px] border border-ink-700/70 bg-ink-800/70 p-5 transition-colors hover:border-petrol-600/60 hover:bg-ink-800"
              >
                {/* L'emoji en fond, grand et discret : il donne a chaque
                    poste une silhouette reconnaissable avant meme
                    qu'on ait lu son nom. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-3 -bottom-4 text-[88px] leading-none opacity-[0.07] transition-opacity duration-300 group-hover:opacity-[0.14]"
                >
                  {s.emoji}
                </span>

                <Emoji vie={s.vie} retard={i * 160} className="relative text-[34px]">
                  {s.emoji}
                </Emoji>
                <p className="relative mt-3.5 text-[17px] font-bold text-white">
                  {s.label}
                </p>
                <p className="relative mt-1 text-[13px] leading-snug text-ink-500">
                  {s.description}
                </p>
              </Link>
            ))}
          </div>

          <p className="mt-8 text-[13px] text-ink-600">
            Installez le poste sur la tablette qui lui est dédiée : il s'ouvrira
            en plein écran, directement sur son écran.{' '}
            <Link to="/" className="font-semibold text-ink-400 hover:text-petrol-400">
              Retour à la page publique
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
