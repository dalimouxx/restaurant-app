import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { restaurants } from '../../lib/api'
import { ImageError, preparePhoto } from '../../lib/image'
import { logoPourTicket } from '../../lib/logoTicket'
import { rafraichirReglages } from '../../lib/reglages'
import type { Settings } from '../../lib/types'
import { Button, Card, SectionTitle, useToast } from '../../components/ui'

/**
 * Le logo de l'établissement.
 *
 * Il sert à trois endroits, et c'est pour ça qu'il mérite sa carte : en
 * grand sur la page d'accueil, en tête des reçus que le client emporte,
 * et sur l'écran de salle.
 *
 * L'aperçu du ticket est le point important. Une imprimante thermique
 * ne connaît que le noir et le blanc, sans aucun gris : un logo qui
 * paraît superbe à l'écran peut sortir en pâté noir ou disparaître
 * entièrement. Le gérant doit le voir avant de commander mille tickets,
 * pas après — d'où les deux aperçus côte à côte.
 */
export function LogoCard({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (logoUrl: string | null) => void
}) {
  const [occupe, setOccupe] = useState(false)
  const [apercuTicket, setApercuTicket] = useState<string | null>(null)
  const champ = useRef<HTMLInputElement>(null)
  const { notify } = useToast()

  const logo = settings.etablissement?.logoUrl ?? null

  async function montrerLeTicket(source: string | null) {
    setApercuTicket(source ? await logoPourTicket(source) : null)
  }

  // L'aperçu se calcule dès que le logo change, sans attendre un clic :
  // c'est précisément ce qu'on veut lui montrer.
  if (logo && apercuTicket === null) {
    void montrerLeTicket(logo)
  }

  async function choisir(fichier: File | undefined) {
    if (!fichier) return
    setOccupe(true)
    try {
      const logoUrl = await preparePhoto(fichier)
      await restaurants.apparence({ logoUrl })
      onChange(logoUrl)
      rafraichirReglages()
      await montrerLeTicket(logoUrl)
      notify('Logo enregistré.', 'success')
    } catch (e) {
      notify(
        e instanceof ImageError || e instanceof Error ? e.message : 'Image refusée.',
        'error',
      )
    } finally {
      setOccupe(false)
      if (champ.current) champ.current.value = ''
    }
  }

  async function retirer() {
    setOccupe(true)
    try {
      await restaurants.apparence({ logoUrl: null })
      onChange(null)
      rafraichirReglages()
      setApercuTicket(null)
      notify('Logo retiré.', 'success')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Suppression refusée.', 'error')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div>
      <SectionTitle>Logo</SectionTitle>
      <Card className="p-5">
        <div className="flex flex-col gap-5 sm:flex-row">
          <button
            onClick={() => champ.current?.click()}
            disabled={occupe}
            aria-label="Choisir un logo"
            className="reagit grid h-28 w-full shrink-0 place-items-center overflow-hidden rounded-[16px] border-2 border-dashed border-ink-200 bg-ink-50 transition-colors hover:border-petrol-400 sm:w-40"
          >
            {logo ? (
              <img src={logo} alt="" className="max-h-24 max-w-full object-contain p-2" />
            ) : (
              <span className="flex flex-col items-center gap-1.5 text-ink-400">
                <ImagePlus size={22} />
                <span className="text-[12.5px] font-semibold">Choisir une image</span>
              </span>
            )}
          </button>
          <input
            ref={champ}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => choisir(e.target.files?.[0])}
          />

          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] leading-relaxed text-ink-600">
              Il s'affiche en grand sur votre page d'accueil, en tête des reçus
              que le client emporte, et sur l'écran de salle.
            </p>

            {logo && (
              <div className="mt-4">
                <p className="text-[12.5px] font-bold text-ink-900">
                  Tel qu'il sortira du ticket
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="grid h-20 w-36 place-items-center rounded-[11px] border border-ink-200 bg-white">
                    {apercuTicket ? (
                      <img
                        src={apercuTicket}
                        alt="Aperçu sur le ticket"
                        className="max-h-16 max-w-[7.5rem] object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span className="text-[11.5px] text-ink-400">Calcul…</span>
                    )}
                  </div>
                  <p className="flex-1 text-[12px] leading-snug text-ink-500">
                    Une imprimante de tickets ne connaît que le noir et le blanc,
                    sans aucun gris. Si votre logo disparaît ou devient un pâté
                    ici, choisissez une version au trait, bien contrastée.
                  </p>
                </div>
              </div>
            )}

            {logo && (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                className="mt-3"
                loading={occupe}
                onClick={retirer}
              >
                Retirer
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
