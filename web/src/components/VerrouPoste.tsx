import { useEffect, useRef, useState } from 'react'
import { Delete, Lock } from 'lucide-react'
import { ApiError, auth } from '../lib/api'
import { useAuth } from '../lib/store'
import { roleLabel } from '../lib/format'
import { Emoji } from './Emoji'

/**
 * Le voile posé sur un poste que personne ne surveille.
 *
 * Il couvre l'écran sans fermer la session : la caisse reste ouverte, la
 * commande à moitié saisie est toujours là, et le caissier qui revient
 * reprend où il s'était arrêté. Fermer la session lui ferait perdre son
 * travail, et il finirait par trouver le moyen de désactiver le verrou.
 *
 * **Le code, pas le mot de passe.** On est debout devant un comptoir,
 * une main prise. Quatre chiffres sur un grand pavé se tapent d'une
 * main en deux secondes ; un mot de passe se tape à deux mains, avec
 * des majuscules, et finit écrit sur un papier collé à l'écran.
 *
 * **Le code de quelqu'un d'autre ouvre aussi.** C'est voulu : la relève
 * se fait comme ça, et refuser obligerait à fermer la session — donc à
 * clôturer la caisse. Le poste dit alors clairement qui le tient
 * désormais, et le journal enregistre le changement.
 */
export function VerrouPoste({
  ouvert,
  poste,
  onDeverrouille,
  onFermerSession,
}: {
  ouvert: boolean
  poste: string
  onDeverrouille: () => void
  onFermerSession: () => void
}) {
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const [code, setCode] = useState('')
  const [erreur, setErreur] = useState<string>()
  const [occupe, setOccupe] = useState(false)
  const [reprisPar, setReprisPar] = useState<string>()
  const champ = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ouvert) {
      setCode('')
      setErreur(undefined)
      setReprisPar(undefined)
      // Un clavier physique existe sur certains postes : on l'accepte,
      // sans l'exiger.
      champ.current?.focus()
    }
  }, [ouvert])

  async function tenter(valeur: string) {
    if (valeur.length < 4 || occupe) return
    setOccupe(true)
    setErreur(undefined)
    try {
      const nouveau = await auth.deverrouiller(valeur, poste)
      if (nouveau.id !== user?.id) {
        /* Relève : le poste change de main. On le dit, et on laisse
           deux secondes pour que la personne le lise. */
        setUser(nouveau)
        setReprisPar(nouveau.fullName)
        setTimeout(onDeverrouille, 1600)
        return
      }
      setUser(nouveau)
      onDeverrouille()
    } catch (e) {
      /* Le serveur sait pourquoi il refuse — « patientez quelques
         secondes », « ce poste n'est pas le vôtre ». Le dire vaut mieux
         que « code incorrect » devant quelqu'un qui a tapé juste. */
      const dit = e instanceof ApiError ? e.message : ''
      setErreur(dit || 'Code incorrect.')
      setCode('')
    } finally {
      setOccupe(false)
    }
  }

  function frapper(touche: string) {
    if (occupe || reprisPar) return
    setErreur(undefined)
    if (touche === 'back') {
      setCode((c) => c.slice(0, -1))
      return
    }
    const suite = (code + touche).slice(0, 8)
    setCode(suite)
    // Quatre chiffres suffisent dans l'immense majorité des cas : on
    // tente sans faire chercher un bouton « Valider ».
    if (suite.length === 4) void tenter(suite)
  }

  if (!ouvert) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Poste verrouillé"
      className="dark-surface anim-voile fixed inset-0 z-[90] grid place-items-center bg-ink-950/95 px-5 backdrop-blur-md"
    >
      <div className="anim-pop w-full max-w-xs text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-[16px] bg-ink-800 text-ink-300">
          <Lock size={24} strokeWidth={2} />
        </span>

        {reprisPar ? (
          <>
            <p className="mt-5 text-[21px] leading-tight font-extrabold text-white">
              Poste repris
            </p>
            <p className="mt-1.5 flex items-center justify-center gap-2 text-[15px] text-petrol-300">
              <Emoji vie="rebondit">👋</Emoji>
              {reprisPar}
            </p>
          </>
        ) : (
          <>
            <p className="mt-5 text-[21px] leading-tight font-extrabold text-white">
              Poste verrouillé
            </p>
            <p className="mt-1.5 text-[14px] leading-snug text-ink-400">
              {user
                ? `${user.fullName} — ${roleLabel[user.role].toLowerCase()}. Entrez votre code pour reprendre.`
                : 'Entrez votre code pour reprendre.'}
            </p>

            <div className="mt-6 flex justify-center gap-2.5" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`size-3.5 rounded-full transition-colors ${
                    code.length > i ? 'bg-petrol-400' : 'bg-ink-700'
                  }`}
                />
              ))}
            </div>

            {/* Un champ invisible : il accepte un clavier physique et un
                lecteur de badge, sans occuper la place du pavé. */}
            <input
              ref={champ}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 8)
                setCode(v)
                if (v.length === 4) void tenter(v)
              }}
              className="sr-only"
              aria-label="Code personnel"
            />

            <p className="mt-3 h-5 text-[13px] font-semibold text-coral-400">
              {erreur ?? ''}
            </p>

            <div className="mt-2 grid grid-cols-3 gap-2.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((t) => (
                <button
                  key={t}
                  onClick={() => frapper(t)}
                  className="reagit-fort num h-16 rounded-[14px] bg-ink-800 text-[24px] font-bold text-white transition-colors hover:bg-ink-700"
                >
                  {t}
                </button>
              ))}
              <span />
              <button
                onClick={() => frapper('0')}
                className="reagit-fort num h-16 rounded-[14px] bg-ink-800 text-[24px] font-bold text-white transition-colors hover:bg-ink-700"
              >
                0
              </button>
              <button
                onClick={() => frapper('back')}
                aria-label="Effacer un chiffre"
                className="reagit-fort grid h-16 place-items-center rounded-[14px] bg-ink-800 text-ink-300 transition-colors hover:bg-ink-700"
              >
                <Delete size={22} />
              </button>
            </div>

            {/**
             * La soupape.
             *
             * Un verrou sans sortie est un piège : code oublié, employé
             * parti avec le poste ouvert, compteur de tentatives au
             * plafond — et la caisse reste couverte en plein service.
             * Fermer la session renvoie à l'écran de connexion, qui
             * demande lui aussi un code : on ne gagne aucun accès par
             * là, on en perd même un. Le prix est la caisse du moment,
             * qu'on peut rouvrir ; le poste mort pendant une heure, non.
             */}
            <button
              onClick={onFermerSession}
              className="reagit mx-auto mt-5 block text-[13px] font-semibold text-ink-400 underline decoration-ink-700 underline-offset-4 transition-colors hover:text-ink-200"
            >
              Fermer la session et se reconnecter
            </button>
          </>
        )}
      </div>
    </div>
  )
}
