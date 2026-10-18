/**
 * Préparation d'une photo de plat avant envoi.
 *
 * La photo part en base de données sous forme de data URL. C'est le seul
 * moyen de garder les photos sans louer un stockage d'objets, et elles
 * survivent à un redéploiement — contrairement au disque du serveur, qui
 * est effacé à chaque mise en ligne.
 *
 * La contrepartie est que chaque octet voyage avec la carte, relue à
 * l'ouverture de la borne et du site. D'où la réduction ici, dans le
 * navigateur : côté long ramené à 640 px et compression JPEG, ce qui donne
 * typiquement 30 à 60 ko pour une photo de téléphone de 4 Mo.
 */

const MAX_SIDE = 640
const QUALITY = 0.78
const MAX_INPUT_BYTES = 15 * 1024 * 1024
/** Doit rester sous la limite du serveur (400 000 caractères). */
const MAX_OUTPUT_CHARS = 380_000

export class ImageError extends Error {}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageError('Image illisible.'))
    }
    img.src = url
  })
}

/** Réduit la photo et la renvoie en data URL JPEG. */
export async function preparePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new ImageError('Ce fichier n’est pas une image.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageError('Image trop lourde (15 Mo maximum).')
  }

  const img = await loadImage(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageError('Redimensionnement impossible sur cet appareil.')

  // Fond blanc : un PNG transparent deviendrait noir en JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  let dataUrl = canvas.toDataURL('image/jpeg', QUALITY)

  // Filet de sécurité : une photo très détaillée peut rester volumineuse
  // même réduite. On recomprime plutôt que de laisser le serveur refuser.
  for (let quality = 0.6; dataUrl.length > MAX_OUTPUT_CHARS && quality >= 0.3; quality -= 0.15) {
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > MAX_OUTPUT_CHARS) {
    throw new ImageError('Photo trop détaillée. Essayez une autre image.')
  }

  return dataUrl
}

/** Poids approximatif d'une data URL, pour l'afficher au gérant. */
export function photoWeight(dataUrl: string): string {
  const bytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.round(bytes / 1024)} ko`
}
