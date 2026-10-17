import { useEffect, useRef, useState } from 'react'
import { CameraOff } from 'lucide-react'

/**
 * Lecteur de QR code via la caméra, sans dépendance externe : il s'appuie
 * sur BarcodeDetector quand le navigateur le fournit (Chrome, Edge, Android).
 * Sur un navigateur sans cette API, on bascule sur une saisie manuelle
 * plutôt que de bloquer le livreur.
 */

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

export function isScannerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

export function QrScanner({
  onDetected,
  onError,
}: {
  onDetected: (value: string) => void
  onError?: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const firedRef = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false

    async function start() {
      const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector
      if (!Ctor) {
        setFailed("Ce navigateur ne sait pas lire les QR codes.")
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
      } catch {
        const msg =
          "Caméra refusée. Autorisez l'accès dans les réglages du navigateur."
        setFailed(msg)
        onError?.(msg)
        return
      }

      if (cancelled || !videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play().catch(() => {})
      setReady(true)

      const detector = new Ctor({ formats: ['qr_code'] })

      const tick = async () => {
        if (cancelled || firedRef.current || !videoRef.current) return
        try {
          const found = await detector.detect(videoRef.current)
          if (found.length > 0 && found[0].rawValue) {
            firedRef.current = true
            onDetected(found[0].rawValue)
            return
          }
        } catch {
          /* image illisible : on retente à la frame suivante */
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onDetected, onError])

  if (failed) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-[13px] bg-ink-800 px-6 text-center">
        <div>
          <CameraOff size={28} className="mx-auto text-ink-500" strokeWidth={1.8} />
          <p className="mt-3 text-[13.5px] leading-snug text-ink-400">{failed}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-[13px] bg-ink-950">
      <video
        ref={videoRef}
        playsInline
        muted
        className="size-full object-cover"
        aria-label="Viseur de la caméra"
      />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="size-[58%] rounded-[16px] border-[3px] border-white/85 shadow-[0_0_0_9999px_rgba(10,13,16,.45)]" />
      </div>
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-400">
          Activation de la caméra…
        </div>
      )}
    </div>
  )
}
