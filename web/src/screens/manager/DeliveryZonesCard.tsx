import { useCallback, useEffect, useState } from 'react'
import { Bike, Plus, Trash2 } from 'lucide-react'
import { zones as zonesApi } from '../../lib/api'
import { money } from '../../lib/format'
import type { DeliveryZone } from '../../lib/types'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionTitle,
  Skeleton,
  useToast,
} from '../../components/ui'

/**
 * Zones de livraison.
 *
 * Un tarif unique pour toute la ville fait perdre de l'argent sur les
 * courses lointaines et en fait gagner trop sur celles d'en face. Le
 * minimum de commande sert à refuser poliment une livraison de deux
 * dinars à l'autre bout de Gabès.
 */
export function DeliveryZonesCard() {
  const [list, setList] = useState<DeliveryZone[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<DeliveryZone | 'new' | null>(null)
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      setList(await zonesApi.all())
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Zones illisibles.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  async function disable(zone: DeliveryZone) {
    try {
      await zonesApi.disable(zone.id)
      notify(`${zone.name} retirée de la livraison.`, 'success')
      load()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Retrait refusé.', 'error')
    }
  }

  const active = list.filter((z) => z.isActive)

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <SectionTitle>Zones de livraison</SectionTitle>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          className="mb-2"
          onClick={() => setEditing('new')}
        >
          Nouvelle zone
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-28" />
      ) : active.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bike}
            title="Aucune zone"
            description="Sans zone, la livraison est refusée au client. Découpez votre ville : un tarif par quartier."
            action={
              <Button icon={Plus} onClick={() => setEditing('new')}>
                Nouvelle zone
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100">
          {active.map((zone) => (
            <div key={zone.id} className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => setEditing(zone)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-[14px] font-semibold text-ink-900">{zone.name}</p>
                <p className="text-[12.5px] text-ink-500">
                  <span className="num font-semibold text-ink-700">
                    {money(zone.fee)} DT
                  </span>
                  {zone.minimumOrder > 0 && (
                    <> · minimum <span className="num">{money(zone.minimumOrder)}</span> DT</>
                  )}
                </p>
              </button>
              <span className="num shrink-0 text-[12.5px] text-ink-400">
                ~{zone.estimatedMinutes} min
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                aria-label="Retirer la zone"
                onClick={() => disable(zone)}
              />
            </div>
          ))}
        </Card>
      )}

      <ZoneModal
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
    </div>
  )
}

function ZoneModal({
  target,
  onClose,
  onSaved,
}: {
  target: DeliveryZone | 'new' | null
  onClose: () => void
  onSaved: () => void
}) {
  const zone = target === 'new' || target === null ? null : target
  const open = target !== null

  const [name, setName] = useState('')
  const [fee, setFee] = useState('')
  const [minimum, setMinimum] = useState('')
  const [minutes, setMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (!open) return
    setName(zone?.name ?? '')
    setFee(zone ? String(zone.fee) : '')
    setMinimum(zone ? String(zone.minimumOrder) : '0')
    setMinutes(zone ? String(zone.estimatedMinutes) : '30')
  }, [open, zone])

  async function save() {
    if (name.trim().length < 2) {
      notify('Donnez un nom à la zone.', 'error')
      return
    }
    const body = {
      name: name.trim(),
      fee: Number(fee.replace(',', '.')) || 0,
      minimumOrder: Number(minimum.replace(',', '.')) || 0,
      estimatedMinutes: Number(minutes) || 30,
    }
    setBusy(true)
    try {
      if (zone) await zonesApi.update(zone.id, body)
      else await zonesApi.create(body)
      notify('Zone enregistrée.', 'success')
      onSaved()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Enregistrement refusé.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={zone ? zone.name : 'Nouvelle zone'}
      description="Le client choisit sa zone, et c'est elle qui fixe les frais."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Nom du quartier">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Centre-ville"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Frais de livraison" hint="En dinars">
            <Input
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="0,000"
              className="num"
            />
          </Field>
          <Field label="Minimum de commande" hint="0 = aucun">
            <Input
              inputMode="decimal"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
              placeholder="0,000"
              className="num"
            />
          </Field>
        </div>
        <Field label="Délai annoncé" hint="En minutes, indicatif">
          <Input
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="num w-24"
          />
        </Field>
      </div>
    </Modal>
  )
}
