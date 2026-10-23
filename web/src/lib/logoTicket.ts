/**
 * Le logo, préparé pour une imprimante thermique.
 *
 * Une imprimante de tickets ne connaît que deux états : le papier est
 * noirci ou il ne l'est pas. Elle n'a ni gris ni couleur. Lui envoyer un
 * logo en couleur la laisse décider seule, et elle décide mal : les
 * aplats moyens deviennent un pâté sombre, les dégradés du bruit, et un
 * logo clair sur fond clair disparaît purement et simplement.
 *
 * On tranche donc nous-mêmes. Chaque pixel devient noir ou blanc selon
 * sa luminosité, et la transparence est traitée comme du blanc — sans
 * quoi un logo au fond transparent sortirait entièrement noir.
 *
 * Le seuil est volontairement bas (45 %). Un logo passe mieux trop
 * léger que trop lourd : un trait fin perdu se devine encore, un aplat
 * noir ne se rattrape pas.
 */

const SEUIL = 0.45
const LARGEUR_MAX = 384 // points d'une tête thermique 80 mm

const cache = new Map<string, string>()

export function logoPourTicket(source: string | null | undefined): Promise<string | null> {
  if (!source) return Promise.resolve(null)

  const deja = cache.get(source)
  if (deja !== undefined) return Promise.resolve(deja)

  return new Promise((resoudre) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'

    image.onload = () => {
      try {
        const echelle = Math.min(1, LARGEUR_MAX / image.width)
        const largeur = Math.max(1, Math.round(image.width * echelle))
        const hauteur = Math.max(1, Math.round(image.height * echelle))

        const toile = document.createElement('canvas')
        toile.width = largeur
        toile.height = hauteur
        const ctx = toile.getContext('2d')
        if (!ctx) return resoudre(null)

        // Le fond blanc d'abord : la transparence doit devenir du papier,
        // pas du noir.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, largeur, hauteur)
        ctx.drawImage(image, 0, 0, largeur, hauteur)

        const pixels = ctx.getImageData(0, 0, largeur, hauteur)
        const d = pixels.data
        for (let i = 0; i < d.length; i += 4) {
          // Luminosité perçue : l'œil ne pondère pas les trois canaux de
          // la même façon, et une moyenne brute noircit tous les bleus.
          const luminosite = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
          const noir = luminosite < SEUIL
          d[i] = d[i + 1] = d[i + 2] = noir ? 0 : 255
          d[i + 3] = 255
        }
        ctx.putImageData(pixels, 0, 0)

        const resultat = toile.toDataURL('image/png')
        cache.set(source, resultat)
        resoudre(resultat)
      } catch {
        // Image d'une autre origine, canvas refusé : le ticket se passe
        // de logo plutôt que de ne pas sortir.
        cache.set(source, '')
        resoudre(null)
      }
    }

    image.onerror = () => {
      cache.set(source, '')
      resoudre(null)
    }

    image.src = source
  })
}
