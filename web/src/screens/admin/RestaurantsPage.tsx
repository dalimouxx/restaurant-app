import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Building2,
  ExternalLink,
  ImagePlus,
  Pause,
  Play,
  Plus,
} from 'lucide-react'
import { restaurants as api } from '../../lib/api'
import { ImageError, preparePhoto } from '../../lib/image'
import { definirEtablissement, etablissementCourant } from '../../lib/etablissement'
import type { Restaurant } from '../../lib/types'
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  Skeleton,
  useToast,
} from '../../components/ui'
import { Emoji } from '../../components/Emoji'

/**
 * Les établissements de l'installation.
 *
 * Réservé au super admin : c'est le seul rôle qui voit au-dessus des
 * cloisons. Un gérant administre son restaurant et ignore jusqu'à
 * l'existence des autres.
 *
 * Deux gestes y comptent vraiment. Ouvrir un établissement — le reste
 * du logiciel ne sert à rien tant qu'il n'existe pas. Et le suspendre :
 * on suspend un client qui ne paie pas, on ne lui efface pas sa
 * comptabilité. Ses données restent intactes et la reprise lui rend son
 * service là où il l'avait laissé.
 */
export default function RestaurantsPage() {
  const [liste, setListe] = useState<Restaurant[]>([])
  const [chargement, setChargement] = useState(true)
  const [ouverture, setOuverture] = useState(false)
  const [courant, setCourant] = useState<string | null>(null)
  const { notify } = useToast()

  const charger = useCallback(async () => {
    try {
      setListe(await api.list())
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Liste indisponible.', 'error')
    } finally {
      setChargement(false)
    }
  }, [notify])

  useEffect(() => {
    charger()
    setCourant(etablissementCourant())
  }, [charger])

  async function basculer(r: Restaurant) {
    try {
      const maj = await api.update(r.id, { isActive: !r.isActive })
      setListe((l) => l.map((x) => (x.id === maj.id ? { ...x, ...maj } : x)))
      notify(
        maj.isActive
          ? `${maj.name} est de nouveau en service.`
          : `${maj.name} est suspendu. Ses données sont intactes.`,
        'success',
      )
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Changement refusé.', 'error')
    }
  }

  /**
   * Travailler au nom d'un établissement.
   *
   * Sans cela, un super admin qui administre plusieurs fastfoods ne
   * peut configurer aucun d'eux : le serveur refuse de deviner lequel,
   * et il a raison. Ce choix est retenu sur l'appareil et accompagne
   * chaque requête.
   */
  function travaillerDans(r: Restaurant | null) {
    definirEtablissement(r?.slug ?? null)
    setCourant(r?.slug ?? null)
    notify(
      r
        ? `Vous administrez maintenant ${r.name}.`
        : "Vous êtes revenu sur l'ensemble de l'installation.",
      'success',
    )
  }

  const actifs = liste.filter((r) => r.isActive).length

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] text-ink-500">
            {chargement
              ? '—'
              : `${liste.length} établissement${liste.length > 1 ? 's' : ''}, ${actifs} en service`}
          </p>
        </div>
        <Button icon={Plus} onClick={() => setOuverture(true)}>
          Ouvrir un établissement
        </Button>
      </div>

      {courant && (
        <Card className="flex flex-wrap items-center gap-3 border-petrol-200 bg-petrol-50 p-4">
          <Emoji vie="bat" className="text-[20px]">🏪</Emoji>
          <p className="min-w-0 flex-1 text-[13.5px] text-petrol-900">
            Vous administrez{' '}
            <span className="font-bold">
              {liste.find((r) => r.slug === courant)?.name ?? courant}
            </span>
            . Carte, stock, équipe et réglages portent sur lui.
          </p>
          <Button size="sm" variant="secondary" onClick={() => travaillerDans(null)}>
            Revenir à l'ensemble
          </Button>
        </Card>
      )}

      {chargement ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[150px]" />
          ))}
        </div>
      ) : liste.length === 0 ? (
        <Card className="p-10 text-center">
          <Emoji vie="flotte" className="text-[44px]">🏪</Emoji>
          <p className="mt-3 text-[16px] font-bold text-ink-900">
            Aucun établissement
          </p>
          <p className="mt-1 text-[13.5px] text-ink-500">
            Ouvrez-en un pour commencer : tout le reste en dépend.
          </p>
        </Card>
      ) : (
        <div className="anim-cascade grid gap-3 sm:grid-cols-2">
          {liste.map((r) => (
            <FicheEtablissement
              key={r.id}
              etablissement={r}
              courant={r.slug === courant}
              onBasculer={() => basculer(r)}
              onTravailler={() => travaillerDans(r)}
              onModifie={(maj) =>
                setListe((l) => l.map((x) => (x.id === maj.id ? { ...x, ...maj } : x)))
              }
            />
          ))}
        </div>
      )}

      <OuvrirEtablissement
        open={ouverture}
        onClose={() => setOuverture(false)}
        onCree={(r) => {
          setListe((l) => [...l, { ...r, employes: 0, commandesEnCours: 0 }])
          setOuverture(false)
        }}
      />
    </div>
  )
}

/* ───────────────────────── Une fiche ───────────────────────── */

