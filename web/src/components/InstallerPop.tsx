import { useCallback, useEffect, useState } from 'react'
import { Share, Sparkles, X } from 'lucide-react'
import {
  estIOS,
  estInstallee,
  inviteDisponible,
  oublierInvite,
  surInvite,
  type InvitePromptable,
} from '../lib/install'
import { Emoji } from './Emoji'
import { useT } from '../lib/traductions'

/**
 * L'invitation à installer, côté client.
 *
 * Le bandeau discret convient aux postes de travail : on l'installe une
 * fois sur la tablette de la caisse et on n'en parle plus. Côté client
 * il passe inaperçu, et c'est pourtant là qu'une application installée
 * change tout — une icône sur l'écran d'accueil, c'est la différence
 * entre un client qui revient et un client qui retape une adresse.
 *
 * **Le moment compte plus que l'insistance.** Sauter au visage de
 * quelqu'un qui vient d'arriver ne produit qu'un refus, et le refus est
 * définitif. On attend donc qu'il ait mis quelque chose au panier : il a
 * montré son intérêt, et c'est exactement là que la proposition se
 * comprend.
 *
 * Refusable d'un geste, et le refus est retenu. Un client qui doit
 * écarter la même fenêtre à chaque visite finit par ne plus venir.
 */

const CLE_REFUS = 'service.install.client'
/** Le refus tient trois semaines, pas pour toujours : les avis changent. */
const DUREE_REFUS_MS = 21 * 24 * 60 * 60 * 1000

function dejaRefuse(): boolean {
  try {
    const quand = Number(localStorage.getItem(CLE_REFUS))
    return Number.isFinite(quand) && Date.now() - quand < DUREE_REFUS_MS
  } catch {
    return false
  }
}

export function InstallerPop({
  /** Le client a montré son intérêt : panier non vide, commande passée. */
  pret,
  nomRestaurant,
  logoUrl,
  /**
   * Hauteur de ce qui occupe déjà le bas de l'écran — la barre du panier,
   * par exemple. Elle apparaît au moment exact où le panier se remplit,
   * c'est-à-dire au moment exact où cette fenêtre surgit : sans décalage,
   * la proposition d'installer masquerait le bouton de commande.
   */
  decalageBas = '0px',
}: {
  pret: boolean
  nomRestaurant?: string
  logoUrl?: string | null
  decalageBas?: string
}) {
  const t = useT()
  const [invite, setInvite] = useState<InvitePromptable | null>(null)
  const [visible, setVisible] = useState(false)
  const [modeIOS, setModeIOS] = useState(false)
  const [ferme, setFerme] = useState(false)

  useEffect(() => {
    if (estInstallee() || dejaRefuse()) return

    if (estIOS()) {
      setModeIOS(true)
      return
    }

    /**
     * L'invitation est captée au démarrage de l'application, pas ici.
     *
     * `beforeinstallprompt` ne se déclenche qu'une fois par chargement,
     * et tôt. L'attendre au montage d'un composant, c'est la manquer
     * dès que l'écran met un peu de temps à s'afficher — et c'est
     * exactement ce qui arrive sur le téléphone d'un client, en 3G,
     * devant un comptoir.
     */
    setInvite(inviteDisponible())
    return surInvite(() => setInvite(inviteDisponible()))
  }, [])

  // Elle n'apparaît qu'une fois l'intérêt manifesté, et après un court
  // délai : surgir dans la même seconde que l'ajout au panier donne
  // l'impression d'avoir déclenché un piège.
  useEffect(() => {
    if (!pret || ferme) return
    if (!invite && !modeIOS) return
    const t = setTimeout(() => setVisible(true), 1400)
    return () => clearTimeout(t)
  }, [pret, ferme, invite, modeIOS])

  const refuser = useCallback(() => {
    setVisible(false)
    setFerme(true)
    try {
      localStorage.setItem(CLE_REFUS, String(Date.now()))
    } catch {
      /* mode privé : elle reviendra à la prochaine visite */
    }
  }, [])

  async function installer() {
    if (!invite) return
    await invite.prompt()
    const { outcome } = await invite.userChoice
    // Consommée : le navigateur n'en redonne pas sur cette page.
    oublierInvite()
    setVisible(false)
    setFerme(true)
    if (outcome !== 'accepted') {
      try {
        localStorage.setItem(CLE_REFUS, String(Date.now()))
      } catch {
        /* mode privé */
      }
    }
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label={t('install.installer')}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] px-3 sm:right-5 sm:left-auto sm:w-[400px]"
      style={{ paddingBottom: `calc(${decalageBas} + max(14px, env(safe-area-inset-bottom)))` }}
    >
      <div className="anim-pop pointer-events-auto relative overflow-hidden rounded-[22px] border border-petrol-500/30 bg-ink-900 p-5 shadow-[0_28px_70px_-18px_rgba(6,61,52,0.9)]">
        {/* Décor derrière le texte, jamais devant : il ne doit rien
            intercepter, surtout pas le bouton de refus. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
          <span className="emoji-flotte absolute -top-3 right-6 text-[72px] opacity-[0.09]">
            🍔
          </span>
          <span
            className="emoji-flotte absolute -bottom-4 left-4 text-[58px] opacity-[0.07]"
            style={{ animationDelay: '900ms' }}
          >
            🍟
          </span>
        </div>

        <button
          onClick={refuser}
          aria-label={t('install.fermer')}
          className="reagit-fort absolute top-3 right-3 z-10 rounded-[8px] p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-white"
        >
          <X size={17} />
        </button>

        <div className="relative flex items-start gap-3.5">
          <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[15px] bg-white">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="size-full object-contain p-1.5" />
            ) : (
              <Emoji vie="rebondit" className="text-[28px]">🍔</Emoji>
            )}
          </span>

          <div className="min-w-0 flex-1 pr-5">
            <p className="flex items-center gap-1.5 text-[11.5px] font-bold tracking-[0.06em] text-petrol-400 uppercase">
              <Sparkles size={12} />
              {t('install.raccourci')}
            </p>
            <p className="mt-1 text-[17px] leading-tight font-extrabold text-white">
              {nomRestaurant
                ? `${nomRestaurant} — ${t('install.surVotreEcran')}`
                : t('install.surVotreEcran')}
            </p>
            <p className="mt-1.5 text-[13px] leading-snug text-ink-400">
              {modeIOS
                ? 'Une icône, et vous commandez en deux touches la prochaine fois.'
                : t('install.argument')}
            </p>
          </div>
        </div>

        {modeIOS ? (
          <p className="relative mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-[12px] bg-ink-800 px-3.5 py-3 text-[12.5px] leading-snug text-ink-300">
            Touchez
            <Share size={14} className="inline text-white" />
            en bas de Safari, puis
            <span className="font-bold text-white">« Sur l'écran d'accueil »</span>.
          </p>
        ) : (
          <div className="relative mt-4 flex gap-2">
            <button
              onClick={installer}
              className="reagit flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] bg-petrol-600 text-[15px] font-bold text-white transition-colors hover:bg-petrol-500"
            >
              <Emoji vie="rebondit">✨</Emoji>
              {t('install.installer')}
            </button>
            <button
              onClick={refuser}
              className="reagit h-12 rounded-[12px] px-4 text-[14px] font-semibold text-ink-400 transition-colors hover:bg-ink-800 hover:text-white"
            >
              {t('install.plusTard')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
