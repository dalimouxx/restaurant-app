import { useCallback, useEffect, useState } from 'react'
import { Ban, CheckCircle2, Printer, QrCode, UserPlus, Users } from 'lucide-react'
import { users } from '../../lib/api'
import { roleLabel } from '../../lib/format'
import type { Role, User } from '../../lib/types'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  useToast,
} from '../../components/ui'

const ASSIGNABLE: { value: Role; label: string }[] = [
  { value: 'cashier', label: 'Caissier' },
  { value: 'cook', label: 'Cuisinier' },
  { value: 'driver', label: 'Livreur' },
  { value: 'manager', label: 'Gérant' },
]

export default function TeamPage() {
  const [staff, setStaff] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [badgeFor, setBadgeFor] = useState<User | null>(null)
  const { notify } = useToast()

  const load = useCallback(async () => {
    try {
      setStaff(await users.list())
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Équipe illisible.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(u: User) {
    try {
      await users.toggleActive(u.id)
      notify(u.isActive ? `${u.fullName} désactivé.` : `${u.fullName} réactivé.`, 'success')
      load()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Changement refusé.', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-[13.5px] text-ink-500">
          {staff.filter((s) => s.isActive).length} actif
          {staff.filter((s) => s.isActive).length > 1 ? 's' : ''} sur {staff.length}
        </p>
        <Button icon={UserPlus} onClick={() => setCreating(true)}>
          Ajouter
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[66px]" />
          ))}
        </div>
      ) : staff.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Aucun employé"
            description="Chaque employé reçoit un badge QR qui lui sert de connexion."
            action={
              <Button icon={UserPlus} onClick={() => setCreating(true)}>
                Ajouter un employé
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100">
          {staff.map((u) => (
            <div key={u.id} className="flex items-center gap-3.5 px-4 py-3">
              <div
                className={`grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-bold text-white ${
                  u.isActive ? 'bg-petrol-600' : 'bg-ink-300'
                }`}
              >
                {u.fullName[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-semibold text-ink-900">
                  {u.fullName}
                </p>
                <p className="text-[12.5px] text-ink-500">
                  {roleLabel[u.role]}
                  {u.phone && ` · ${u.phone}`}
                  {!u.isActive && (
                    <span className="font-semibold text-coral-600"> · désactivé</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setBadgeFor(u)}
                aria-label={`Badge de ${u.fullName}`}
                title="Afficher le badge"
                className="grid size-9 place-items-center rounded-[8px] text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
              >
                <QrCode size={18} />
              </button>
              <button
                onClick={() => toggle(u)}
                aria-label={u.isActive ? 'Désactiver' : 'Réactiver'}
                title={u.isActive ? 'Désactiver' : 'Réactiver'}
                className="grid size-9 place-items-center rounded-[8px] text-ink-500 transition-colors hover:bg-ink-100 hover:text-coral-600"
              >
                {u.isActive ? <Ban size={17} /> : <CheckCircle2 size={17} />}
              </button>
            </div>
          ))}
        </Card>
      )}

      <CreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false)
          load()
        }}
      />
      <BadgeModal user={badgeFor} onClose={() => setBadgeFor(null)} />
    </div>
  )
}

function CreateModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('cashier')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginCode, setLoginCode] = useState('')
  const [busy, setBusy] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (open) {
      setFullName('')
      setRole('cashier')
      setPhone('')
      setEmail('')
      setPassword('')
      setLoginCode('')
    }
  }, [open])

  const needsCode = role === 'cashier'
  const needsPassword = role === 'manager' || role === 'cook'

  async function submit() {
    if (fullName.trim().length < 2) {
      notify('Indiquez le nom complet.', 'error')
      return
    }
    setBusy(true)
    try {
      await users.create({
        fullName: fullName.trim(),
        role,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        password: password || undefined,
        loginCode: loginCode.trim() || undefined,
      })
      notify('Employé ajouté. Son badge QR est disponible.', 'success')
      onDone()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Création refusée.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter un employé"
      description="Un badge QR est généré automatiquement et sert de connexion."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy}>
            Créer le compte
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Nom complet">
          <Input
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>
        <Field label="Poste">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ASSIGNABLE.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Téléphone">
          <Input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        {needsCode && (
          <Field
            label="Code de caisse"
            hint="Quatre chiffres, tapés au pavé en début de service"
          >
            <Input
              inputMode="numeric"
              maxLength={8}
              value={loginCode}
              onChange={(e) => setLoginCode(e.target.value.replace(/\D/g, ''))}
              placeholder="1234"
              className="num"
            />
          </Field>
        )}

        {needsPassword && (
          <>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Mot de passe">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}

function BadgeModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [image, setImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (!user) {
      setImage(null)
      return
    }
    setLoading(true)
    users
      .badge(user.id)
      .then((b) => setImage(b.qrImage))
      .catch((e) =>
        notify(e instanceof Error ? e.message : 'Badge indisponible.', 'error'),
      )
      .finally(() => setLoading(false))
  }, [user, notify])

  function print() {
    if (!image || !user) return
    const w = window.open('', '_blank', 'width=420,height=560')
    if (!w) return
    w.document.write(`
      <html><head><title>Badge ${user.fullName}</title>
      <style>
        body{font-family:system-ui,sans-serif;display:grid;place-items:center;
             height:100vh;margin:0;text-align:center}
        img{width:230px;height:230px}
        h1{font-size:18px;margin:14px 0 2px}
        p{font-size:13px;color:#5a6672;margin:0}
      </style></head>
      <body>
        <div>
          <img src="${image}" alt="">
          <h1>${user.fullName}</h1>
          <p>${roleLabel[user.role]}</p>
        </div>
        <script>window.onload=()=>{window.print();}<\/script>
      </body></html>`)
    w.document.close()
  }

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title={user ? `Badge de ${user.fullName}` : ''}
      description="À imprimer et plastifier. Il remplace le mot de passe."
      footer={
        <Button variant="secondary" icon={Printer} onClick={print} disabled={!image}>
          Imprimer
        </Button>
      }
    >
      <div className="grid place-items-center py-2">
        {loading ? (
          <Skeleton className="size-[200px]" />
        ) : image ? (
          <img src={image} alt="" className="size-[200px]" />
        ) : (
          <p className="text-[13.5px] text-ink-500">Badge indisponible.</p>
        )}
      </div>
    </Modal>
  )
}
