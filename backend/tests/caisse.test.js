// Remise, mise en attente, partage d'addition, comptage des especes.

const { pizzaDeTest } = require('./fixture');

const BASE = 'http://localhost:4000/api'
let pass = 0
let fail = 0

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`) }
  else { fail++; console.log(`  FAIL - ${msg}`) }
}

const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.0015

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
  console.log('\n===== CAISSE : REMISE, ATTENTE, PARTAGE, COMPTAGE =====\n')

  const mgr = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token
  const cash = (await req('POST', '/auth/login-code', { loginCode: '1234' })).data.token

  const plat = await pizzaDeTest(mgr)
  const commande = async (qty = 1) =>
    (await req('POST', '/orders/kiosk', {
      items: [{ productId: plat.id, quantity: qty, optionIds: [] }],
      fulfillmentType: 'dine_in',
    })).data

  /* ───────── Remise ───────── */
  console.log('— Remise —')

  const options = await req('GET', '/orders/discount-reasons', null, cash)
  check(options.status === 200, 'Les paliers et motifs sont fournis')
  check(
    options.data.steps.length >= 3 && options.data.reasons.length >= 3,
    'Plusieurs paliers et plusieurs motifs, tous a toucher'
  )

  const c1 = await commande(2) // 36 DT
  const remise = await req('POST', `/orders/${c1.id}/discount`, {
    percent: 10, reason: 'gesture',
  }, cash)
  check(remise.status === 200, 'Le caissier accorde une remise de 10 %')
  check(near(remise.data.discountAmount, c1.subtotal * 0.1), 'Le montant est calcule sur le sous-total')
  check(
    near(remise.data.totalAmount, c1.subtotal * 0.9),
    'Le total a payer baisse d\'autant'
  )

  const palierInvalide = await req('POST', `/orders/${c1.id}/discount`, {
    percent: 37, reason: 'gesture',
  }, cash)
  check(palierInvalide.status === 400, 'Un pourcentage hors paliers est refuse')

  const motifInvalide = await req('POST', `/orders/${c1.id}/discount`, {
    percent: 10, reason: 'parce que',
  }, cash)
  check(motifInvalide.status === 400, 'Un motif hors liste est refuse')

  const tropGenereux = await req('POST', `/orders/${c1.id}/discount`, {
    percent: 100, reason: 'gesture',
  }, cash)
  check(
    tropGenereux.status === 403,
    'Un caissier ne peut pas offrir l\'addition entiere'
  )
  check(
    /gérant/i.test(tropGenereux.data.error || ''),
    'Le refus dit qu\'il faut un gerant'
  )

  const parLeGerant = await req('POST', `/orders/${c1.id}/discount`, {
    percent: 100, reason: 'staff',
  }, mgr)
  check(parLeGerant.status === 200, 'Le gerant, lui, peut offrir entierement')
  check(near(parLeGerant.data.totalAmount, 0), 'L\'addition tombe a zero')

  const journal = await req('GET', '/reports/audit?action=order.discounted', null, mgr)
  check(
    journal.data.some((e) => e.details?.orderNumber === c1.orderNumber),
    'Chaque remise passe au journal'
  )

  const retiree = await req('DELETE', `/orders/${c1.id}/discount`, null, cash)
  check(near(retiree.data.totalAmount, c1.subtotal), 'La remise peut etre retiree')

  /* ───────── Mise en attente ───────── */
  console.log('\n— Mise en attente —')

  const c2 = await commande()
  await req('POST', `/orders/${c2.id}/park`, { parked: true }, cash)

  const file = await req('GET', '/orders/pending-payment', null, cash)
  check(
    !file.data.some((o) => o.id === c2.id),
    'Une commande garee quitte la file active'
  )

  const garees = await req('GET', '/orders/parked', null, cash)
  check(garees.data.some((o) => o.id === c2.id), 'Elle se retrouve dans les garees')

  await req('POST', `/orders/${c2.id}/park`, { parked: false }, cash)
  const retour = await req('GET', '/orders/pending-payment', null, cash)
  check(retour.data.some((o) => o.id === c2.id), 'Elle revient dans la file d\'un geste')

  const paiee = await commande()
  await req('POST', `/orders/${paiee.id}/pay`, { paymentMethod: 'cash' }, cash)
  const garerPayee = await req('POST', `/orders/${paiee.id}/park`, { parked: true }, cash)
  check(garerPayee.status === 400, 'Une commande deja encaissee ne se gare pas')

  /* ───────── Partage d'addition ───────── */
  console.log('\n— Partage d\'addition —')

  const c3 = await commande(2) // 36 DT
  const partage = await req('POST', `/orders/${c3.id}/split`, { parts: 3 }, cash)
  check(partage.data.splitCount === 3, 'L\'addition se partage en trois')

  const p1 = await req('POST', `/orders/${c3.id}/pay`, { paymentMethod: 'cash' }, cash)
  check(p1.data.splitPaidCount === 1, 'Premiere part encaissee')
  check(
    p1.data.status === 'awaiting_payment',
    'La commande ne part pas en cuisine : deux parts manquent'
  )

  await req('POST', `/orders/${c3.id}/pay`, { paymentMethod: 'card' }, cash)
  const p3 = await req('POST', `/orders/${c3.id}/pay`, { paymentMethod: 'cash' }, cash)
  check(p3.data.splitPaidCount === 3, 'Troisieme part encaissee')
  check(p3.data.status === 'in_kitchen', 'La commande part alors en cuisine')

  const somme = p3.data.splitPayments.reduce((s, x) => s + x.amount, 0)
  check(near(somme, p3.data.totalAmount), 'La somme des parts tombe juste sur le total')
  check(
    p3.data.splitPayments.filter((x) => x.method === 'card').length === 1,
    'Chaque part garde son moyen de paiement'
  )

  const partsFolles = await req('POST', `/orders/${(await commande()).id}/split`, {
    parts: 99,
  }, cash)
  check(partsFolles.status === 400, 'Un nombre de parts absurde est refuse')

  /* ───────── Le tiroir ne compte que les especes ───────── */
  console.log('\n— Ce qui est reellement dans le tiroir —')

  const ouverture = await req('POST', '/cashier/open', { openingFloat: 100 }, cash)
  if (ouverture.status === 400) {
    // Une session trainait : on la ferme puis on recommence proprement.
    await req('POST', '/cashier/close', { closingAmount: 0 }, cash)
    await req('POST', '/cashier/open', { openingFloat: 100 }, cash)
  }

  const mixte = await commande(2)
  await req('POST', `/orders/${mixte.id}/split`, { parts: 2 }, cash)
  await req('POST', `/orders/${mixte.id}/pay`, { paymentMethod: 'cash' }, cash)
  const fin = await req('POST', `/orders/${mixte.id}/pay`, { paymentMethod: 'card' }, cash)

  const partEspeces = fin.data.splitPayments
    .filter((x) => x.method === 'cash')
    .reduce((s, x) => s + x.amount, 0)

  const cloture = await req('POST', '/cashier/close', {
    closingAmount: 100 + partEspeces,
    breakdown: { 'billet-20': 1, 'billet-10': 1, 'piece-1': 3 },
  }, cash)

  check(
    near(cloture.data.expectedAmount, 100 + partEspeces),
    'Seule la part reglee en especes est attendue dans le tiroir'
  )
  check(near(cloture.data.discrepancy, 0), 'La caisse tombe juste')
  check(
    cloture.data.countBreakdown && cloture.data.countBreakdown['billet-20'] === 1,
    'Le detail du comptage est conserve, coupure par coupure'
  )

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
