import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Share, X } from 'lucide-react'
import {
  applyManifest,
  estIOS,
  estInstallee,
  installationAReprendre,
  POSTE_LABELS,
  inviteDisponible,
  oublierInvite,
  posteDuChargement,
  posteFor,
  rechargerPourInstaller,
  surInvite,
  type InvitePromptable,
} from '../lib/install'
import { Emoji } from './Emoji'

/**
 * Proposition d'installation, côté postes de travail.
 *
 * Chaque poste porte son emoji et son nom : « Installer la Caisse » se
 * comprend d'un coup d'œil, là où « installer l'application » ne dit rien
 * à personne. Une fois installée, la tablette s'ouvre directement sur la
 * caisse, en plein écran — c'est ce qui sépare un outil de métier d'un
 * onglet perdu parmi vingt autres.
 *
 * Discrète et refusable : un bandeau qui revient à chaque ouverture sur la
 * borne de la salle serait insupportable. Le refus est mémorisé par poste
 * et par appareil — refuser sur la tablette de la caisse ne doit pas
 * empêcher la proposition sur le téléphone du livreur.
 *
 * **En bas à gauche, et jamais à droite.** Les écrans de travail rangent
 * leur action principale dans la colonne de droite : le pavé de paiement
 * de la caisse, le bouton d'encaissement. Un panneau flottant par-dessus
 * ferait perdre une vente, et on ne découvrirait le problème qu'un soir
 * de rush.
 *
 * La façade client a sa propre invitation (`InstallerPop`), choisie pour
 * surgir au bon moment plutôt qu'à l'ouverture. Ce bandeau se tait donc
 * complètement sur ces écrans : deux propositions pour un seul événement
 * d'installation, c'est une qui avale l'autre.
 */

/** Un court délai : surgir dès l'ouverture ne récolte qu'un refus. */
const DELAI_MS = 2500

