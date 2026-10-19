// Surface exposee : temps reel, en-tetes du navigateur, points d'entree
// publics, et messages d'erreur.

const { io } = require('socket.io-client')

const HOST = 'http://localhost:4000'
const BASE = `${HOST}/api`
let pass = 0
let fail = 0

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`) }
  else { fail++; console.log(`  FAIL - ${msg}`) }
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data, headers: res.headers }
}

/** Ouvre une connexion temps reel, tente d'entrer dans une salle, et dit ce qui s'est passe. */
function tenterSalle(room, token) {
  return new Promise((resolve) => {
    const socket = io(HOST, {
      transports: ['websocket'],
      auth: token ? { token } : undefined,
      reconnection: false,
    })
    let refuse = false
    socket.on('room:refused', (p) => { if (p.room === room) refuse = true })
    socket.on('connect', () => socket.emit('join', room))
    socket.on('connect_error', () => resolve({ connecte: false, refuse: true, socket: null }))
    setTimeout(() => resolve({ connecte: socket.connected, refuse, socket }), 900)
  })
}

async function run() {
  console.log('\n===== SURFACE EXPOSEE =====\n')

  const mgr = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token
  const cash = (await req('POST', '/auth/login-code', { loginCode: '1234' })).data.token

  /* ───────── Temps reel ───────── */
  console.log('— Temps reel —')

  const anonCuisine = await tenterSalle('kitchen')
  check(anonCuisine.connecte, 'Une connexion sans compte reste possible (la borne en depend)')
  check(anonCuisine.refuse, 'Mais la salle cuisine lui est refusee')
  anonCuisine.socket?.disconnect()

  const anonGestion = await tenterSalle('manager')
  check(anonGestion.refuse, 'La salle gestion aussi')
  anonGestion.socket?.disconnect()

  const faux = await tenterSalle('kitchen', 'jeton.completement.invente')
  check(faux.refuse, 'Un jeton falsifie ne vaut pas mieux qu\'aucun jeton')
  faux.socket?.disconnect()

  const caissierEnGestion = await tenterSalle('manager', cash)
  check(
    caissierEnGestion.refuse,
    'Un caissier authentifie n\'entre pas dans la salle du gerant'
  )
  caissierEnGestion.socket?.disconnect()

  const gerantEnCuisine = await tenterSalle('kitchen', mgr)
  check(!gerantEnCuisine.refuse, 'Le gerant entre en cuisine, comme attendu')
  gerantEnCuisine.socket?.disconnect()

  const inconnue = await tenterSalle('nimporte_quoi', mgr)
  check(inconnue.refuse, 'Une salle qui n\'existe pas est refusee, et non creee')
  inconnue.socket?.disconnect()

  // Un anonyme ne doit pas pouvoir promener le client avec une fausse position.
  const positionRecue = await new Promise((resolve) => {
    const espion = io(HOST, { transports: ['websocket'], auth: { token: mgr }, reconnection: false })
    const pirate = io(HOST, { transports: ['websocket'], reconnection: false })
    let recu = false
    espion.on('connect', async () => {
      const cmd = (await req('GET', '/orders/recent', null, mgr)).data[0]
      espion.emit('join', `order_${cmd.id}`)
      espion.on('delivery:location_update', () => { recu = true })
      setTimeout(() => {
        pirate.emit('driver:location', { orderId: cmd.id, lat: 33.88, lng: 10.1 })
      }, 400)
      setTimeout(() => {
        espion.disconnect(); pirate.disconnect(); resolve(recu)
      }, 1600)
    })
  })
  check(!positionRecue, 'Une fausse position envoyee par un anonyme n\'atteint pas le client')

  /* ───────── En-tetes du navigateur ───────── */
  console.log('\n— En-tetes du navigateur —')

  const page = await fetch(HOST + '/')
  const h = (name) => page.headers.get(name)

  check(h('x-frame-options') || h('content-security-policy')?.includes('frame-ancestors'),
    'L\'application refuse d\'etre affichee dans un cadre sur un autre site')
  check(h('x-content-type-options') === 'nosniff',
    'Le navigateur ne devine pas le type des fichiers servis')
  check((h('strict-transport-security') || '').includes('max-age='),
    'Une fois connu en HTTPS, le site refuse de revenir en clair')
  check(!!h('content-security-policy'), 'Une politique de contenu est declaree')
  check(
    (h('content-security-policy') || '').includes("script-src 'self'"),
    'Seuls les scripts de ce serveur peuvent s\'executer'
  )
  check(
    (h('content-security-policy') || '').includes('tile.openstreetmap.org'),
    'La carte de livraison reste autorisee'
  )
  check(!h('x-powered-by'), 'Le serveur n\'annonce pas la technologie qu\'il utilise')

  /* ───────── Points d'entree publics ───────── */
  console.log('\n— Points d\'entree publics —')

  const prods = (await req('GET', '/products')).data.filter((p) => p.isAvailable)
  const corps = {
    items: [{ productId: prods[0].id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'pickup',
  }

  let bloqueA = 0
  for (let i = 1; i <= 60; i++) {
    const r = await req('POST', '/orders/kiosk', corps)
    if (r.status === 429) { bloqueA = i; break }
  }
  check(bloqueA > 0, `La borne cesse d'accepter au bout de ${bloqueA} commandes d'affilee`)
  check(bloqueA > 20, 'Le seuil laisse passer un vrai coup de feu')

  /* ───────── Messages d'erreur ───────── */
  console.log('\n— Messages d\'erreur —')

  const platInconnu = await req('POST', '/orders/counter', {
    items: [{ productId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
    fulfillmentType: 'dine_in',
  }, cash)
  check(
    platInconnu.status === 400,
    'Un refus metier repond 400, et non 500 comme une panne'
  )
  check(
    !/SELECT|WHERE|sequelize|\/home\//i.test(platInconnu.data.error || ''),
    'Le message ne laisse voir ni requete, ni table, ni chemin de fichier'
  )

  const champVide = await req('POST', '/auth/login', { email: 'x@y.tn' })
  check(champVide.status === 400, 'Un champ manquant est un refus, pas une panne')

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
