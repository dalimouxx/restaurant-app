import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Ban,
  ClipboardList,
  Package,
  ScrollText,
  Tag,
  Wallet,
} from 'lucide-react'
import { reports } from '../../lib/api'
import { dateTime, money, roleLabel } from '../../lib/format'
import type { AuditEntry } from '../../lib/types'
import { Card, Chip, EmptyState, SectionTitle, Skeleton, useToast } from '../../components/ui'

/**
 * Registre des opérations sensibles.
 *
 * Une caisse où l'on peut annuler sans laisser de trace n'est pas une
 * caisse. Cet écran est la contrepartie du droit d'annuler qu'on a donné
 * au personnel : tout ce qui touche à l'argent ou aux prix se retrouve
 * ici, avec un nom et une heure, et rien ne peut en être effacé.
 */

type Family = 'all' | 'order.cancelled' | 'product.price_changed' | 'cash.closed_with_discrepancy'

const FILTERS: { key: Family; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'order.cancelled', label: 'Annulations' },
  { key: 'product.price_changed', label: 'Prix' },
  { key: 'cash.closed_with_discrepancy', label: 'Écarts de caisse' },
]

/** Apparence de chaque type d'opération dans la liste. */
const LOOK: Record<
  string,
  { icon: typeof Ban; tone: 'coral' | 'saffron' | 'sky' | 'petrol' | 'neutral'; label: string }
> = {
  'order.cancelled': { icon: Ban, tone: 'coral', label: 'Annulation' },
  'product.price_changed': { icon: Tag, tone: 'saffron', label: 'Prix' },
  'product.archived': { icon: Package, tone: 'neutral', label: 'Retrait carte' },
  'product.deleted': { icon: Package, tone: 'neutral', label: 'Suppression' },
  'product.marked_sold_out': { icon: Package, tone: 'saffron', label: 'Épuisé' },
  'product.back_on_sale': { icon: Package, tone: 'petrol', label: 'Remis en vente' },
  'cash.closed_with_discrepancy': { icon: Wallet, tone: 'coral', label: 'Écart de caisse' },
}

const FALLBACK = { icon: ClipboardList, tone: 'neutral' as const, label: 'Opération' }

export default function JournalPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Family>('all')
  const { notify } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(
        await reports.audit(filter === 'all' ? { limit: 150 } : { action: filter, limit: 150 }),
      )
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Journal illisible.', 'error')
    } finally {
      setLoading(false)
    }
  }, [filter, notify])

  useEffect(() => {
    load()
  }, [load])

  /** Ce que le gérant regarde en premier : combien, et pour quel montant. */
  const cancellations = useMemo(() => {
    const rows = entries.filter((e) => e.action === 'order.cancelled')
    const paid = rows.filter((e) => e.details?.wasPaid === true)
    const total = paid.reduce((sum, e) => sum + Number(e.details?.totalAmount ?? 0), 0)
    return { count: rows.length, paidCount: paid.length, total }
  }, [entries])

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {cancellations.count > 0 && filter !== 'product.price_changed' && (
        <Card className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
          <Figure value={String(cancellations.count)} label="annulations" />
          <Figure
            value={String(cancellations.paidCount)}
            label="après encaissement"
            alert={cancellations.paidCount > 0}
          />
          <Figure
            value={`${money(cancellations.total)} DT`}
            label="rendus au client"
            alert={cancellations.total > 0}
          />
        </Card>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`h-8 rounded-[7px] px-3 text-[13px] font-semibold transition-colors ${
              filter === f.key
                ? 'bg-ink-900 text-white'
                : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <SectionTitle>Registre</SectionTitle>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[62px]" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={ScrollText}
            title="Rien à signaler"
            description="Les annulations, changements de prix et écarts de caisse s'inscriront ici automatiquement."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </Card>
      )}

      <p className="mt-3 px-1 text-[12.5px] leading-snug text-ink-500">
        Ce registre s'écrit uniquement par ajout. Aucune action de l'application ne permet
        d'en modifier ou d'en effacer une ligne, y compris pour vous.
      </p>
    </div>
  )
}

function Figure({
  value,
  label,
  alert = false,
}: {
  value: string
  label: string
  alert?: boolean
}) {
  return (
    <div>
      <p className={`num text-[22px] font-bold ${alert ? 'text-coral-600' : 'text-ink-900'}`}>
        {value}
      </p>
      <p className="text-[12.5px] text-ink-500">{label}</p>
    </div>
  )
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const look = LOOK[entry.action] ?? FALLBACK
  const Icon = look.icon

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div
        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-[8px] ${
          look.tone === 'coral'
            ? 'bg-coral-50 text-coral-600'
            : look.tone === 'saffron'
              ? 'bg-saffron-50 text-saffron-700'
              : look.tone === 'petrol'
                ? 'bg-petrol-50 text-petrol-700'
                : 'bg-ink-100 text-ink-500'
        }`}
      >
        <Icon size={15} strokeWidth={2.2} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[13.5px] font-semibold text-ink-900">{entry.summary}</p>
          <Chip tone={look.tone}>{look.label}</Chip>
        </div>
        <p className="mt-0.5 text-[12px] text-ink-500">
          {entry.userName}
          <span className="text-ink-400">
            {' '}
            · {roleLabel[entry.userRole as keyof typeof roleLabel] ?? entry.userRole} ·{' '}
            {dateTime(entry.createdAt)}
          </span>
        </p>
      </div>
    </div>
  )
}
