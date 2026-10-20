// Reglages de l'etablissement : lecture publique pour le ticket,
// modification reservee au gerant, cles inconnues ignorees.

const BASE = 'http://localhost:4000/api'
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
  return { status: res.status, data }
}

async function run() {
  console.log('\n===== REGLAGES DE L\'ETABLISSEMENT =====\n')

  const manager = await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })
  const managerToken = manager.data.token
  const cashier = await req('POST', '/auth/login-code', { loginCode: '1234' })
  const cashierToken = cashier.data.token

  console.log('— Lecture —')
  const pub = await req('GET', '/settings')
  check(pub.status === 200, 'Lisibles sans authentification (le ticket en a besoin)')
  check(typeof pub.data.restaurantName === 'string', 'restaurantName fourni')
  check(typeof pub.data.currency === 'string', 'currency fournie')
  check(typeof pub.data.ticketFooter === 'string', 'ticketFooter fourni')

  console.log('\n— Modification —')
  const saved = await req('PUT', '/settings', {
    restaurantName: 'Chez Mohamed',
    address: '12 Avenue Habib Bourguiba, Gabès',
    phone: '75 123 456',
    ticketFooter: 'Merci et à bientôt',
  }, managerToken)
  check(saved.status === 200, 'Le gerant peut enregistrer')
  check(saved.data.restaurantName === 'Chez Mohamed', 'Le nom est bien enregistre')
  check(saved.data.currency === 'DT', 'Les valeurs non modifiees sont conservees')

  const relu = await req('GET', '/settings')
  check(relu.data.address.includes('Gabès'), 'La valeur persiste apres relecture')

  console.log('\n— Qui peut modifier —')
  const parCaissier = await req('PUT', '/settings', { restaurantName: 'Pirate' }, cashierToken)
  check(parCaissier.status === 403, 'Un caissier ne peut pas modifier')

  const sansJeton = await req('PUT', '/settings', { restaurantName: 'Pirate' })
  check(sansJeton.status === 401, 'Sans authentification, modification refusee')

  const apres = await req('GET', '/settings')
  check(apres.data.restaurantName === 'Chez Mohamed', 'Le nom n\'a pas ete altere')

  console.log('\n— Cles inconnues —')
  const bidon = await req('PUT', '/settings', {
    restaurantName: 'Chez Mohamed',
    isAdmin: true,
    nimporteQuoi: 'x',
  }, managerToken)
  check(bidon.data.isAdmin === undefined, 'Une cle inventee est ignoree')
  check(bidon.data.nimporteQuoi === undefined, 'Aucune cle parasite enregistree')

  /* ───────── Fond de carte ─────────
     Le livreur voyait un carre gris : le serveur public d'OpenStreetMap
     bloque les applications trop gourmandes. L'adresse des tuiles doit
     donc etre changeable sans redeploiement. */
  console.log('\n— Fond de carte —')

  const defaut = await req('GET', '/settings')
  check(
    typeof defaut.data.mapTileUrl === 'string' && defaut.data.mapTileUrl.includes('{z}'),
    'Un fond de carte est servi par defaut, avec ses reperes de tuile'
  )
  check(
    !defaut.data.mapTileUrl.includes('{s}'),
    'Sans sous-domaine {s} : cette forme est abandonnee et renvoie des tuiles barrees'
  )
  check(
    typeof defaut.data.mapAttribution === 'string' && defaut.data.mapAttribution.length > 0,
    'La mention obligatoire accompagne le fond'
  )

  const propre = await req('PUT', '/settings', {
    mapTileUrl: 'https://tuiles.exemple.tn/{z}/{x}/{y}.png?key=abc123',
    mapAttribution: '© Exemple',
  }, managerToken)
  check(
    propre.data.mapTileUrl.includes('key=abc123'),
    'Le gerant branche son propre fournisseur, cle comprise'
  )
  check(propre.data.mapAttribution === '© Exemple', 'Et la mention qui va avec')

  const releve = await req('GET', '/settings')
  check(
    releve.data.mapTileUrl.includes('tuiles.exemple.tn'),
    'Les livreurs le lisent sans authentification : la carte s\'affiche des l\'ouverture'
  )

  const parLeCaissier = await req('PUT', '/settings', {
    mapTileUrl: 'https://pirate.example/{z}/{x}/{y}.png',
  }, cashierToken)
  check(parLeCaissier.status === 403, 'Un caissier ne detourne pas le fond de carte')

  // On remet le defaut pour ne pas laisser une adresse morte derriere nous.
  await req('PUT', '/settings', {
    mapTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    mapAttribution: '© OpenStreetMap',
  }, managerToken)

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
