import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { reports } from '../../lib/api'
import { dateTime, moneyDT } from '../../lib/format'
import type { CashSession } from '../../lib/types'
import { Card, Chip, EmptyState, Skeleton } from '../../components/ui'

export default function CashSessionsPage() {
  const [sessions, setSessions] = useState<CashSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    reports
      .cashSessions()
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-2 px-4 py-6 sm:px-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <Card>
          <EmptyState
            icon={Wallet}
            title="Aucune session de caisse"
            description="L'historique se remplit dès la première ouverture de caisse."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-2.5 px-4 py-6 sm:px-6">
      {sessions.map((s) => {
        const gap = s.discrepancy ?? 0
        const closed = !s.isOpen && s.closingAmount != null
        const balanced = closed && Math.abs(gap) < 0.01

        return (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-semibold text-ink-900">
                {dateTime(s.openedAt)}
              </span>
              {s.isOpen ? (
                <Chip tone="petrol">Ouverte</Chip>
              ) : balanced ? (
                <Chip tone="petrol">Équilibrée</Chip>
              ) : gap > 0 ? (
                <Chip tone="saffron">Excédent</Chip>
              ) : (
                <Chip tone="coral">Manquant</Chip>
              )}
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13.5px] sm:grid-cols-4">
              <Cell label="Fond initial" value={moneyDT(s.openingFloat)} />
              {s.expectedAmount != null && (
                <Cell label="Attendu" value={moneyDT(s.expectedAmount)} />
              )}
              {s.closingAmount != null && (
                <Cell label="Compté" value={moneyDT(s.closingAmount)} />
              )}
              {closed && !balanced && (
                <Cell
                  label="Écart"
                  value={moneyDT(Math.abs(gap))}
                  tone={gap > 0 ? 'text-saffron-700' : 'text-coral-700'}
                />
              )}
            </dl>
          </Card>
        )
      })}
    </div>
  )
}

function Cell({
  label,
  value,
  tone = 'text-ink-900',
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <div>
      <dt className="text-[11.5px] text-ink-500">{label}</dt>
      <dd className={`num text-[14px] font-semibold ${tone}`}>{value}</dd>
    </div>
  )
}
