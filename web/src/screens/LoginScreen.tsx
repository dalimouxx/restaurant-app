import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Delete, KeyRound, LogOut, QrCode, UserCog } from 'lucide-react'
import { auth } from '../lib/api'
import { useAuth } from '../lib/store'
import { roleLabel } from '../lib/format'
import type { Role, User } from '../lib/types'
import { Button, Field, Input, useToast } from '../components/ui'
import { Wordmark } from '../components/Shell'

/** Où atterrit chaque rôle après connexion. */
export const HOME_BY_ROLE: Record<Role, string> = {
  super_admin: '/gestion',
  admin: '/gestion',
  manager: '/gestion',
  cashier: '/caisse',
  cook: '/cuisine',
  driver: '/livreur',
  customer: '/',
}

type Mode = 'code' | 'password'

export default function LoginScreen({
  intent,
  signedInAs,
}: {
  /** Poste visé, pour adapter la méthode de connexion proposée. */
  intent?: 'cashier' | 'kitchen' | 'manager' | 'driver'
  /**
   * Compte déjà connecté mais sans accès à ce poste — typiquement un client
   * qui a commandé en ligne sur le même appareil. On le signale au lieu de
   * renvoyer la personne à l'accueil sans explication.
   */
  signedInAs?: User
}) {
  const [mode, setMode] = useState<Mode>(intent === 'cashier' ? 'code' : 'password')
  const navigate = useNavigate()
  const setUser = useAuth((s) => s.setUser)
  const logout = useAuth((s) => s.logout)
  const { notify } = useToast()

  function onSuccess(role: Role) {
    notify('Connexion réussie.', 'success')
    navigate(HOME_BY_ROLE[role], { replace: true })
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink-900">
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          <Wordmark />

          <h1 className="mt-8 text-[26px] leading-tight font-extrabold tracking-[-0.02em] text-white">
            {intent === 'cashier'
              ? 'Poste de caisse'
              : intent === 'kitchen'
                ? 'Écran cuisine'
                : intent === 'driver'
                  ? 'Espace livreur'
                  : 'Espace gestion'}
          </h1>
          <p className="mt-1.5 text-[14px] text-ink-400">
            {mode === 'code'
              ? 'Entrez votre code personnel.'
              : 'Entrez vos identifiants.'}
          </p>

          {signedInAs && (
            <div className="mt-5 rounded-[11px] border border-saffron-500/35 bg-saffron-500/10 p-3.5">
              <div className="flex items-start gap-2.5">
                <UserCog size={17} className="mt-px shrink-0 text-saffron-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] leading-snug font-semibold text-saffron-500">
                    Ce poste demande un autre compte
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-ink-400">
                    Vous êtes connecté comme {signedInAs.fullName} (
                    {roleLabel[signedInAs.role].toLowerCase()}). Connectez-vous ci-dessous
                    avec un compte du personnel.
                  </p>
                  <button
                    onClick={() => {
                      logout()
                      notify('Session fermée.', 'info')
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-300 underline-offset-4 transition-colors hover:text-white hover:underline"
                  >
                    <LogOut size={13} />
                    Fermer cette session
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-7">
            {mode === 'code' ? (
              <CodePad
                onDone={async (code) => {
                  const user = await auth.loginWithCode(code)
                  setUser(user)
                  onSuccess(user.role)
                }}
              />
            ) : (
              <PasswordForm
                onDone={async (email, password) => {
                  const user = await auth.login(email, password)
                  setUser(user)
                  onSuccess(user.role)
                }}
              />
            )}
          </div>

          <button
            onClick={() => setMode((m) => (m === 'code' ? 'password' : 'code'))}
            className="mt-6 flex items-center gap-2 text-[13.5px] font-semibold text-ink-400 transition-colors hover:text-white"
          >
            {mode === 'code' ? <KeyRound size={15} /> : <QrCode size={15} />}
            {mode === 'code' ? 'Utiliser un email et mot de passe' : 'Utiliser un code personnel'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Pavé à code ───────────────────────── */

function CodePad({ onDone }: { onDone: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submittingRef = useRef(false)

  async function submit(value: string) {
    if (submittingRef.current || value.length === 0) return
    submittingRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await onDone(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code refusé.')
      setCode('')
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) setCode((c) => (c.length < 8 ? c + e.key : c))
      else if (e.key === 'Backspace') setCode((c) => c.slice(0, -1))
      else if (e.key === 'Enter') submit(code)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  return (
    <div>
      <div
        className={`flex h-14 items-center justify-center gap-2.5 rounded-[11px] border bg-ink-800 ${
          error ? 'border-coral-500' : 'border-ink-700'
        }`}
      >
        {code.length === 0 ? (
          <span className="text-[14px] text-ink-500">Code</span>
        ) : (
          Array.from(code).map((_, i) => (
            <span key={i} className="size-2.5 rounded-full bg-petrol-400" />
          ))
        )}
      </div>

      {error && <p className="mt-2 text-[13px] font-medium text-coral-500">{error}</p>}

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <PadKey key={k} onClick={() => setCode((c) => (c.length < 8 ? c + k : c))}>
            {k}
          </PadKey>
        ))}
        <PadKey onClick={() => setCode('')} muted>
          C
        </PadKey>
        <PadKey onClick={() => setCode((c) => (c.length < 8 ? c + '0' : c))}>0</PadKey>
        <PadKey onClick={() => setCode((c) => c.slice(0, -1))} muted>
          <Delete size={19} />
        </PadKey>
      </div>

      <Button
        size="lg"
        className="mt-4 w-full"
        loading={busy}
        disabled={code.length === 0}
        onClick={() => submit(code)}
      >
        Se connecter
      </Button>
    </div>
  )
}

function PadKey({
  children,
  onClick,
  muted = false,
}: {
  children: React.ReactNode
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`num grid h-14 place-items-center rounded-[11px] border border-ink-700 text-[20px] font-semibold transition-colors active:bg-ink-700 ${
        muted ? 'text-ink-400 hover:bg-ink-800' : 'bg-ink-800 text-white hover:bg-ink-700'
      }`}
    >
      {children}
    </button>
  )
}

/* ───────────────────────── Email et mot de passe ───────────────────────── */

function PasswordForm({
  onDone,
}: {
  onDone: (email: string, password: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await onDone(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Identifiants refusés.')
    } finally {
      setBusy(false)
    }
  }

  const darkInput =
    'w-full h-12 px-3.5 rounded-[9px] bg-ink-800 border border-ink-700 text-white ' +
    'placeholder:text-ink-500 transition-colors hover:border-ink-600 ' +
    'focus:border-petrol-500 focus:outline-none focus:ring-[3px] focus:ring-petrol-500/20'

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-300">Email</span>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={darkInput}
          placeholder="vous@restaurant.tn"
        />
      </div>
      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-300">
          Mot de passe
        </span>
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={darkInput}
        />
      </div>
      {error && <p className="text-[13px] font-medium text-coral-500">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Se connecter
      </Button>
    </form>
  )
}

/** Réutilisé par l'espace client, sur fond clair. */
export { Field as _Field }
