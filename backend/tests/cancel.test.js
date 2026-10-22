// Annulation d'une commande, journal des operations, numerotation du jour
// et blocage des tentatives de connexion.
//
// Le blocage etant compte par adresse, il est teste en dernier : il ferme
// la porte pour une minute a tout ce qui suit.

const BASE = 'http://localhost:4000/api'
let pass = 0
let fail = 0

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`) }
  else { fail++; console.log(`  FAIL - ${msg}`) }
}

const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.0005

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

const tag = `A${Date.now().toString().slice(-6)}`

async function run() {
  console.log('\n===== ANNULATION ET JOURNAL =====\n')

  const mgr = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token
  const cash = (await req('POST', '/auth/login-code', { loginCode: '1234' })).data.token

  // Un plat dedie, avec une recette connue, pour mesurer le stock.
  const ingredients = (await req('GET', '/stock', null, mgr)).data
  const ing = ingredients[0]
  const cats = (await req('GET', '/products/categories')).data
  const dish = (await req('POST', '/products', {
    name: `Plat ${tag}`,
    price: 10,
    categoryId: cats[0].id,
    recipe: [{ ingredientId: ing.id, quantityNeeded: 0.5 }],
  }, mgr)).data

  /* ───────── Motifs ───────── */
  console.log('— Motifs d\'annulation —')

  const reasons = await req('GET', '/orders/cancel-reasons', null, cash)
  check(reasons.status === 200 && reasons.data.length >= 4, 'La liste des motifs est fournie')
  check(
    reasons.data.every((r) => r.code && r.label),
    'Chaque motif a un code et un intitule a afficher'
  )

  /* ───────── Annulation avant paiement ───────── */
  console.log('\n— Annulation avant paiement —')

  const stockAvant = (await req('GET', '/stock', null, mgr)).data
    .find((i) => i.id === ing.id).quantityInStock

  const impayee = (await req('POST', '/orders/kiosk', {
    items: [{ productId: dish.id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'pickup',
  })).data

  const annulee = await req('POST', `/orders/${impayee.id}/cancel`, {
    reason: 'customer_left',
  }, cash)
  check(annulee.status === 200, 'Le caissier annule une commande non payee')
  check(annulee.data.status === 'cancelled', 'Le statut passe a annulee')
  check(annulee.data.cancelReason === 'customer_left', 'Le motif est conserve')
  check(!!annulee.data.cancelledAt, 'L\'heure d\'annulation est conservee')

  const stockApres = (await req('GET', '/stock', null, mgr)).data
    .find((i) => i.id === ing.id).quantityInStock
  check(
    near(stockApres, stockAvant),
    'Le stock ne bouge pas : rien n\'avait ete deduit avant paiement'
  )

  const motifInvalide = await req('POST', `/orders/${impayee.id}/cancel`, {
    reason: 'parce que',
  }, cash)
  check(motifInvalide.status === 400, 'Un motif hors liste est refuse')

  const deuxFois = await req('POST', `/orders/${impayee.id}/cancel`, {
    reason: 'entry_error',
  }, cash)
  check(deuxFois.status === 409, 'Une commande deja annulee ne se reannule pas')

  /* ───────── Annulation apres paiement : le stock revient ───────── */
  console.log('\n— Annulation apres paiement —')

  const payee = (await req('POST', '/orders/kiosk', {
    items: [{ productId: dish.id, quantity: 2, optionIds: [] }],
    fulfillmentType: 'pickup',
  })).data
  await req('POST', `/orders/${payee.id}/pay`, { paymentMethod: 'cash' }, cash)

  const stockVendu = (await req('GET', '/stock', null, mgr)).data
    .find((i) => i.id === ing.id).quantityInStock
  check(
    near(stockVendu, stockApres - 1),
    `La vente de 2 plats retire 1,000 ${ing.unit} (2 × 0,5)`
  )

  const annulPayee = await req('POST', `/orders/${payee.id}/cancel`, {
    reason: 'kitchen_error',
  }, cash)
  check(annulPayee.status === 200, 'Une commande payee s\'annule')

  const stockRendu = (await req('GET', '/stock', null, mgr)).data
    .find((i) => i.id === ing.id).quantityInStock
  check(near(stockRendu, stockApres), 'Le stock est rendu a l\'identique')

  const mouvements = (await req('GET', `/stock/${ing.id}/movements`, null, mgr)).data
  check(
    mouvements.some((m) => m.type === 'cancellation' && m.quantity > 0),
    'Un mouvement d\'annulation est consigne, distinct d\'un ajustement'
  )

  /* ───────── La commande annulee ne compte plus ───────── */
  console.log('\n— Ce qui ne compte plus —')

  const vendus = (await req('GET', '/reports/top-products', null, mgr)).data
  const ligne = vendus.find((p) => p.name === `Plat ${tag}`)
  check(
    !ligne || ligne.quantitySold === 0,
    'Les plats d\'une commande annulee ne comptent pas dans les ventes'
  )

  /* ───────── Journal ───────── */
  console.log('\n— Journal des operations —')

  const journal = await req('GET', '/reports/audit', null, mgr)
  check(journal.status === 200, 'Le gerant lit le journal')

  const laLigne = journal.data.find(
    (e) => e.action === 'order.cancelled' && e.details?.orderNumber === payee.orderNumber
  )
  check(!!laLigne, 'L\'annulation figure au journal')
  check(laLigne.userName.length > 0, 'Le nom de l\'auteur est fige dans la ligne')
  check(laLigne.details.wasPaid === true, 'Le journal retient que la commande etait payee')
  check(
    laLigne.summary.includes('annulée'),
    'Le journal porte une phrase lisible, accentuee, sans decodage'
  )

  const parCaissier = await req('GET', '/reports/audit', null, cash)
  check(parCaissier.status === 403, 'Le caissier ne lit pas le journal')

  await req('PUT', `/products/${dish.id}`, { price: 12.5 }, mgr)
  const apresPrix = await req('GET', '/reports/audit?action=product.price_changed', null, mgr)
  check(
    apresPrix.data.some((e) => e.details?.to === 12.5),
    'Un changement de prix est consigne avec l\'ancien et le nouveau'
  )

  /* ───────── Historique de caisse ───────── */
  console.log('\n— Historique du jour a la caisse —')

  const recentes = await req('GET', '/orders/recent', null, cash)
  check(recentes.status === 200, 'Le caissier voit les commandes du jour')
  check(
    recentes.data.some((o) => o.id === payee.id),
    'Une commande encaissee reste accessible pour reimpression'
  )
  check(
    Array.isArray(recentes.data[0].items),
    'Les lignes sont fournies, de quoi reimprimer le recu'
  )

  /* ───────── File d'attente bornee ───────── */
  console.log('\n— File d\'attente —')

  const file = await req('GET', '/orders/pending-payment', null, cash)
  const limite = Date.now() - 12 * 60 * 60 * 1000
  check(
    file.data.every((o) => new Date(o.createdAt).getTime() >= limite),
    'La file ne contient que des commandes des douze dernieres heures'
  )
  check(
    file.data.every((o) => o.status === 'awaiting_payment'),
    'Aucune commande deja traitee ne traine dans la file'
  )

  /* ───────── Numerotation du jour ───────── */
  console.log('\n— Numerotation —')

  const a = (await req('POST', '/orders/kiosk', {
    items: [{ productId: dish.id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'pickup',
  })).data
  const b = (await req('POST', '/orders/kiosk', {
    items: [{ productId: dish.id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'pickup',
  })).data
  check(b.orderNumber === a.orderNumber + 1, 'Les numeros se suivent')
  check(!!a.orderDate, 'La journee commerciale est enregistree')
  check(a.orderDate === b.orderDate, 'Deux commandes du meme service partagent la journee')

  // Prises en meme temps : l'index unique doit les departager.
  const simultanees = await Promise.all(
    [0, 1, 2, 3, 4].map(() =>
      req('POST', '/orders/kiosk', {
        items: [{ productId: dish.id, quantity: 1, optionIds: [] }],
        fulfillmentType: 'pickup',
      })
    )
  )
  const numeros = simultanees.map((r) => r.data.orderNumber)
  check(
    simultanees.every((r) => r.status === 201),
    'Cinq commandes simultanees aboutissent toutes'
  )
  check(
    new Set(numeros).size === numeros.length,
    `Aucun numero en double malgre la simultaneite (${numeros.join(', ')})`
  )

  /* ───────── Epuise pose a la main ───────── */
  console.log('\n— Epuise decide, et non subi —')

  await req('POST', `/products/${dish.id}/toggle-available`, null, mgr)
  const epuise = (await req('GET', '/products/all', null, mgr)).data
    .find((p) => p.id === dish.id)
  check(epuise.isAvailable === false, 'Le plat est epuise')

  // Une vente declenche le recalcul automatique de disponibilite.
  const autre = (await req('GET', '/products')).data.find((p) => p.isAvailable && p.id !== dish.id)
  if (autre) {
    const vente = (await req('POST', '/orders/kiosk', {
      items: [{ productId: autre.id, quantity: 1, optionIds: [] }],
      fulfillmentType: 'pickup',
    })).data
    await req('POST', `/orders/${vente.id}/pay`, { paymentMethod: 'cash' }, cash)
  }

  const toujoursEpuise = (await req('GET', '/products/all', null, mgr)).data
    .find((p) => p.id === dish.id)
  check(
    toujoursEpuise.isAvailable === false,
    'Une vente ne remet pas en carte un plat declare epuise a la main'
  )

  await req('POST', `/products/${dish.id}/toggle-available`, null, mgr)
  const remis = (await req('GET', '/products/all', null, mgr)).data
    .find((p) => p.id === dish.id)
  check(remis.isAvailable === true, 'Le gerant le remet en vente')

  /* ───────── Blocage des tentatives (en dernier) ───────── */
  console.log('\n— Blocage des tentatives de connexion —')

  let bloqueApres = 0
  let dernier = null
  for (let i = 1; i <= 15; i++) {
    const essai = await req('POST', '/auth/login-code', { loginCode: '0000' })
    if (essai.status === 429) { bloqueApres = i; dernier = essai; break }
  }
  check(bloqueApres > 0, `Les tentatives finissent par etre bloquees (au ${bloqueApres}e essai)`)
  check(bloqueApres <= 12, 'Le blocage arrive avant d\'avoir pu balayer beaucoup de codes')
  check(
    typeof dernier?.data?.retryAfter === 'number' && dernier.data.retryAfter > 0,
    'Le refus indique combien de temps attendre'
  )

  const parBadge = await req('POST', '/auth/login-qr', { qrToken: 'x' })
  check(
    parBadge.status === 429,
    'Le blocage vaut aussi pour le badge : on ne contourne pas en changeant de porte'
  )

  const parMotDePasse = await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })
  check(
    parMotDePasse.status === 429,
    'Meme un identifiant correct attend : sinon le blocage ne protege rien'
  )

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