export function InstallBanner() {
  const { pathname } = useLocation()
  const poste = posteFor(pathname)
  const [invite, setInvite] = useState<InvitePromptable | null>(() => inviteDisponible())
  const [visible, setVisible] = useState(false)
  const [modeIOS, setModeIOS] = useState(false)
  // Une installation demandée juste avant ce rechargement ?
  const reprise = useRef(installationAReprendre(poste))

  // Le manifeste suit le poste affiché, sur tous les écrans — y compris
  // ceux où ce bandeau ne s'affiche pas : c'est lui qui décide du nom et
  // de l'icône de l'application installée.
  useEffect(() => {
    applyManifest(poste)
  }, [poste])

  const cotePersonnel = poste !== 'client'

  /**
   * L'invitation captée vaut-elle pour le poste qu'on regarde ?
   *
   * Le navigateur décide de ce qu'il installera au chargement de la
   * page, d'après le manifeste présent à ce moment-là. Un gérant qui
   * arrivait par la vitrine puis naviguait vers la gestion voyait bien
   * « Installer Gestion » — et installait l'application cliente. Une
   * invitation ne vaut donc que pour le poste pour lequel la page a été
   * chargée ; sinon il faut repasser par son adresse.
   */
  const memePoste = posteDuChargement() === poste

  /* L'invitation arrive après coup : on s'abonne plutôt que de
     l'attendre au montage, qui serait trop tard sur un écran lent. */
  useEffect(() => surInvite(() => setInvite(inviteDisponible())), [])

  useEffect(() => {
    if (!cotePersonnel || estInstallee()) return

    let refuse = false
    try {
      refuse = localStorage.getItem(`service.install.${poste}`) === 'non'
    } catch {
      /* mode privé */
    }
    if (refuse) return

    if (estIOS()) {
      // Pas d'invite possible : on explique le geste.
      const t = setTimeout(() => {
        setModeIOS(true)
        setVisible(true)
      }, DELAI_MS)
      return () => clearTimeout(t)
    }

    /**
     * On ne propose rien sans invitation captée.
     *
     * Elle répond à une question qu'on ne peut pas poser autrement : ce
     * navigateur sait-il installer une application ? Sans elle, le
     * bouton ne ferait rien — et un bouton qui ne fait rien coûte plus
     * cher qu'un bouton absent.
     */
    if (!invite) return

    // Reprise après rechargement : le gérant vient d'appuyer, la page
    // est revenue, et plus rien ne se passerait pendant trois secondes.
    const t = setTimeout(() => setVisible(true), reprise.current ? 0 : DELAI_MS)
    return () => clearTimeout(t)
  }, [poste, cotePersonnel, invite])

  /** L'installation reprend d'elle-même après le rechargement. */
  useEffect(() => {
    if (!visible || !reprise.current || !memePoste) return
    reprise.current = false
    void installer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, memePoste])

  function refuser() {
    setVisible(false)
    try {
      localStorage.setItem(`service.install.${poste}`, 'non')
    } catch {
      /* mode privé : la proposition reviendra, tant pis */
    }
  }

  async function installer() {
    /**
     * Le poste ne correspond pas à celui du chargement : on repasse par
     * son adresse, pour que le navigateur reparte d'une page dont le
     * manifeste est le bon dès le premier octet. C'est le seul moyen —
     * il ne revient pas sur sa décision en cours de route.
     */
    if (!memePoste) {
      rechargerPourInstaller(poste)
      return
    }
    if (!invite) return
    await invite.prompt()
    const { outcome } = await invite.userChoice
    // Consommée : le navigateur n'en redonne pas sur cette page.
    oublierInvite()
    if (outcome === 'accepted') setVisible(false)
    else refuser()
  }

  if (!visible || !cotePersonnel) return null

  return (
    <div
      role="dialog"
      aria-label="Installer l'application"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:right-auto sm:left-4 sm:w-[380px]"
    >
      <div className="anim-pop pointer-events-auto relative overflow-hidden rounded-[18px] border border-petrol-500/25 bg-ink-900 p-4 shadow-[0_24px_60px_-18px_rgba(6,61,52,0.85)]">
        {/* Décor derrière le texte, jamais devant : il ne doit rien
            intercepter, surtout pas le bouton de refus. */}
        <span
          aria-hidden
          className="emoji-flotte pointer-events-none absolute -top-4 -right-2 text-[76px] opacity-[0.07] select-none"
        >
          {EMOJI_POSTE[poste]}
        </span>

        <button
          onClick={refuser}
          aria-label="Ne plus proposer"
          className="reagit-fort absolute top-2.5 right-2.5 z-10 rounded-[8px] p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-white"
        >
          <X size={17} />
        </button>

        <div className="relative flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-petrol-600/20 text-[22px]">
            <Emoji vie="rebondit">{EMOJI_POSTE[poste]}</Emoji>
          </span>

          <div className="min-w-0 flex-1 pr-6">
            <p className="text-[14.5px] leading-tight font-extrabold text-white">
              Installer « {POSTE_LABELS[poste]} »
            </p>

            {modeIOS ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-snug text-ink-400">
                Touchez
                <Share size={13} className="inline text-ink-300" />
                en bas de Safari, puis
                <span className="font-semibold text-ink-200">
                  « Sur l'écran d'accueil »
                </span>
                .
              </p>
            ) : (
              <p className="mt-1.5 text-[12.5px] leading-snug text-ink-400">
                Ce poste s'ouvrira en plein écran, sans barre d'adresse, directement
                sur son écran.
              </p>
            )}

            {!modeIOS && (
              <button
                onClick={installer}
                className="reagit mt-3 inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-petrol-600 px-4 text-[13px] font-bold text-white transition-colors hover:bg-petrol-500"
              >
                <Emoji vie="rebondit">✨</Emoji>
                Installer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Le même emoji que sur la carte du poste, dans l'espace personnel. */
const EMOJI_POSTE: Record<ReturnType<typeof posteFor>, string> = {
  client: '🍔',
  borne: '🖥️',
  caisse: '💸',
  cuisine: '👨‍🍳',
  ecran: '📺',
  livreur: '🛵',
  gestion: '📊',
}
