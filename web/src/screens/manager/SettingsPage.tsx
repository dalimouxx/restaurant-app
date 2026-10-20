import { useEffect, useState } from 'react'
import { Printer, Store } from 'lucide-react'
import { settingsApi } from '../../lib/api'
import type { Settings } from '../../lib/types'
import {
  Button,
  Card,
  Field,
  Input,
  SectionTitle,
  Skeleton,
  useToast,
} from '../../components/ui'
import { OpeningHoursCard } from './OpeningHoursCard'
import { DeliveryZonesCard } from './DeliveryZonesCard'
import { MapTilesCard } from './MapTilesCard'

/**
 * Informations de l'établissement. Elles figurent en tête de chaque reçu,
 * d'où l'aperçu à côté du formulaire : on voit ce que le client recevra.
 */
export default function SettingsPage() {
  const [form, setForm] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    settingsApi
      .get()
      .then(setForm)
      .catch(() => notify('Réglages illisibles.', 'error'))
  }, [notify])

  async function save() {
    if (!form) return
    setBusy(true)
    try {
      setForm(await settingsApi.save(form))
      notify('Réglages enregistrés.', 'success')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Enregistrement refusé.', 'error')
    } finally {
      setBusy(false)
    }
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }

  if (!form) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-6">
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-7 px-4 py-6 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <SectionTitle>Établissement</SectionTitle>
          <Card className="space-y-3.5 p-5">
            <Field label="Nom" hint="En tête du reçu">
              <Input
                value={form.restaurantName}
                onChange={(e) => set('restaurantName', e.target.value)}
              />
            </Field>
            <Field label="Adresse">
              <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Téléphone">
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </Field>
              <Field label="Matricule fiscal" hint="Facultatif">
                <Input value={form.taxId} onChange={(e) => set('taxId', e.target.value)} />
              </Field>
            </div>
            <Field label="Mention de bas de ticket">
              <Input
                value={form.ticketFooter}
                onChange={(e) => set('ticketFooter', e.target.value)}
                placeholder="Merci de votre visite"
              />
            </Field>
            <Field label="Monnaie" hint="Affichée après les montants">
              <Input
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                className="w-24"
              />
            </Field>

            <div className="flex justify-end pt-1">
              <Button onClick={save} loading={busy}>
                Enregistrer
              </Button>
            </div>
          </Card>
        </div>

        {/* Aperçu : ce que le client lira en haut de son reçu. */}
        <div>
          <SectionTitle>Aperçu</SectionTitle>
          <Card className="p-4">
            <div className="rounded-[9px] border border-dashed border-ink-300 bg-white p-4 text-center font-mono">
              <p className="text-[15px] font-semibold text-ink-900">
                {form.restaurantName || '—'}
              </p>
              {form.address && <p className="text-[11px] text-ink-600">{form.address}</p>}
              {form.phone && <p className="text-[11px] text-ink-600">Tél. {form.phone}</p>}
              {form.taxId && <p className="text-[11px] text-ink-600">MF {form.taxId}</p>}
              <div className="my-2.5 border-t border-dashed border-ink-300" />
              <p className="text-[12px] font-semibold text-ink-700">REÇU #001</p>
              <div className="my-2.5 border-t border-dashed border-ink-300" />
              <div className="flex justify-between text-[12px] font-semibold text-ink-900">
                <span>TOTAL</span>
                <span>20,00 {form.currency}</span>
              </div>
              <div className="my-2.5 border-t border-dashed border-ink-300" />
              <p className="text-[11px] text-ink-600">{form.ticketFooter}</p>
            </div>

            <div className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-ink-500">
              <Printer size={14} className="mt-px shrink-0" />
              <span>
                Les tickets s'impriment au format 80&nbsp;mm sur l'imprimante installée
                sur le poste.
              </span>
            </div>
          </Card>

          <div className="mt-3 flex items-start gap-2 rounded-[11px] bg-ink-100 p-3.5 text-[12.5px] leading-snug text-ink-600">
            <Store size={15} className="mt-px shrink-0 text-ink-400" />
            <span>
              Ces informations apparaissent sur chaque reçu client et bon de livraison.
              Le bon de cuisine, lui, ne porte que le numéro et les plats.
            </span>
          </div>
        </div>
      </div>

      <OpeningHoursCard
        hours={form.openingHours}
        opening={form.opening}
        onChange={(openingHours) => set('openingHours', openingHours)}
      />

      <DeliveryZonesCard />

      <MapTilesCard
        tileUrl={form.mapTileUrl}
        attribution={form.mapAttribution}
        busy={busy}
        onChange={(patch) => setForm((f) => (f ? { ...f, ...patch } : f))}
        onSave={save}
      />
    </div>
  )
}
