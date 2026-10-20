import { useMemo, useState } from 'react'
import { Map, TriangleAlert } from 'lucide-react'
import { Button, Card, Field, Input, Select, SectionTitle } from '../../components/ui'

/**
 * Fond de carte du suivi de livraison.
 *
 * Le serveur public d'OpenStreetMap est tenu par des bénévoles : sa
 * politique le réserve à un trafic modeste, et passé ce seuil il renvoie
 * des tuiles barrées « Access blocked » — des images parfaitement valides,
 * donc aucune erreur réseau à intercepter, juste une carte illisible.
 * Un restaurant qui livre tous les jours doit brancher son propre
 * fournisseur.
 *
 * D'où cet écran plutôt qu'une adresse figée dans le code : le gérant
 * choisit sa maison, colle sa clé, et vérifie d'un clic. L'aperçu affiche
 * la tuile réellement reçue : c'est le seul contrôle qui ne mente pas,
 * puisqu'une tuile de refus arrive avec un code 200 comme une autre.
 */

interface Fournisseur {
  id: string
  nom: string
  /** CLE est remplacé par la clé saisie. */
  modele: string
  attribution: string
  cle: boolean
  inscription?: string
  note: string
}

const FOURNISSEURS: Fournisseur[] = [
  {
    id: 'osm',
    nom: 'OpenStreetMap public — essais seulement',
    modele: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    cle: false,
    note: "Serveur bénévole, réservé à un trafic modeste. Il finit par renvoyer des tuiles barrées : à ne pas laisser sur une installation qui tourne.",
  },
  {
    id: 'limalabs',
    nom: 'Lima Labs',
    modele: 'https://cdn.lima-labs.com/{z}/{x}/{y}.png?api=CLE',
    attribution: '© Lima Labs © OpenStreetMap',
    cle: true,
    inscription: 'https://maps.lima-labs.com/',
    note: 'Offre gratuite large et usage commercial permis — le plus simple pour démarrer.',
  },
  {
    id: 'maptiler',
    nom: 'MapTiler',
    modele: 'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=CLE',
    attribution: '© MapTiler © OpenStreetMap',
    cle: true,
    inscription: 'https://www.maptiler.com/',
    note: 'Gratuit pour le développement ; forfait payant dès la mise en service commerciale.',
  },
  {
    id: 'stadia',
    nom: 'Stadia Maps',
    modele: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png?api_key=CLE',
    attribution: '© Stadia Maps © OpenMapTiles © OpenStreetMap',
    cle: true,
    inscription: 'https://stadiamaps.com/',
    note: 'Fond sobre, très lisible sur un écran de téléphone en plein soleil.',
  },
  {
    id: 'geoapify',
    nom: 'Geoapify',
    modele: 'https://maps.geoapify.com/v1/tile/osm-bright-smooth/{z}/{x}/{y}.png?apiKey=CLE',
    attribution: '© Geoapify © OpenStreetMap',
    cle: true,
    inscription: 'https://www.geoapify.com/',
    note: 'Offre gratuite à faible volume, forfaits ensuite.',
  },
  {
    id: 'thunderforest',
    nom: 'Thunderforest',
    modele: 'https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=CLE',
    attribution: '© Thunderforest © OpenStreetMap',
    cle: true,
    inscription: 'https://www.thunderforest.com/',
    note: 'Offre gratuite, puis forfait au volume.',
  },
  {
    id: 'custom',
    nom: 'Autre fournisseur — adresse complète',
    modele: '',
    attribution: '',
    cle: false,
    note: "Collez l'adresse telle que votre fournisseur la donne, avec {z}, {x}, {y} et votre clé.",
  },
]

/** Tuile de Gabès au zoom 12 : de quoi reconnaître une vraie carte d'un refus. */
function tuileDeControle(modele: string) {
  const z = 12
  const lat = 33.8815
  const lng = 10.0982
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const rad = (lat * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  )
  return modele
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', '')
    .replace('{s}', 'a')
}