function FicheEtablissement({
  etablissement: r,
  courant,
  onBasculer,
  onTravailler,
  onModifie,
}: {
  etablissement: Restaurant
  courant: boolean
  onBasculer: () => void
  onTravailler: () => void
  onModifie: (r: Restaurant) => void
}) {
  const [occupe, setOccupe] = useState(false)
  const champ = useRef<HTMLInputElement>(null)
  const { notify } = useToast()

  async function changerLogo(fichier: File | undefined) {
    if (!fichier) return
    setOccupe(true)
    try {
      // Réduite dans le navigateur puis stockée en base, comme les photos
      // de plats : aucun hébergement de fichiers à administrer chez le
      // client, et la sauvegarde emporte les logos avec le reste.
      const logoUrl = await preparePhoto(fichier)
      onModifie(await api.update(r.id, { logoUrl }))
      notify('Logo enregistré.', 'success')
    } catch (e) {
      notify(
        e instanceof ImageError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Image refusée.',
        'error',
      )
    } finally {
      setOccupe(false)
      if (champ.current) champ.current.value = ''
    }
  }

  return (
    <Card
      className={`flex flex-col p-4 ${r.isActive ? '' : 'bg-ink-50'} ${
        courant ? 'ring-2 ring-petrol-600 ring-inset' : ''
      }`}
    >
      <div className="flex items-start gap-3.5">
        <button
          onClick={() => champ.current?.click()}
          disabled={occupe}
          aria-label={`Changer le logo de ${r.name}`}
          className="reagit grid size-14 shrink-0 place-items-center overflow-hidden rounded-[13px] border border-ink-200 bg-white transition-colors hover:border-petrol-400"
        >
          {r.logoUrl ? (
            <img src={r.logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus size={19} className="text-ink-400" />
          )}
        </button>
        <input
          ref={champ}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => changerLogo(e.target.files?.[0])}
        />

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[16px] font-bold text-ink-900">
            <span className="truncate">{r.name}</span>
            {!r.isActive && (
              <span className="shrink-0 rounded-full bg-ink-200 px-2 py-0.5 text-[11px] font-bold text-ink-600">
                Suspendu
              </span>
            )}
          </p>
          <a
            href={`/commander?restaurant=${r.slug}`}
            target="_blank"
            rel="noreferrer"
            className="num mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-ink-500 underline-offset-2 hover:text-petrol-700 hover:underline"
          >
            /{r.slug}
            <ExternalLink size={11} />
          </a>
          {r.notes && (
            <p className="mt-1 line-clamp-1 text-[12.5px] text-ink-500">{r.notes}</p>
          )}
        </div>
      </div>

      {/* Les deux chiffres qui disent s'il travaille — et s'il faut
          surtout ne pas le suspendre maintenant. */}
      <dl className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-[11px] bg-ink-50 px-3 py-2">
          <dt className="text-[11.5px] text-ink-500">Équipe</dt>
          <dd className="num text-[15px] font-bold text-ink-900">{r.employes}</dd>
        </div>
        <div
          className={`rounded-[11px] px-3 py-2 ${
            r.commandesEnCours > 0 ? 'bg-saffron-50' : 'bg-ink-50'
          }`}
        >
          <dt className="text-[11.5px] text-ink-500">En cours</dt>
          <dd
            className={`num text-[15px] font-bold ${
              r.commandesEnCours > 0 ? 'text-saffron-700' : 'text-ink-900'
            }`}
          >
            {r.commandesEnCours}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3.5">
        <Button
          size="sm"
          variant={courant ? 'secondary' : 'primary'}
          onClick={onTravailler}
          disabled={courant}
        >
          {courant ? 'En cours d\'administration' : 'Administrer'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={r.isActive ? Pause : Play}
          onClick={onBasculer}
        >
          {r.isActive ? 'Suspendre' : 'Remettre en service'}
        </Button>
      </div>

      {r.isActive && r.commandesEnCours > 0 && (
        <p className="mt-2 text-[12px] leading-snug text-ink-500">
          {r.commandesEnCours} commande{r.commandesEnCours > 1 ? 's' : ''} en cours :
          la suspension sera refusée tant que le service n'est pas terminé.
        </p>
      )}
    </Card>
  )
}

/* ───────────────────────── Ouverture ───────────────────────── */

function OuvrirEtablissement({
  open,
  onClose,
  onCree,
}: {
  open: boolean
  onClose: () => void
  onCree: (r: Restaurant) => void
}) {
  const [nom, setNom] = useState('')
  const [notes, setNotes] = useState('')
  const [occupe, setOccupe] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (open) {
      setNom('')
      setNotes('')
    }
  }, [open])

  /** Aperçu du repère, pour que le gérant sache ce qu'il colle sur ses tables. */
  const repere = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  async function ouvrir() {
    if (nom.trim().length < 2) {
      notify("Donnez un nom à l'établissement.", 'error')
      return
    }
    setOccupe(true)
    try {
      onCree(await api.create({ name: nom.trim(), notes: notes.trim() || undefined }))
      notify(`${nom.trim()} est ouvert.`, 'success')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Création refusée.', 'error')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ouvrir un établissement"
      description="Il démarre avec une carte vierge, sa propre équipe et ses propres comptes."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={ouvrir} loading={occupe}>
            Ouvrir
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Nom"
          hint={
            repere
              ? `Adresse publique : /commander?restaurant=${repere}`
              : 'Celui que verront vos clients'
          }
        >
          <Input
            autoFocus
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Fastfood Gabès Centre"
          />
        </Field>

        <Field label="Note interne" hint="Facultatif — pour vous y retrouver">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Franchise de Karim, ouverte en mars"
          />
        </Field>

        <div className="flex items-start gap-2 rounded-[11px] bg-ink-50 p-3.5 text-[12.5px] leading-snug text-ink-600">
          <Building2 size={15} className="mt-px shrink-0 text-ink-400" />
          <span>
            Rien n'est partagé avec les autres établissements : ni la carte, ni
            le stock, ni les ventes, ni les équipes. Vous devrez lui créer un
            gérant depuis Équipe.
          </span>
        </div>
      </div>
    </Modal>
  )
}
