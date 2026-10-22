// Deroule du service configurable : etapes de cuisine, livraison, caisse.
//
// Ce que le gerant d'un fastfood a demande : pouvoir retirer « en
// preparation », couper la livraison quand aucun livreur n'est la, et
// encaisser en un geste les soirs sans caissier.

const { pizzaDeTest, toujoursOuvert } = require('./fixture')

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
    'X-Restaurant': 'principal',
      // Une borne, un ecran de salle ou un site nomment l'etablissement
      // dont ils dependent : sans session, rien d'autre ne le dit, et une
      // installation qui heberge plusieurs fastfoods refuse de deviner.
      'X-Restaurant': 'principal',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

async function run() {
  console.log('\n===== DEROULE DU SERVICE =====\n')

  const mgr = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token
  const cash = (await req('POST', '/auth/login-code', { loginCode: '1234' })).data.token

  await toujoursOuvert(mgr)
  const plat = await pizzaDeTest(mgr)

  const commander = async (type = 'dine_in', extra = {}) =>
    req('POST', '/orders/kiosk', {
      items: [{ productId: plat.id, quantity: 1, optionIds: [] }],
      fulfillmentType: type,
      ...extra,
    })

  const regler = (valeurs) => req('PUT', '/settings', valeurs, mgr)

  /* ───────── Les valeurs de depart ───────── */
  console.log('— Au depart —')

  const depart = await req('GET', '/settings')
  check(depart.data.etapesCuisine === 'deux', 'Deux etapes de cuisine par defaut')
  check(depart.data.livraisonActive === 'oui', 'La livraison est ouverte par defaut')
  check(depart.data.caisseSimplifiee === 'non', 'La caisse complete par defaut')
  check(
    (await regler({ etapesCuisine: 'nimporte quoi' })).status === 400,
    'Une valeur inventee est refusee, pas enregistree'
  )
  check(
    (await req('GET', '/settings')).data.etapesCuisine === 'deux',
    'Et le reglage n\'a pas bouge'
  )

  /* ───────── Deux etapes : le deroule classique ───────── */
  console.log('\n— Deux etapes —')

  await regler({ etapesCuisine: 'deux' })
  let o = (await commander()).data
  await req('POST', `/orders/${o.id}/pay`, { paymentMethod: 'cash' }, cash)
  let relu = (await req('GET', `/orders/${o.id}`, null, mgr)).data
  check(relu.status === 'in_kitchen', 'La commande payee part en cuisine')

  check(
    (await req('POST', `/orders/${o.id}/kitchen-status`, { status: 'preparing' }, mgr)).status === 200,
    'Le cuisinier peut la mettre en preparation'
  )
  check(
    (await req('POST', `/orders/${o.id}/kitchen-status`, { status: 'ready' }, mgr)).status === 200,
    'Puis la declarer prete'
  )

  /* ───────── Une seule etape : le rythme fastfood ───────── */
  console.log('\n— Un seul geste —')

  await regler({ etapesCuisine: 'une' })
  o = (await commander()).data
  await req('POST', `/orders/${o.id}/pay`, { paymentMethod: 'cash' }, cash)
  relu = (await req('GET', `/orders/${o.id}`, null, mgr)).data
  check(relu.status === 'in_kitchen', 'La commande part toujours en cuisine')

  const enPrep = await req('POST', `/orders/${o.id}/kitchen-status`, { status: 'preparing' }, mgr)
  check(enPrep.status === 400, '« En preparation » est refuse : cette etape n\'existe plus')
  check(
    String(enPrep.data.error).includes('un seul geste'),
    'Et le cuisinier lit pourquoi, au lieu d\'une erreur muette'
  )
  check(
    (await req('POST', `/orders/${o.id}/kitchen-status`, { status: 'ready' }, mgr)).status === 200,
    'Un seul bouton suffit a la declarer prete'
  )

  /* ───────── Sans cuisine ───────── */
  console.log('\n— Sans ecran de cuisine —')

  await regler({ etapesCuisine: 'aucune' })
  o = (await commander()).data
  await req('POST', `/orders/${o.id}/pay`, { paymentMethod: 'cash' }, cash)
  relu = (await req('GET', `/orders/${o.id}`, null, mgr)).data
  check(
    relu.status === 'ready',
    'La commande est prete des l\'encaissement : aucun poste ne doit la pousser'
  )
  check(
    (await req('POST', `/orders/${o.id}/kitchen-status`, { status: 'ready' }, mgr)).status === 400,
    'L\'ecran de cuisine ne repond plus'
  )

  const tableau = await req('GET', '/orders/board')
  check(
    tableau.data.some((l) => l.orderNumber === relu.orderNumber),
    'Elle apparait tout de suite sur l\'ecran de salle'
  )

  /* ───────── Livraison suspendue ───────── */
  console.log('\n— Livraison suspendue —')

  await regler({ etapesCuisine: 'deux' })
  const zones = (await req('GET', '/delivery/zones')).data
  const zone = zones?.[0]

  const avant = await commander('delivery', {
    deliveryAddress: 'Avenue Farhat Hached, Gabes',
    deliveryZoneId: zone?.id,
    customerName: 'Client', customerPhone: '20000000',
  })
  check(avant.status === 201 || avant.status === 200, 'Livraison ouverte : la commande passe')

  await regler({ livraisonActive: 'non' })
  const pendant = await commander('delivery', {
    deliveryAddress: 'Avenue Farhat Hached, Gabes',
    deliveryZoneId: zone?.id,
    customerName: 'Client', customerPhone: '20000000',
  })
  check(pendant.status === 409, 'Livraison coupee : une nouvelle commande est refusee')
  check(
    String(pendant.data.error).toLowerCase().includes('suspendue'),
    'Le client lit que la livraison est suspendue'
  )

  check(
    (await commander('dine_in')).status < 300,
    'Sur place et a emporter continuent normalement'
  )

  // La course deja acceptee doit aller jusqu'au bout : couper la
  // livraison ne doit pas abandonner un client qui attend deja.
  const dejaEnCours = avant.data
  await req('POST', `/orders/${dejaEnCours.id}/pay`, { paymentMethod: 'cash' }, cash)
  const suite = await req('POST', `/orders/${dejaEnCours.id}/kitchen-status`, { status: 'ready' }, mgr)
  check(
    suite.status === 200,
    'Une livraison deja engagee continue : on ne laisse pas le client en plan'
  )

  await regler({ livraisonActive: 'oui' })

  /* ───────── Commander sans compte ─────────
     Le code a scanner pose sur les tables n'a de sens que si on peut
     commander sans s'inscrire. Mais une commande sans compte doit
     rester rattachee a quelqu'un de joignable, et ne pas ouvrir la
     porte aux commandes des autres. */
  console.log('\n— Commander sans compte —')

  await regler({ commandeSansCompte: 'oui' })

  const commanderSansCompte = (extra = {}) =>
    req('POST', '/orders/online', {
      items: [{ productId: plat.id, quantity: 1, optionIds: [] }],
      fulfillmentType: 'pickup',
      ...extra,
    })

  const sansRien = await commanderSansCompte()
  check(sansRien.status === 400, 'Sans nom, la commande est refusee')

  const sansTel = await commanderSansCompte({ customerName: 'Ali' })
  check(sansTel.status === 400, 'Sans telephone non plus : il faut pouvoir le joindre')

  const invite = await commanderSansCompte({
    customerName: 'Ali Invite', customerPhone: '20123456',
  })
  check(invite.status === 201, 'Avec un nom et un telephone, elle passe')
  check(invite.data.customerId === null, 'Elle n\'appartient a aucun compte')
  check(invite.data.customerName === 'Ali Invite', 'Le nom saisi est conserve')

  const suivi = await req('GET', `/orders/${invite.data.id}`)
  check(
    suivi.status === 200,
    'Le client suit sa commande sans se connecter : c\'est son seul chemin'
  )

  // Celle d'un client inscrit, elle, reste derriere sa session.
  const client = (await req('POST', '/auth/register-customer', {
    fullName: 'Client Inscrit', phone: '9' + String(Date.now()).slice(-7),
    password: 'motdepasse123',
  })).data
  const aLui = (await req('POST', '/orders/online', {
    items: [{ productId: plat.id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'pickup',
  }, client.token)).data
  const vol = await req('GET', `/orders/${aLui.id}`)
  check(
    vol.status === 401,
    'Celle d\'un client inscrit n\'est pas lisible sans sa session'
  )

  await regler({ commandeSansCompte: 'non' })
  const ferme = await commanderSansCompte({
    customerName: 'Ali', customerPhone: '20123456',
  })
  check(ferme.status === 401, 'Le gerant peut exiger un compte : la commande est alors refusee')
  await regler({ commandeSansCompte: 'oui' })

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