export function MapTilesCard({
  tileUrl,
  attribution,
  busy,
  onChange,
  onSave,
}: {
  tileUrl: string
  attribution: string
  busy: boolean
  onChange: (patch: { mapTileUrl?: string; mapAttribution?: string }) => void
  onSave: () => void
}) {
  // La maison est devinée depuis l'adresse enregistrée : on retrouve son
  // réglage au rechargement, sans stocker une clé de plus en base.
  const devine =
    FOURNISSEURS.find(
      (f) => f.modele && tileUrl.startsWith(f.modele.split('{')[0]) && f.id !== 'custom',
    )?.id ?? (tileUrl ? 'custom' : 'osm')

  const [choix, setChoix] = useState(devine)
  const [cle, setCle] = useState(() => {
    const m = tileUrl.match(/(?:key|api_key|apikey|apiKey|api)=([^&]+)/)
    return m ? m[1] : ''
  })
  const [apercu, setApercu] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<'attente' | 'recue' | 'refusee' | null>(null)

  const fournisseur = FOURNISSEURS.find((f) => f.id === choix) ?? FOURNISSEURS[0]

  const adresse = useMemo(() => {
    if (fournisseur.id === 'custom') return tileUrl
    return fournisseur.modele.replace('CLE', cle || 'VOTRE_CLE')
  }, [fournisseur, cle, tileUrl])

  function appliquer(id: string) {
    setChoix(id)
    setApercu(null)
    setVerdict(null)
    const f = FOURNISSEURS.find((x) => x.id === id)
    if (!f || f.id === 'custom') return
    onChange({
      mapTileUrl: f.modele.replace('CLE', cle || 'VOTRE_CLE'),
      mapAttribution: f.attribution,
    })
  }

  function majCle(v: string) {
    setCle(v)
    setApercu(null)
    setVerdict(null)
    if (fournisseur.id !== 'custom') {
      onChange({ mapTileUrl: fournisseur.modele.replace('CLE', v || 'VOTRE_CLE') })
    }
  }

  function tester() {
    setVerdict('attente')
    setApercu(tuileDeControle(tileUrl))
  }

  return (
    <div>
      <SectionTitle>Fond de carte</SectionTitle>
      <Card className="space-y-4 p-5">
        <Field
          label="Fournisseur"
          hint="Change le fond que voient les livreurs et les clients qui suivent leur commande."
        >
          <Select value={choix} onChange={(e) => appliquer(e.target.value)}>
            {FOURNISSEURS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </Select>
        </Field>

        <p className="-mt-1 text-[12.5px] leading-snug text-ink-500">
          {fournisseur.note}
          {fournisseur.inscription && (
            <>
              {' '}
              <a
                href={fournisseur.inscription}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-petrol-700 underline underline-offset-2"
              >
                Créer un compte
              </a>
            </>
          )}
        </p>

        {fournisseur.cle && (
          <Field label="Clé d'accès" hint="Fournie par le fournisseur après inscription.">
            <Input
              value={cle}
              onChange={(e) => majCle(e.target.value)}
              placeholder="collez votre clé ici"
              className="font-mono text-[13px]"
            />
          </Field>
        )}

        {fournisseur.id === 'custom' && (
          <Field label="Adresse des tuiles" hint="Avec les repères {z}, {x}, {y}.">
            <Input
              value={tileUrl}
              onChange={(e) => onChange({ mapTileUrl: e.target.value })}
              placeholder="https://…/{z}/{x}/{y}.png?key=…"
              className="font-mono text-[13px]"
            />
          </Field>
        )}

        <Field label="Mention obligatoire" hint="Affichée en bas de la carte.">
          <Input
            value={attribution}
            onChange={(e) => onChange({ mapAttribution: e.target.value })}
            placeholder="© OpenStreetMap"
          />
        </Field>

        <div className="rounded-[11px] bg-ink-50 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] leading-snug text-ink-600">
              Regardez la tuile reçue. Une carte de Gabès : c'est bon. Un carré
              barré ou vide : le fournisseur refuse.
            </p>
            <Button variant="secondary" size="sm" onClick={tester}>
              Tester
            </Button>
          </div>

          {apercu && (
            <div className="mt-3 flex items-start gap-3">
              <img
                src={apercu}
                alt="Tuile de contrôle"
                width={128}
                height={128}
                onLoad={() => setVerdict('recue')}
                onError={() => setVerdict('refusee')}
                className="size-32 shrink-0 rounded-[8px] border border-ink-200 bg-white object-cover"
              />
              <p className="text-[12.5px] leading-snug text-ink-600">
                {verdict === 'refusee'
                  ? "Le fournisseur n'a rien renvoyé : clé absente, invalide, ou adresse incorrecte."
                  : verdict === 'recue'
                    ? "Une image est arrivée. Si elle montre Gabès, le fond est bon ; si elle est barrée ou vide, le fournisseur refuse malgré le code de succès."
                    : 'Chargement…'}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-[11px] bg-amber-50 p-3.5 text-[12.5px] leading-snug text-ink-700">
          <TriangleAlert size={15} className="mt-px shrink-0 text-amber-600" />
          <span>
            Les livreurs gardent de toute façon le bouton « Ouvrir l'itinéraire »,
            qui passe par l'application de navigation du téléphone et ne dépend
            d'aucun de ces fournisseurs. Même sans fond de carte, personne n'est
            bloqué en tournée.
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="flex items-center gap-1.5 text-[12px] text-ink-400">
            <Map size={13} />
            <span className="truncate font-mono">{adresse || '—'}</span>
          </span>
          <Button onClick={onSave} loading={busy}>
            Enregistrer
          </Button>
        </div>
      </Card>
    </div>
  )
}
