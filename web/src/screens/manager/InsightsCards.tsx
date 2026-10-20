import { useCallback, useEffect, useState } from 'react'
import { Download, TrendingDown, TrendingUp } from 'lucide-react'
import { reports } from '../../lib/api'
import { money, moneyDT } from '../../lib/format'
import type { PeakHours, PeriodComparison, ProductMargin } from '../../lib/types'
import { Button, Card, SectionTitle, Skeleton, useToast } from '../../components/ui'

/* ───────────────────────── Comparaison ───────────────────────── */

/**
 * Un chiffre seul ne dit rien : 1 200 dinars, c'est bien ou mal ? La
 * réponse est dans l'écart avec la période précédente.
 */
export function ComparisonCard({ days = 7 }: { days?: number }) {
  const [data, setData] = useState<PeriodComparison | null>(null)

  useEffect(() => {
    reports.compare(days).then(setData).catch(() => setData(null))
  }, [days])

  if (!data) return <Skeleton className="h-28" />

  const lignes: { label: string; valeur: string; change: number | null }[] = [
    { label: 'Chiffre d\'affaires', valeur: moneyDT(data.current.revenue), change: data.change.revenue },
    { label: 'Commandes', valeur: String(data.current.orders), change: data.change.orders },
    { label: 'Ticket moyen', valeur: moneyDT(data.current.averageTicket), change: data.change.averageTicket },
  ]

  return (
    <div>
      <SectionTitle>
        {days} derniers jours, face aux {days} précédents
      </SectionTitle>
      <Card className="grid gap-px overflow-hidden bg-ink-100 sm:grid-cols-3">
        {lignes.map((l) => (
          <div key={l.label} className="bg-white p-4">
            <p className="text-[12.5px] text-ink-500">{l.label}</p>
            <p className="num mt-1 text-[22px] font-bold text-ink-900">{l.valeur}</p>
            {l.change === null ? (
              <p className="mt-1 text-[12px] text-ink-400">Aucun point de comparaison</p>
            ) : (
              <p
                className={`mt-1 flex items-center gap-1 text-[12.5px] font-semibold ${
                  l.change > 0
                    ? 'text-petrol-700'
                    : l.change < 0
                      ? 'text-coral-600'
                      : 'text-ink-500'
                }`}
              >
                {l.change > 0 ? (
                  <TrendingUp size={13} />
                ) : l.change < 0 ? (
                  <TrendingDown size={13} />
                ) : null}
                <span className="num">
                  {l.change > 0 ? '+' : ''}
                  {l.change} %
                </span>
              </p>
            )}
          </div>
        ))}
      </Card>
    </div>
  )
}

/* ───────────────────────── Heures de pointe ───────────────────────── */

/**
 * Quand le restaurant travaille vraiment.
 *
 * Seules les heures effectivement servies sont tracées : vingt-quatre
 * barres dont dix-huit à zéro ne disent rien. La hauteur donne le nombre
 * de commandes, pas le chiffre d'affaires — c'est le personnel qu'on
 * dimensionne avec ce graphique, pas la trésorerie.
 */
export function PeakHoursCard({ days = 7 }: { days?: number }) {
  const [data, setData] = useState<PeakHours | null>(null)

  useEffect(() => {
    reports.peakHours(days).then(setData).catch(() => setData(null))
  }, [days])

  if (!data) return <Skeleton className="h-48" />

  if (data.hours.length === 0) {
    return (
      <div>
        <SectionTitle>Heures de pointe</SectionTitle>
        <Card className="p-5">
          <p className="text-[13.5px] text-ink-500">
            Pas encore assez de commandes encaissées pour dégager un rythme.
          </p>
        </Card>
      </div>
    )
  }

  const maxi = Math.max(...data.hours.map((h) => h.orders))

  return (
    <div>
      <SectionTitle>Heures de pointe</SectionTitle>
      <Card className="p-5">
        {data.busiest && (
          <p className="mb-4 text-[13.5px] text-ink-600">
            Le plus chargé entre{' '}
            <span className="num font-bold text-ink-900">
              {String(data.busiest.hour).padStart(2, '0')} h
            </span>{' '}
            et{' '}
            <span className="num font-bold text-ink-900">
              {String(data.busiest.hour + 1).padStart(2, '0')} h
            </span>{' '}
            · <span className="num">{data.busiest.orders}</span> commandes sur{' '}
            {data.days} jours
          </p>
        )}

        <div className="flex items-end gap-1.5" style={{ height: 150 }}>
          {data.hours.map((h) => {
            const hauteur = Math.max(4, (h.orders / maxi) * 118)
            const pointe = h.orders === maxi
            return (
              <div key={h.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="num text-[10.5px] font-semibold text-ink-500">
                  {h.orders}
                </span>
                <div
                  title={`${h.orders} commandes · ${money(h.revenue)} DT`}
                  style={{ height: hauteur }}
                  className={`w-full rounded-t-[4px] ${
                    pointe ? 'bg-petrol-600' : 'bg-petrol-200'
                  }`}
                />
                <span className="num text-[10.5px] text-ink-400">
                  {String(h.hour).padStart(2, '0')}
                </span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

/* ───────────────────────── Marges ───────────────────────── */

/**
 * Ce que rapporte chaque plat, une fois ses ingrédients payés.
 *
 * Le classement par quantité vendue flatte les boissons ; celui-ci dit où
 * est l'argent. Un plat sans recette ne peut pas être évalué, et c'est
 * dit plutôt que d'afficher une marge fausse de 100 %.
 */
export function MarginsCard() {
  const [data, setData] = useState<ProductMargin[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    reports
      .margins()
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Skeleton className="h-56" />
  if (data.length === 0) return null

  const avecRecette = data.filter((p) => p.hasRecipe)
  const sansRecette = data.filter((p) => !p.hasRecipe)

  return (
    <div>
      <SectionTitle>Ce que rapporte chaque plat</SectionTitle>
      <Card className="divide-y divide-ink-100">
        {avecRecette.slice(0, 10).map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-ink-900">{p.name}</p>
              <p className="num text-[12.5px] text-ink-500">
                {money(p.price)} − {money(p.cost)} de matière
                {p.soldCount > 0 && ` · ${p.soldCount} vendus`}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-[15px] font-bold text-ink-900">
                {money(p.margin)} DT
              </p>
              <p
                className={`num text-[12px] font-semibold ${
                  p.marginPercent >= 60
                    ? 'text-petrol-700'
                    : p.marginPercent >= 35
                      ? 'text-ink-500'
                      : 'text-coral-600'
                }`}
              >
                {p.marginPercent} %
              </p>
            </div>
          </div>
        ))}
      </Card>

      {sansRecette.length > 0 && (
        <p className="mt-2 px-1 text-[12.5px] leading-snug text-ink-500">
          {sansRecette.length} plat{sansRecette.length > 1 ? 's' : ''} sans recette :
          leur marge ne peut pas être calculée. Renseignez-la dans Carte pour les voir
          apparaître ici.
        </p>
      )}
    </div>
  )
}

/* ───────────────────────── Export ───────────────────────── */

export function ExportButton({ from }: { from?: Date }) {
  const [busy, setBusy] = useState(false)
  const { notify } = useToast()

  const telecharger = useCallback(async () => {
    setBusy(true)
    try {
      const blob = await reports.exportCsv(from)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ventes-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      notify('Export téléchargé.', 'success')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Export impossible.', 'error')
    } finally {
      setBusy(false)
    }
  }, [from, notify])

  return (
    <Button variant="secondary" size="sm" icon={Download} loading={busy} onClick={telecharger}>
      Export comptable
    </Button>
  )
}
