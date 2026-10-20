import { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { money, moneyDT } from '../../lib/format'
import type { CashCount } from '../../lib/types'

/**
 * Comptage des espèces à la clôture.
 *
 * Le caissier comptait ses billets puis tapait un total : une addition
 * mentale en fin de service, debout, avec des clients qui attendent. Il
 * pointe désormais ce qu'il a, coupure par coupure, et le total se fait
 * tout seul — le même geste que compter la caisse à la main.
 *
 * Coupures tunisiennes en circulation : billets de 50, 20, 10 et 5 dinars,
 * pièces de 5, 2 et 1 dinar, puis 500, 200 et 100 millimes.
 */
const COUPURES: { valeur: number; label: string; type: 'billet' | 'piece' }[] = [
  { valeur: 50, label: '50 DT', type: 'billet' },
  { valeur: 20, label: '20 DT', type: 'billet' },
  { valeur: 10, label: '10 DT', type: 'billet' },
  { valeur: 5, label: '5 DT', type: 'billet' },
  { valeur: 5, label: '5 DT', type: 'piece' },
  { valeur: 2, label: '2 DT', type: 'piece' },
  { valeur: 1, label: '1 DT', type: 'piece' },
  { valeur: 0.5, label: '500 mill.', type: 'piece' },
  { valeur: 0.2, label: '200 mill.', type: 'piece' },
  { valeur: 0.1, label: '100 mill.', type: 'piece' },
]

const cle = (c: (typeof COUPURES)[number]) => `${c.type}-${c.valeur}`

export function useCashCount() {
  const [compte, setCompte] = useState<CashCount>({})

  const total = useMemo(
    () =>
      Math.round(
        COUPURES.reduce((s, c) => s + (compte[cle(c)] ?? 0) * c.valeur, 0) * 1000,
      ) / 1000,
    [compte],
  )

  const pieces = useMemo(
    () => COUPURES.reduce((s, c) => s + (compte[cle(c)] ?? 0), 0),
    [compte],
  )

  return { compte, setCompte, total, pieces, remettre: () => setCompte({}) }
}

export function CashCountGrid({
  compte,
  onChange,
  total,
  attendu,
}: {
  compte: CashCount
  onChange: (c: CashCount) => void
  total: number
  attendu?: number | null
}) {
  function ajuster(c: (typeof COUPURES)[number], delta: number) {
    const k = cle(c)
    const next = Math.max(0, (compte[k] ?? 0) + delta)
    onChange({ ...compte, [k]: next })
  }

  const ecart = attendu == null ? null : total - attendu

  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5">
        {COUPURES.map((c) => {
          const n = compte[cle(c)] ?? 0
          return (
            <div
              key={cle(c)}
              className={`flex items-center gap-2 rounded-[9px] border px-2.5 py-2 ${
                n > 0 ? 'border-petrol-200 bg-petrol-50' : 'border-ink-200 bg-white'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="num text-[13.5px] font-bold text-ink-900">{c.label}</p>
                <p className="text-[11px] text-ink-400">
                  {c.type === 'billet' ? 'billet' : 'pièce'}
                </p>
              </div>

              <button
                type="button"
                aria-label={`Un ${c.label} de moins`}
                onClick={() => ajuster(c, -1)}
                disabled={n === 0}
                className="grid size-8 shrink-0 place-items-center rounded-[7px] border border-ink-200 bg-white text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-30"
              >
                <Minus size={14} strokeWidth={2.6} />
              </button>
              <span className="num w-7 shrink-0 text-center text-[16px] font-bold text-ink-900">
                {n}
              </span>
              <button
                type="button"
                aria-label={`Un ${c.label} de plus`}
                onClick={() => ajuster(c, 1)}
                className="grid size-8 shrink-0 place-items-center rounded-[7px] border border-ink-200 bg-white text-ink-700 transition-colors hover:border-petrol-400 hover:bg-petrol-50"
              >
                <Plus size={14} strokeWidth={2.6} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-3 rounded-[11px] bg-ink-900 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-ink-400">Total compté</span>
          <span className="num text-[26px] font-bold text-white">{moneyDT(total)}</span>
        </div>
        {ecart !== null && (
          <div className="mt-2 flex items-baseline justify-between border-t border-ink-800 pt-2">
            <span className="text-[12.5px] text-ink-500">
              {Math.abs(ecart) < 0.001
                ? 'Compte juste'
                : ecart > 0
                  ? 'Excédent'
                  : 'Manquant'}
            </span>
            <span
              className={`num text-[15px] font-bold ${
                Math.abs(ecart) < 0.001
                  ? 'text-petrol-400'
                  : ecart > 0
                    ? 'text-sky-400'
                    : 'text-coral-500'
              }`}
            >
              {Math.abs(ecart) < 0.001 ? '—' : `${ecart > 0 ? '+' : ''}${money(ecart)} DT`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
