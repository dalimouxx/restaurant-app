import { useState } from 'react'
import { CloudOff, RefreshCw } from 'lucide-react'
import { moneyDT, orderNo, timeShort } from '../lib/format'
import { useReprise } from '../lib/reprise'
import { Emoji } from './Emoji'

/**
 * Ce que voit le caissier quand le réseau lâche.
 *
 * Trois choses, et dans cet ordre : il peut continuer, combien de
 * ventes attendent, et combien de numéros lui restent. Rien d'autre —
 * au coup de feu, on ne lit pas un paragraphe.
 *
 * **Le ton compte autant que le contenu.** Un bandeau rouge alarmant
 * fait appeler le patron ; un caissier qui appelle le patron arrête
 * d'encaisser. Le message dit donc d'abord que ça marche, et seulement
 * ensuite ce qui attend.
 *
 * Il ne s'affiche pas quand tout va bien et que rien n'attend : un
 * bandeau permanent devient invisible en trois jours, et ne sert plus
 * à rien le jour où il compte.
 */
export function BandeauHorsLigne({ actif = true }: { actif?: boolean }) {
  const { enAttente, bloquees, detailBloquees, numeros, coupe, enCours, relancer, solder } =
    useReprise(actif)
  const [deplie, setDeplie] = useState(false)

  const rienASignaler = !coupe && enAttente === 0 && bloquees === 0
  if (!actif || rienASignaler) return null

  /* Des ventes que le serveur refuse : c'est le seul cas qui demande
     vraiment quelqu'un, et il ne doit pas se confondre avec une
     coupure, qui se règle toute seule. */
  if (bloquees > 0 && !coupe) {
    return (
      <div className="border-b border-saffron-500/35 bg-saffron-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <Emoji vie="fretille" className="mt-px text-[18px]">⚠️</Emoji>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-bold text-saffron-900">
              {bloquees === 1
                ? 'Une vente hors ligne ne passe pas'
                : `${bloquees} ventes hors ligne ne passent pas`}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-saffron-800">
              Le serveur les refuse — un plat a sans doute été retiré de la carte
              pendant la coupure. L'argent est dans le tiroir : prévenez le gérant,
              elles seront ressaisies à la main.
            </p>
          </div>
          <button
            onClick={() => setDeplie((v) => !v)}
            className="reagit shrink-0 rounded-[9px] px-2.5 py-1.5 text-[12.5px] font-bold text-saffron-900 underline-offset-4 transition-colors hover:underline"
          >
            {deplie ? 'Masquer' : 'Voir'}
          </button>
          <button
            onClick={relancer}
            disabled={enCours}
            className="reagit shrink-0 rounded-[9px] border border-saffron-500/40 px-3 py-1.5 text-[12.5px] font-bold text-saffron-900 transition-colors hover:bg-saffron-100 disabled:opacity-50"
          >
            <RefreshCw size={13} className={`me-1 inline ${enCours ? 'animate-spin' : ''}`} />
            Réessayer
          </button>
        </div>

        {/* La porte de sortie. Sans elle, ce bandeau resterait affiché
            pour toujours — et un avertissement permanent cesse d'être
            un avertissement. */}
        {deplie && (
          <ul className="anim-surgit mt-3 space-y-1.5 border-t border-saffron-500/25 pt-3">
            {detailBloquees.map((v) => (
              <li
                key={v.clientRef}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-saffron-900"
              >
                <span className="num font-bold">{orderNo(v.orderNumber)}</span>
                <span className="num">{moneyDT(v.total)}</span>
                <span className="text-saffron-800">{timeShort(v.priseA)}</span>
                <span className="min-w-0 flex-1 truncate text-saffron-800 italic">
                  {v.motif}
                </span>
                <button
                  onClick={() => solder(v.clientRef)}
                  className="reagit shrink-0 rounded-[8px] border border-saffron-500/40 px-2.5 py-1 text-[12px] font-bold transition-colors hover:bg-saffron-100"
                >
                  Ressaisie à la main
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (coupe) {
    return (
      <div className="flex items-start gap-3 border-b border-ink-700 bg-ink-900 px-4 py-3">
        <CloudOff size={18} className="mt-px shrink-0 text-saffron-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-white">
            Réseau coupé — vous pouvez continuer à encaisser.
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-400">
            {enAttente > 0 && (
              <>
                <span className="num font-bold text-ink-200">{enAttente}</span>{' '}
                {enAttente === 1 ? 'vente attend' : 'ventes attendent'} le retour du
                réseau.{' '}
              </>
            )}
            {numeros > 0 ? (
              <>
                Il vous reste{' '}
                <span className="num font-bold text-ink-200">{numeros}</span>{' '}
                {numeros === 1 ? 'numéro' : 'numéros'}.
              </>
            ) : (
              <span className="font-bold text-coral-400">
                Plus aucun numéro en réserve : notez les ventes sur papier.
              </span>
            )}
          </p>
        </div>
      </div>
    )
  }

  /* Le réseau est revenu et la file se vide : on le montre, puis le
     bandeau disparaît de lui-même. */
  return (
    <div className="flex items-center gap-3 border-b border-petrol-500/30 bg-petrol-50 px-4 py-2.5">
      <RefreshCw
        size={16}
        className={`shrink-0 text-petrol-600 ${enCours ? 'animate-spin' : ''}`}
      />
      <p className="flex-1 text-[13px] text-petrol-900">
        Réseau revenu —{' '}
        <span className="num font-bold">{enAttente}</span>{' '}
        {enAttente === 1 ? 'vente part' : 'ventes partent'} vers le serveur.
      </p>
      {!enCours && (
        <button
          onClick={relancer}
          className="reagit shrink-0 rounded-[9px] px-2.5 py-1 text-[12.5px] font-bold text-petrol-700 transition-colors hover:bg-petrol-100"
        >
          Relancer
        </button>
      )}
    </div>
  )
}

