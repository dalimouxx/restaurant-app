/*
 * Service worker.
 *
 * Il sert deux choses, et rien d'autre : rendre l'application installable
 * sur un téléphone ou une tablette, et lui permettre de s'ouvrir quand le
 * réseau est mauvais.
 *
 * Ce n'est PAS un mode hors-ligne : la caisse a besoin du serveur pour
 * encaisser, la cuisine pour recevoir ses tickets. Un vrai fonctionnement
 * hors réseau demande de mettre les commandes en file d'attente et de les
 * rejouer ensuite, ce qui est un autre chantier.
 *
 * Stratégie :
 *  — les fichiers d'assets portent une empreinte dans leur nom et ne
 *    changent jamais : cache d'abord, c'est ce qui rend l'ouverture
 *    instantanée ;
 *  — les pages passent par le réseau d'abord, pour qu'une mise en ligne
 *    soit prise en compte dès le rechargement suivant ;
 *  — l'API n'est jamais mise en cache : un stock ou une file de commandes
 *    périmés valent moins que rien.
 */

const VERSION = 'service-v1'
const SHELL = `${VERSION}-shell`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(['/'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Jamais de cache sur les données vivantes.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname === '/health'
  ) {
    return
  }

  // Fichiers à empreinte : le cache fait foi.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((reponse) => {
            if (reponse.ok) {
              const copie = reponse.clone()
              caches.open(SHELL).then((cache) => cache.put(request, copie))
            }
            return reponse
          })
      )
    )
    return
  }

  // Pages : le réseau d'abord, le cache en secours.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((reponse) => {
          const copie = reponse.clone()
          caches.open(SHELL).then((cache) => cache.put('/', copie))
          return reponse
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error()))
    )
  }
})
