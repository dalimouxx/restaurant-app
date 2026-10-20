import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, Share, X } from 'lucide-react'
import {
  applyManifest,
  estIOS,
  estInstallee,
  POSTE_LABELS,
  posteFor,
  type InvitePromptable,
} from '../lib/install'

/**
 * Proposition d'installation.
 *
 * Discrète et refusable : un bandeau qui revient à chaque ouverture sur la
 * borne de la salle serait insupportable. Le refus est mémorisé par poste
 * et par appareil — refuser sur la tablette de la caisse ne doit pas
 * empêcher la proposition sur le téléphone du livreur.
 */
export function InstallBanner() {
  const { pathname } = useLocation()
  const poste = posteFor(pathname)
  const [invite, setInvite] = useState<InvitePromptable | null>(null)
  const [visible, setVisible] = useState(false)
  const [modeIOS, setModeIOS] = useState(false)

  // Le manifeste suit le poste affiché.
  useEffect(() => {
    applyManifest(poste)
  }, [poste])

  useEffect(() => {
    if (estInstallee()) return

    let refuse = false
    try {
      refuse = localStorage.getItem(`service.install.${poste}`) === 'non'
    } catch {
      /* mode privé */
    }
    if (refuse) return

    if (estIOS()) {
      // Pas d'invite possible : on explique le geste, après un court délai
      // pour ne pas sauter au visage dès l'ouverture.
      const t = setTimeout(() => {
        setModeIOS(true)
        setVisible(true)
      }, 2500)
      return () => clearTimeout(t)
    }

    function onInvite(e: Event) {
      e.preventDefault()
      setInvite(e as unknown as InvitePromptable)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onInvite)
    return () => window.removeEventListener('beforeinstallprompt', onInvite)
  }, [poste])

  function refuser() {
    setVisible(false)
    try {
      localStorage.setItem(`service.install.${poste}`, 'non')
    } catch {
      /* mode privé : la proposition reviendra, tant pis */
    }
  }

  async function installer() {
    if (!invite) return
    await invite.prompt()
    const { outcome } = await invite.userChoice
    if (outcome === 'accepted') setVisible(false)
    else refuser()
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Installer l'application"
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:w-[380px]"
    >
      <div className="flex items-start gap-3 rounded-[13px] border border-ink-700 bg-ink-900 p-4 shadow-xl">
        <div className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-petrol-600 text-white">
          <Download size={19} strokeWidth={2.2} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-white">
            Installer « {POSTE_LABELS[poste]} »
          </p>

          {modeIOS ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-snug text-ink-400">
              Touchez
              <Share size={13} className="inline text-ink-300" />
              en bas de Safari, puis
              <span className="font-semibold text-ink-200">« Sur l'écran d'accueil »</span>.
            </p>
          ) : (
            <p className="mt-1 text-[12.5px] leading-snug text-ink-400">
              L'application s'ouvrira en plein écran, sans barre d'adresse, directement
              sur ce poste.
            </p>
          )}

          {!modeIOS && (
            <button
              onClick={installer}
              className="mt-2.5 h-9 rounded-[8px] bg-petrol-600 px-4 text-[13px] font-bold text-white transition-colors hover:bg-petrol-500"
            >
              Installer
            </button>
          )}
        </div>

        <button
          onClick={refuser}
          aria-label="Ne plus proposer"
          className="-m-1 shrink-0 rounded-md p-1 text-ink-500 transition-colors hover:bg-ink-800 hover:text-white"
        >
          <X size={17} />
        </button>
      </div>
    </div>
  )
}
