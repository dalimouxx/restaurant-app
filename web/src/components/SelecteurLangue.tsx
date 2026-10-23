import { changerLangue, LANGUES, useLangue } from '../lib/langue'

/**
 * Français / العربية.
 *
 * Deux boutons côte à côte plutôt qu'un menu déroulant : avec deux
 * langues, le menu ajoute un geste et cache la moitié du choix. Et sur
 * une borne tactile, un sélecteur natif ouvre un panneau système qu'on
 * ne maîtrise pas.
 *
 * Le libellé de chaque langue est écrit **dans cette langue** —
 * « العربية », pas « Arabe ». Quelqu'un qui ne lit pas le français doit
 * pouvoir trouver son bouton sans lire le français.
 */
export function SelecteurLangue({
  taille = 'normale',
  sombre = false,
}: {
  /** La borne du comptoir se touche debout, à bout de bras. */
  taille?: 'normale' | 'grande'
  sombre?: boolean
}) {
  const courante = useLangue()
  const grande = taille === 'grande'

  return (
    <div
      role="group"
      aria-label="Langue"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full p-0.5 ${
        sombre ? 'bg-ink-800' : 'bg-ink-100'
      }`}
    >
      {LANGUES.map((l) => {
        const active = l.code === courante
        return (
          <button
            key={l.code}
            type="button"
            lang={l.code}
            onClick={() => changerLangue(l.code)}
            aria-pressed={active}
            className={`reagit rounded-full font-bold transition-colors ${
              grande ? 'h-11 px-5 text-[16px]' : 'h-8 px-3.5 text-[13px]'
            } ${
              active
                ? sombre
                  ? 'bg-white text-ink-900'
                  : 'bg-ink-900 text-white'
                : sombre
                  ? 'text-ink-400 hover:text-white'
                  : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {grande ? l.nom : l.court}
          </button>
        )
      })}
    </div>
  )
}
