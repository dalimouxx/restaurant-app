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

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
