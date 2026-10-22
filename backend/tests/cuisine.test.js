// Cuisine : temps de preparation fige, rappel d'un ticket marque pret.

const { pizzaDeTest, toujoursOuvert } = require('./fixture');

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
  console.log('\n===== CUISINE =====\n')

  const mgr = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token
  const cash = (await req('POST', '/auth/login-code', { loginCode: '1234' })).data.token

  const code = String(Date.now()).slice(-4)
  await req('POST', '/users', {
    fullName: `Cuisinier ${code}`, role: 'cook', loginCode: code,
  }, mgr)
  const cook = (await req('POST', '/auth/login-code', { loginCode: code })).data.token

  const plat = await pizzaDeTest(mgr)

  /* ───────── Temps de preparation ───────── */
  console.log('— Temps de preparation —')

  const avecTemps = await req('PUT', `/products/${plat.id}`, { prepMinutes: 12 }, mgr)
  check(avecTemps.data.prepMinutes === 12, 'Le gerant annonce un temps de preparation')

  const absurde = await req('PUT', `/products/${plat.id}`, { prepMinutes: 9999 }, mgr)
  check(absurde.data.prepMinutes <= 180, 'Une valeur absurde est ramenee a un maximum')
  await req('PUT', `/products/${plat.id}`, { prepMinutes: 12 }, mgr)

  const cmd = (await req('POST', '/orders/kiosk', {
    items: [{ productId: plat.id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'dine_in',
  })).data
  check(
    cmd.items[0].prepMinutes === 12,
    'Le temps est fige sur la ligne de commande, comme le nom et le prix'
  )

  await req('PUT', `/products/${plat.id}`, { prepMinutes: 30 }, mgr)
  const relue = await req('GET', `/orders/${cmd.id}`, null, mgr)
  check(
    relue.data.items[0].prepMinutes === 12,
    'Changer la recette ne reecrit pas un ticket deja parti'
  )

  /* ───────── Rappel d'un ticket ───────── */
  console.log('\n— Rappel d\'un ticket —')

  await req('POST', `/orders/${cmd.id}/pay`, { paymentMethod: 'cash' }, cash)
  await req('POST', `/orders/${cmd.id}/kitchen-status`, { status: 'preparing' }, cook)
  const prete = await req('POST', `/orders/${cmd.id}/kitchen-status`, { status: 'ready' }, cook)
  check(prete.data.status === 'ready', 'La cuisine marque la commande prete')

  const rappel = await req('POST', `/orders/${cmd.id}/kitchen-status`, {
    status: 'preparing',
  }, cook)
  check(rappel.status === 200, 'Marquee prete par erreur, elle se rappelle')
  check(rappel.data.status === 'preparing', 'Elle repasse en preparation')

  const auJournal = await req('GET', '/reports/audit?action=order.kitchen_undo', null, mgr)
  check(
    auJournal.data.some((e) => e.details?.orderNumber === cmd.orderNumber),
    'Le rappel passe au journal : c\'est un retour en arriere, il se trace'
  )

  const statutInvente = await req('POST', `/orders/${cmd.id}/kitchen-status`, {
    status: 'livree',
  }, cook)
  check(statutInvente.status === 400, 'Un statut invente est refuse')

  /* ───────── Une fois partie, on ne rappelle plus ───────── */
  console.log('\n— Une commande partie ne se rappelle plus —')

  await req('PUT', '/settings', { openingHours: toujoursOuvert() }, mgr)
  const zone = (await req('GET', '/zones')).data[0]
  const client = (await req('POST', '/auth/register-customer', {
    fullName: `Client ${code}`, phone: `66${code}${Date.now().toString().slice(-5)}`,
    password: 'motdepasse1',
  })).data.token

  const livraison = (await req('POST', '/orders/online', {
    items: [{ productId: plat.id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'delivery',
    deliveryAddress: '3 rue du Marche, Gabes',
    deliveryZoneId: zone.id,
  }, client)).data

  await req('POST', `/orders/${livraison.id}/pay`, { paymentMethod: 'cash_on_delivery' }, cash)
  await req('POST', `/orders/${livraison.id}/kitchen-status`, { status: 'preparing' }, cook)
  await req('POST', `/orders/${livraison.id}/kitchen-status`, { status: 'ready' }, cook)

  const avantLivreur = await req('POST', `/orders/${livraison.id}/kitchen-status`, {
    status: 'preparing',
  }, cook)
  check(
    avantLivreur.status === 200,
    'Tant qu\'aucun livreur ne l\'a prise, le rappel reste possible'
  )

  // Un livreur la prend, puis on retente.
  await req('POST', `/orders/${livraison.id}/kitchen-status`, { status: 'ready' }, cook)
  const liv = (await req('POST', '/users', {
    fullName: `Livreur ${code}`, role: 'driver', phone: `67${Date.now().toString().slice(-7)}`,
  }, mgr)).data
  const lt = (await req('POST', '/auth/login-qr', { qrToken: liv.qrToken })).data.token
  await req('POST', `/delivery/${livraison.id}/accept`, null, lt)

  const tropTard = await req('POST', `/orders/${livraison.id}/kitchen-status`, {
    status: 'preparing',
  }, cook)
  check(tropTard.status >= 400, 'Une fois le livreur parti, le rappel est refuse')

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
