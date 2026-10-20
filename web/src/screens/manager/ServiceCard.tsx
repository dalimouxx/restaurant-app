import { Bike, ChefHat, Wallet } from 'lucide-react'
import type { Settings } from '../../lib/types'
import { Button, Card, SectionTitle } from '../../components/ui'

/**
 * Déroulé du service.
 *
 * Tous les établissements ne travaillent pas pareil, et le même
 * établissement ne travaille pas pareil à midi et à 22 h. Un fastfood
 * qui sort un sandwich en deux minutes n'a que faire de « en
 * préparation » puis « prête » : c'est un appui de plus à chaque
 * commande, pour une information que personne ne lit. Et certains soirs
 * il n'y a ni caissier ni livreur.
 *
 * Ces trois réglages se changent en plein coup de feu, d'où les gros
 * boutons : on les touche avec les doigts gras et sans lire.
 */

type Choix<T extends string> = { valeur: T; titre: string; detail: string }

const CUISINE: Choix<Settings['etapesCuisine']>[] = [
  {
    valeur: 'deux',
    titre: 'Deux étapes',
    detail: 'En préparation, puis prête. Pour une cuisine qui mijote.',
  },
  {
    valeur: 'une',
    titre: 'Un seul geste',
    detail: 'Un bouton « prête » et c\'est tout. Le rythme d\'un fastfood.',
  },
  {
    valeur: 'aucune',
    titre: 'Pas d\'écran de cuisine',
    detail: 'La commande est prête dès l\'encaissement, et appelée en salle.',
  },
]

function Bascule<T extends string>({
  choix,
  actuel,
  onChange,
}: {
  choix: Choix<T>[]
  actuel: T
  onChange: (v: T) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {choix.map((c) => {
        const actif = c.valeur === actuel
        return (
          <button
            key={c.valeur}
            onClick={() => onChange(c.valeur)}
            aria-pressed={actif}
            className={`rounded-[11px] border-2 p-3.5 text-left transition-colors ${
              actif
                ? 'border-petrol-600 bg-petrol-50'
                : 'border-ink-200 hover:border-ink-300'
            }`}
          >
            <p
              className={`text-[14px] font-bold ${
                actif ? 'text-petrol-800' : 'text-ink-900'
              }`}
            >
              {c.titre}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{c.detail}</p>
          </button>
        )
      })}
    </div>
  )
}

function Interrupteur({
  actif,
  onChange,
  actifTexte,
  inactifTexte,
}: {
  actif: boolean
  onChange: (v: boolean) => void
  actifTexte: string
  inactifTexte: string
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          onClick={() => onChange(v)}
          aria-pressed={actif === v}
          className={`rounded-[11px] border-2 px-4 py-3 text-left text-[14px] font-bold transition-colors ${
            actif === v
              ? v
                ? 'border-petrol-600 bg-petrol-50 text-petrol-800'
                : 'border-coral-500 bg-coral-50 text-coral-700'
              : 'border-ink-200 text-ink-900 hover:border-ink-300'
          }`}
        >
          {v ? actifTexte : inactifTexte}
        </button>
      ))}
    </div>
  )
}

export function ServiceCard({
  form,
  busy,
  onChange,
  onSave,
}: {
  form: Settings
  busy: boolean
  onChange: (patch: Partial<Settings>) => void
  onSave: () => void
}) {
  return (
    <div>
      <SectionTitle>Déroulé du service</SectionTitle>
      <Card className="space-y-6 p-5">
        <div>
          <p className="mb-2.5 flex items-center gap-2 text-[13.5px] font-bold text-ink-900">
            <ChefHat size={15} className="text-ink-400" />
            Étapes en cuisine
          </p>
          <Bascule
            choix={CUISINE}
            actuel={form.etapesCuisine}
            onChange={(v) => onChange({ etapesCuisine: v })}
          />
        </div>

        <div>
          <p className="mb-2.5 flex items-center gap-2 text-[13.5px] font-bold text-ink-900">
            <Bike size={15} className="text-ink-400" />
            Livraison
          </p>
          <Interrupteur
            actif={form.livraisonActive === 'oui'}
            onChange={(v) => onChange({ livraisonActive: v ? 'oui' : 'non' })}
            actifTexte="Ouverte"
            inactifTexte="Suspendue — aucun livreur"
          />
          {form.livraisonActive !== 'oui' && (
            <p className="mt-2 text-[12.5px] leading-snug text-ink-500">
              La livraison disparaît de la borne et du site. Les courses déjà
              acceptées vont jusqu'au bout : personne n'est laissé en plan.
            </p>
          )}
        </div>

        <div>
          <p className="mb-2.5 flex items-center gap-2 text-[13.5px] font-bold text-ink-900">
            <Wallet size={15} className="text-ink-400" />
            Caisse
          </p>
          <Interrupteur
            actif={form.caisseSimplifiee !== 'oui'}
            onChange={(v) => onChange({ caisseSimplifiee: v ? 'non' : 'oui' })}
            actifTexte="Complète — session et moyens de paiement"
            inactifTexte="Un seul geste — sans caissier"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <p className="text-[12px] leading-snug text-ink-500">
            Ces réglages se changent en plein service. Les autres postes les
            prennent à leur prochain chargement.
          </p>
          <Button onClick={onSave} loading={busy}>
            Enregistrer
          </Button>
        </div>
      </Card>
    </div>
  )
}
