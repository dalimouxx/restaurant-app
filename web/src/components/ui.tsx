import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react'

/* ───────────────────────── Bouton ───────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const buttonBase =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-[9px] ' +
  'transition-[background-color,border-color,color,opacity] duration-150 ' +
  'disabled:opacity-45 disabled:cursor-not-allowed select-none whitespace-nowrap'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-petrol-600 text-white hover:bg-petrol-700 active:bg-petrol-800',
  secondary:
    'bg-white text-ink-900 border border-ink-200 hover:bg-ink-50 hover:border-ink-300',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  danger: 'bg-coral-600 text-white hover:bg-coral-700',
  dark: 'bg-ink-900 text-white hover:bg-ink-800',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
  xl: 'h-16 px-7 text-lg rounded-[13px]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  children,
  className = '',
  ...rest
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ComponentType<{ size?: number | string; strokeWidth?: number }>
  children?: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
    >
      {loading ? (
        <Loader2 size={size === 'xl' ? 22 : 16} className="animate-spin" />
      ) : (
        Icon && <Icon size={size === 'xl' ? 22 : 16} strokeWidth={2.2} />
      )}
      {children}
    </button>
  )
}

/* ───────────────────────── Champ ───────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-700">{label}</span>
      )}
      {children}
      {error ? (
        <span className="mt-1.5 block text-[12.5px] font-medium text-coral-600">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12.5px] text-ink-500">{hint}</span>
      ) : null}
    </label>
  )
}

export const inputClass =
  'w-full h-11 px-3.5 rounded-[9px] bg-white border border-ink-200 text-ink-900 ' +
  'placeholder:text-ink-400 transition-colors ' +
  'hover:border-ink-300 focus:border-petrol-500 focus:outline-none ' +
  'focus:ring-[3px] focus:ring-petrol-500/18'

export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    ref?: React.Ref<HTMLInputElement>
  },
) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${inputClass} ${className}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select {...rest} className={`${inputClass} pr-8 ${className}`}>
      {children}
    </select>
  )
}

/* ───────────────────────── Pastille de statut ───────────────────────── */

type Tone = 'neutral' | 'petrol' | 'saffron' | 'coral' | 'sky'

const toneChip: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-600',
  petrol: 'bg-petrol-50 text-petrol-700',
  saffron: 'bg-saffron-50 text-saffron-700',
  coral: 'bg-coral-50 text-coral-700',
  sky: 'bg-sky-50 text-sky-700',
}

export function Chip({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${toneChip[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  const colors: Record<Tone, string> = {
    neutral: 'bg-ink-400',
    petrol: 'bg-petrol-500',
    saffron: 'bg-saffron-500',
    coral: 'bg-coral-500',
    sky: 'bg-sky-500',
  }
  return <span className={`size-1.5 shrink-0 rounded-full ${colors[tone]}`} />
}

/* ───────────────────────── Carte ───────────────────────── */

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`rounded-[13px] border border-ink-200 bg-white ${className}`}
    >
      {children}
    </div>
  )
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink-900">{children}</h2>
      {action}
    </div>
  )
}

/* ───────────────────────── États vides et chargement ───────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  dark = false,
}: {
  icon?: React.ComponentType<{ size?: number | string; strokeWidth?: number }>
  title: string
  description?: string
  action?: ReactNode
  dark?: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && (
        <div
          className={`mb-4 grid size-12 place-items-center rounded-full ${
            dark ? 'bg-ink-800 text-ink-400' : 'bg-ink-100 text-ink-400'
          }`}
        >
          <Icon size={22} strokeWidth={1.8} />
        </div>
      )}
      <p className={`text-[15px] font-semibold ${dark ? 'text-ink-200' : 'text-ink-800'}`}>
        {title}
      </p>
      {description && (
        <p className={`mt-1 max-w-sm text-sm ${dark ? 'text-ink-500' : 'text-ink-500'}`}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[9px] bg-ink-100 ${className}`}>
      <div className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 size={18} className={`animate-spin text-ink-400 ${className}`} />
}

/* ───────────────────────── Modale ───────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/45 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 w-full ${width} animate-ticket-in rounded-t-[18px] border border-ink-200 bg-white shadow-xl sm:rounded-[18px]`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="text-[16px] font-bold text-ink-900">{title}</h3>
            {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="-m-1 rounded-md p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <X size={18} />
          </button>
        </div>
        {/* Un éditeur long doit défiler dans la modale, pas déborder de l'écran. */}
        {children && (
          <div className="max-h-[min(68dvh,660px)] overflow-y-auto px-5 py-4">{children}</div>
        )}
        {footer && (
          <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────── Notifications ───────────────────────── */

type ToastTone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tone: ToastTone
  message: string
}

const ToastCtx = createContext<{
  notify: (message: string, tone?: ToastTone) => void
}>({ notify: () => {} })

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++seq.current
    setItems((prev) => [...prev, { id, tone, message }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200)
  }, [])

  const value = useMemo(() => ({ notify }), [notify])

  const icons = { success: CheckCircle2, error: AlertCircle, info: Info }
  const tones: Record<ToastTone, string> = {
    success: 'border-petrol-200 bg-petrol-600 text-white',
    error: 'border-coral-500 bg-coral-600 text-white',
    info: 'border-ink-700 bg-ink-900 text-white',
  }

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {items.map((t) => {
          const Icon = icons[t.tone]
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex max-w-sm animate-ticket-in items-start gap-2.5 rounded-[11px] border px-4 py-3 text-sm font-medium shadow-lg ${tones[t.tone]}`}
            >
              <Icon size={17} className="mt-px shrink-0" />
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

/* ───────────────────────── Horloge partagée ───────────────────────── */

/** Un seul intervalle pour toute l'app : évite N timers sur N tickets. */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
