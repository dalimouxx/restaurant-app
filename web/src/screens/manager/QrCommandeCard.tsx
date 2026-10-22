import { useMemo, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { Check, Copy, Printer, QrCode } from 'lucide-react'
import type { Settings } from '../../lib/types'
import { Button, Card, SectionTitle } from '../../components/ui'

/**
 * Le code à scanner, à poser sur les tables.
 *
 * Il répond au cas très concret d'un service sans caissier : le client
 * s'assoit, scanne, compose sa commande sur son propre téléphone, et
 * elle tombe en cuisine. Personne n'a eu à tenir le comptoir.
 *
 * Le code porte le repère de l'établissement. C'est ce qui fait qu'un
 * autocollant collé à Gabès ouvre la carte de Gabès et pas celle de
 * Sfax — et c'est pour ça qu'il se refabrique ici plutôt que d'être
 * imprimé une fois pour toutes dans un coin.
 *
 * L'impression occupe la page entière : un code de deux centimètres
 * scanné sous un néon depuis une table, ça ne marche pas.
 */
export function QrCommandeCard({ settings }: { settings: Settings }) {
  const [copie, setCopie] = useState(false)
  const zone = useRef<HTMLDivElement>(null)

  const adresse = useMemo(() => {
    const base = window.location.origin
    const repere = settings.etablissement?.slug
    return repere ? `${base}/commander?restaurant=${repere}` : `${base}/commander`
  }, [settings.etablissement?.slug])

  async function copier() {
    try {
      await navigator.clipboard.writeText(adresse)
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    } catch {
      /* presse-papiers refusé : l'adresse reste lisible à l'écran */
    }
  }

  function imprimer() {
    const canvas = zone.current?.querySelector('canvas')
    const image = canvas?.toDataURL('image/png')
    if (!image) return

    const fenetre = window.open('', '_blank', 'width=700,height=900')
    if (!fenetre) return

    // Page autonome : elle ne dépend ni des styles de l'application ni
    // d'une police à charger, pour que l'impression parte du premier
    // coup même sur le poste d'un client.
    fenetre.document.write(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>Commander — ${settings.restaurantName}</title>
<style>
  @page { margin: 18mm; }
  body {
    margin: 0; font-family: system-ui, sans-serif; text-align: center;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; min-height: 90vh; color: #101418;
  }
  h1 { font-size: 30px; margin: 0 0 6px; letter-spacing: -0.02em; }
  p  { font-size: 17px; margin: 0; color: #5a6672; }
  img { width: 74mm; height: 74mm; margin: 26px 0 18px; }
  .pas { font-size: 15px; color: #3d4854; margin-top: 10px; }
  .adresse { font-size: 11px; color: #8b96a1; margin-top: 22px; word-break: break-all; }
</style></head>
<body>
  <h1>${settings.restaurantName}</h1>
  <p>Commandez depuis votre téléphone</p>
  <img src="${image}" alt="Code à scanner">
  <div class="pas">Scannez · Composez · On prépare</div>
  <div class="adresse">${adresse}</div>
  <script>window.onload = () => { window.print(); }<\/script>
</body></html>`)
    fenetre.document.close()
  }

  return (
    <div>
      <SectionTitle>Commander en scannant</SectionTitle>
      <Card className="p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div
            ref={zone}
            className="anim-surgit mx-auto grid shrink-0 place-items-center rounded-[16px] border border-ink-200 bg-white p-4 sm:mx-0"
          >
            <QRCodeCanvas value={adresse} size={168} level="M" marginSize={1} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[14px] font-bold text-ink-900">
              <QrCode size={16} className="text-ink-400" />
              À coller sur les tables
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">
              Le client scanne, compose sa commande sur son propre téléphone,
              et elle part en cuisine. C'est ce qui permet de servir un
              service entier sans tenir le comptoir.
            </p>

            <p className="num mt-3.5 truncate rounded-[9px] bg-ink-50 px-3 py-2 text-[12px] text-ink-500">
              {adresse}
            </p>

            <div className="mt-3.5 flex flex-wrap gap-2">
              <Button size="sm" icon={Printer} onClick={imprimer}>
                Imprimer
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={copie ? Check : Copy}
                onClick={copier}
              >
                {copie ? 'Copiée' : "Copier l'adresse"}
              </Button>
            </div>

            {!settings.etablissement?.slug && (
              <p className="mt-3 text-[12.5px] leading-snug text-saffron-700">
                Ce code ne précise pas d'établissement. Il fonctionne tant que
                l'installation n'en héberge qu'un seul.
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
