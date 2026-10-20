import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { reports } from '../../lib/api'
import { money, moneyDT } from '../../lib/format'
import type { Ingredient, NetProfitReport, TopProduct } from '../../lib/types'
import { Card, EmptyState, SectionTitle, Skeleton } from '../../components/ui'
import {
  ComparisonCard,
  ExportButton,
  MarginsCard,
  PeakHoursCard,
} from './InsightsCards'

type Period = 'today' | 'week' | 'month' | 'all'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: "Aujourd'hui" },
  { value: 'week', label: '7 jours' },
  { value: 'month', label: 'Ce mois' },
  { value: 'all', label: 'Tout' },
]

function periodStart(p: Period): Date | undefined {
  const now = new Date()
  if (p === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (p === 'week') return new Date(now.getTime() - 7 * 864e5)
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return undefined
}

export default function FinancePage() {
  const [period, setPeriod] = useState<Period>('today')
  const [report, setReport] = useState<NetProfitReport | null>(null)
  const [top, setTop] = useState<TopProduct[]>([])
  const [low, setLow] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, t, l] = await Promise.all([
        reports.netProfit(periodStart(period)),
        reports.topProducts(),
        reports.lowStock(),
      ])
      setReport(r)
      setTop(t)
      setLow(l)
    } catch {
      /* affiché par l'état vide */
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    load()
  }, [load])

  const margin =
    report && report.totalRevenue > 0
      ? (report.netProfit / report.totalRevenue) * 100
      : null

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex justify-end">
        <ExportButton from={periodStart(period)} />
      </div>

      <div className="mb-5 flex gap-1 rounded-[10px] border border-ink-200 bg-white p-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`flex-1 rounded-[7px] py-2 text-[13.5px] font-semibold transition-colors ${
              period === p.value
                ? 'bg-ink-900 text-white'
                : 'text-ink-600 hover:bg-ink-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      ) : !report ? (
        <EmptyState
          icon={TrendingUp}
          title="Chiffres indisponibles"
          description="Vérifiez que le serveur répond."
        />
      ) : (
        <div className="space-y-6">
          {/* Bénéfice net */}
          <div className="rounded-[15px] bg-ink-900 p-6">
            <p className="text-[13px] text-ink-400">Bénéfice net</p>
            <p className="num mt-1.5 text-[40px] leading-none font-extrabold tracking-[-0.035em] text-white sm:text-[48px]">
              {moneyDT(report.netProfit)}
            </p>
            <p className="mt-2 text-[13px] text-ink-500">
              {report.ordersCount} commande{report.ordersCount > 1 ? 's' : ''}
              {margin !== null && (
                <>
                  {' · marge de '}
                  <span className="tnum font-semibold text-petrol-400">
                    {margin.toFixed(1)} %
                  </span>
                </>
              )}
            </p>

            {/* Décomposition en une barre : où part l'argent encaissé */}
            {report.totalRevenue > 0 && (
              <div className="mt-5">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-ink-800">
                  <Segment
                    value={report.ingredientCost}
                    total={report.totalRevenue}
                    className="bg-saffron-500"
                  />
                  <Segment
                    value={report.driverPayout}
                    total={report.totalRevenue}
                    className="bg-coral-500"
                  />
                  <Segment
                    value={Math.max(report.netProfit, 0)}
                    total={report.totalRevenue}
                    className="bg-petrol-500"
                  />
                </div>
                <dl className="mt-3.5 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
                  <Legend
                    color="bg-ink-400"
                    label="Encaissé"
                    value={money(report.totalRevenue)}
                  />
                  <Legend
                    color="bg-saffron-500"
                    label="Ingrédients"
                    value={money(report.ingredientCost)}
                  />
                  <Legend
                    color="bg-coral-500"
                    label="Livreurs"
                    value={money(report.driverPayout)}
                  />
                  <Legend
                    color="bg-petrol-500"
                    label="Reste"
                    value={money(report.netProfit)}
                  />
                </dl>
              </div>
            )}
          </div>

          {/* Alerte stock */}
          {low.length > 0 && (
            <div className="flex items-start gap-3 rounded-[13px] border border-saffron-500/35 bg-saffron-50 px-4 py-3.5">
              <AlertTriangle
                size={18}
                className="mt-0.5 shrink-0 text-saffron-600"
                strokeWidth={2.2}
              />
              <div>
                <p className="text-[14px] font-bold text-saffron-700">
                  {low.length} ingrédient{low.length > 1 ? 's' : ''} sous le seuil
                </p>
                <p className="mt-0.5 text-[13px] text-saffron-700/90">
                  {low.map((i) => i.name).join(', ')}. Les plats concernés se désactivent
                  automatiquement en rupture.
                </p>
              </div>
            </div>
          )}

          {/* Ventes par produit */}
          <div>
            <SectionTitle>Ce qui se vend</SectionTitle>
            {top.length === 0 ? (
              <Card>
                <EmptyState
                  icon={TrendingUp}
                  title="Aucune vente enregistrée"
                  description="Les ventes apparaîtront ici dès le premier encaissement."
                />
              </Card>
            ) : (
              <Card className="p-4">
                <div className="h-[260px] w-full">
                  <ResponsiveContainer>
                    <BarChart
                      data={top.slice(0, 8)}
                      margin={{ top: 4, right: 4, bottom: 4, left: -18 }}
                    >
                      <CartesianGrid
                        stroke="#dfe4e9"
                        strokeDasharray="2 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11.5, fill: '#5a6672' }}
                        tickLine={false}
                        axisLine={{ stroke: '#dfe4e9' }}
                        interval={0}
                        height={48}
                        tickFormatter={(v: string) =>
                          v.length > 14 ? `${v.slice(0, 13)}…` : v
                        }
                      />
                      <YAxis
                        tick={{ fontSize: 11.5, fill: '#8b96a1' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: '#eceff2' }}
                        contentStyle={{
                          borderRadius: 10,
                          border: '1px solid #dfe4e9',
                          fontSize: 13,
                          boxShadow: '0 8px 24px -12px rgba(16,20,24,.3)',
                        }}
                        formatter={(v) => [`${Number(v ?? 0)} vendus`, '']}
                      />
                      <Bar dataKey="quantitySold" fill="#0B6B5B" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <ul className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
                  {top.slice(0, 6).map((p) => (
                    <li key={p.name} className="flex items-center gap-3 py-2.5">
                      <span className="flex-1 text-[14px] font-medium text-ink-800">
                        {p.name}
                      </span>
                      <span className="num text-[13px] text-ink-500">
                        {p.quantitySold} vendus
                      </span>
                      <span className="num w-[86px] text-right text-[14px] font-bold text-ink-900">
                        {money(p.revenue)} DT
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
          <ComparisonCard days={7} />
          <PeakHoursCard days={7} />
          <MarginsCard />
        </div>
      )}
    </div>
  )
}

function Segment({
  value,
  total,
  className,
}: {
  value: number
  total: number
  className: string
}) {
  const pct = Math.max(0, Math.min(100, (value / total) * 100))
  if (pct <= 0) return null
  return <span className={className} style={{ width: `${pct}%` }} />
}

function Legend({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${color}`} />
      <div className="min-w-0">
        <dt className="text-[11.5px] text-ink-500">{label}</dt>
        <dd className="num text-[13.5px] font-semibold text-white">{value}</dd>
      </div>
    </div>
  )
}
