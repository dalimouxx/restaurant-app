import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, X } from 'lucide-react'
import { orderNo } from '../lib/format'
import { commandeAReprendre, oublierCommande, type Reprise } from '../lib/derniereCommande'
import { Emoji } from './Emoji'

/**
 * « Vous avez une commande en cours. »
 *
 * Affiché sur la page d'accueil et sur la carte, pour qui revient après
 * avoir fermé son onglet. Il disparaît de lui-même au bout de quelques
 * heures, et le client peut l'écarter — on ne lui impose pas un bandeau
 * sur une commande qu'il a déjà récupérée.
 */
export function RepriseCommande() {
  const [reprise, setReprise] = useState<Reprise | null>(null)

  useEffect(() => {
    setReprise(commandeAReprendre())
  }, [])

  if (!reprise) return null

  return (
    <div className="anim-surgit mx-auto mb-4 flex max-w-5xl items-center gap-3 rounded-[14px] border border-petrol-200 bg-petrol-50 px-4 py-3">
      <Emoji vie="bat" className="text-[22px]">🍔</Emoji>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-petrol-900">
          Votre commande {orderNo(reprise.numero)} est en cours
        </p>
        <p className="text-[12.5px] text-petrol-700">
          Reprenez le suivi là où vous l'aviez laissé.
        </p>
      </div>
      <Link
        to={`/commande/${reprise.id}`}
        className="reagit inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-petrol-600 px-4 text-[13.5px] font-bold text-white transition-colors hover:bg-petrol-500"
      >
        Suivre
        <ArrowRight size={15} strokeWidth={2.4} />
      </Link>
      <button
        onClick={() => {
          oublierCommande()
          setReprise(null)
        }}
        aria-label="Masquer"
        className="reagit-fort shrink-0 rounded-[8px] p-1 text-petrol-700 transition-colors hover:bg-petrol-100"
      >
        <X size={16} />
      </button>
    </div>
  )
}
