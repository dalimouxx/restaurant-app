import { Clock } from 'lucide-react'
import type { DayHours, OpeningState, WeekDay } from '../../lib/types'
import { Card, Chip, SectionTitle } from '../../components/ui'

const DAYS: { key: WeekDay; label: string }[] = [
  { key: 'mon', label: 'Lundi' },
  { key: 'tue', label: 'Mardi' },
  { key: 'wed', label: 'Mercredi' },
  { key: 'thu', label: 'Jeudi' },
  { key: 'fri', label: 'Vendredi' },
  { key: 'sat', label: 'Samedi' },
  { key: 'sun', label: 'Dimanche' },
]

/**
 * Horaires d'ouverture.
 *
 * Ils ne ferment que la commande en ligne : la caisse encaisse quand elle
 * veut. Une caisse qui refuse de servir parce qu'il est 23 h 05 serait
 * absurde, et le personnel ne doit jamais avoir à discuter avec un écran.
 */
export function OpeningHoursCard({
  hours,
  opening,
  onChange,
}: {
  hours: Record<WeekDay, DayHours>
  opening: OpeningState
  onChange: (next: Record<WeekDay, DayHours>) => void
}) {
  function set(day: WeekDay, patch: Partial<DayHours>) {
    onChange({ ...hours, [day]: { ...hours[day], ...patch } })
  }

  /** Reporte les horaires du jour sur toute la semaine. */
  function applyToAll(day: WeekDay) {
    const model = hours[day]
    onChange(
      Object.fromEntries(DAYS.map((d) => [d.key, { ...model }])) as Record<WeekDay, DayHours>,
    )
  }

  return (
    <div>
      <SectionTitle>Horaires d'ouverture</SectionTitle>
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {opening.open ? (
            <Chip tone="petrol">Ouvert en ce moment</Chip>
          ) : (
            <Chip tone="coral">Fermé en ce moment</Chip>
          )}
          {!opening.open && opening.opensAt && (
            <span className="text-[12.5px] text-ink-500">
              Réouverture {opening.opensDay} à{' '}
              <span className="num font-semibold">{opening.opensAt}</span>
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          {DAYS.map(({ key, label }) => {
            const day = hours[key]
            const overnight = !day.closed && day.close < day.open
            return (
              <div key={key} className="flex flex-wrap items-center gap-2.5">
                <span className="w-24 shrink-0 text-[13.5px] font-semibold text-ink-800">
                  {label}
                </span>

                <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!day.closed}
                    onChange={(e) => set(key, { closed: !e.target.checked })}
                    className="size-4 accent-petrol-600"
                  />
                  <span className="text-[12.5px] text-ink-500">Ouvert</span>
                </label>

                {day.closed ? (
                  <span className="text-[13px] text-ink-400">Fermé toute la journée</span>
                ) : (
                  <>
                    <input
                      type="time"
                      value={day.open}
                      onChange={(e) => set(key, { open: e.target.value })}
                      className="num h-9 rounded-[7px] border border-ink-200 px-2 text-[13.5px] focus:border-petrol-500 focus:outline-none"
                    />
                    <span className="text-ink-400">→</span>
                    <input
                      type="time"
                      value={day.close}
                      onChange={(e) => set(key, { close: e.target.value })}
                      className="num h-9 rounded-[7px] border border-ink-200 px-2 text-[13.5px] focus:border-petrol-500 focus:outline-none"
                    />
                    {overnight && (
                      <span className="text-[11.5px] font-semibold text-sky-600">
                        jusqu'au lendemain
                      </span>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => applyToAll(key)}
                  title="Appliquer à toute la semaine"
                  className="ml-auto text-[11.5px] font-semibold text-ink-400 transition-colors hover:text-petrol-600"
                >
                  Partout
                </button>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-[9px] bg-ink-100 p-3.5 text-[12.5px] leading-snug text-ink-600">
          <Clock size={15} className="mt-px shrink-0 text-ink-400" />
          <span>
            Hors de ces heures, le site refuse les commandes et annonce l'heure de
            réouverture. La caisse, la borne et la cuisine ne sont jamais bloquées.
          </span>
        </div>
      </Card>
    </div>
  )
}
