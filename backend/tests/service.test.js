// Horaires d'ouverture, zones de livraison, contact client, ecran mural.

const { openingState } = require('../src/openingHours')

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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

const tag = `S${Date.now().toString().slice(-6)}`

/** Un lundi 14 h 00, heure de Tunis. */
const LUNDI_14H = new Date('2026-10-19T13:00:00Z')

async function run() {
  console.log('\n===== SERVICE : HORAIRES, ZONES, CONTACT =====\n')

  const mgr = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token
  const cash = (await req('POST', '/auth/login-code', { loginCode: '1234' })).data.token

  /* ───────── Calcul des horaires, sans toucher au serveur ───────── */
  console.log('— Calcul des horaires —')

  const semaine = (open, close, closed = false) =>
    Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open, close, closed }])
    )

  check(openingState(semaine('11:00', '23:00'), LUNDI_14H).open === true,
    'Lundi 14 h, ouvert de 11 h a 23 h : ouvert')
  check(openingState(semaine('18:00', '23:00'), LUNDI_14H).open === false,
    'Lundi 14 h, service du soir seulement : ferme')

  const avant = openingState(semaine('18:00', '23:00'), LUNDI_14H)
  check(avant.opensAt === '18:00' && avant.opensDay === "aujourd'hui",
    'Et l\'heure de reouverture du jour est annoncee')

  check(openingState(semaine('11:00', '23:00', true), LUNDI_14H).open === false,
    'Un jour marque ferme reste ferme, horaires ou pas')

  // Service a cheval sur minuit : 18 h - 2 h, teste a 1 h du matin.
  const uneHeure = new Date('2026-10-20T00:00:00Z') // 1 h a Tunis, mardi
  check(openingState(semaine('18:00', '02:00'), uneHeure).open === true,
    'Un service 18 h - 2 h est encore ouvert a 1 h du matin')
  check(openingState(semaine('11:00', '23:00'), uneHeure).open === false,
    'Un service 11 h - 23 h est bien ferme a 1 h du matin')

  const toutFerme = openingState(semaine('11:00', '23:00', true), LUNDI_14H)
  check(toutFerme.open === false && toutFerme.opensAt === null,
    'Semaine entierement fermee : aucune reouverture annoncee')

  /* ───────── Horaires enregistres ───────── */
  console.log('\n— Horaires enregistres —')

  const avantSauvegarde = await req('GET', '/settings')
  check(!!avantSauvegarde.data.openingHours.mon, 'Les horaires sont fournis publiquement')
  check(typeof avantSauvegarde.data.opening.open === 'boolean',
    'L\'etat d\'ouverture est calcule par le serveur')

  const sauve = await req('PUT', '/settings', {
    openingHours: semaine('09:30', '22:30'),
  }, mgr)
  check(sauve.data.openingHours.wed.open === '09:30', 'Le gerant enregistre ses horaires')

  const bidon = await req('PUT', '/settings', {
    openingHours: { mon: { open: '99:99', close: 'midi', closed: 'peut-etre' } },
  }, mgr)
  check(/^\d{2}:\d{2}$/.test(bidon.data.openingHours.mon.open),
    'Une heure invalide est remplacee, jamais enregistree telle quelle')

  const parCaissier = await req('PUT', '/settings', {
    openingHours: semaine('00:00', '23:59'),
  }, cash)
  check(parCaissier.status === 403, 'Un caissier ne change pas les horaires')

  /* ───────── Fermeture : la commande en ligne refuse ───────── */
  console.log('\n— Fermeture —')

  const client = await req('POST', '/auth/register-customer', {
    fullName: `Client ${tag}`, phone: `9${tag.slice(-7)}`, password: 'motdepasse1',
  })
  const clientToken = client.data.token
  const prods = (await req('GET', '/products')).data.filter((p) => p.isAvailable)
  const panier = { items: [{ productId: prods[0].id, quantity: 1, optionIds: [] }] }

  // On ferme toute la semaine, puis on tente une commande.
  await req('PUT', '/settings', { openingHours: semaine('11:00', '23:00', true) }, mgr)
  const refusee = await req('POST', '/orders/online', {
    ...panier, fulfillmentType: 'pickup',
  }, clientToken)
  check(refusee.status === 409, 'Restaurant ferme : la commande en ligne est refusee')
  check(/ferm/i.test(refusee.data.error || ''), 'Le refus dit que c\'est ferme')

  const borne = await req('POST', '/orders/kiosk', { ...panier, fulfillmentType: 'pickup' })
  check(borne.status === 201, 'La borne, elle, continue d\'accepter')

  const comptoir = await req('POST', '/orders/counter', {
    ...panier, fulfillmentType: 'dine_in',
  }, cash)
  check(comptoir.status === 201, 'Le comptoir aussi : le personnel n\'est jamais bloque')

  // Reouverture large pour la suite des tests.
  await req('PUT', '/settings', { openingHours: semaine('00:00', '23:59') }, mgr)

  /* ───────── Zones de livraison ───────── */
  console.log('\n— Zones de livraison —')

  const zone = await req('POST', '/zones', {
    name: `Centre ${tag}`, fee: 2.5, minimumOrder: 15, estimatedMinutes: 20,
  }, mgr)
  check(zone.status === 201, 'Le gerant cree une zone')
  check(near(zone.data.fee, 2.5), 'Le tarif est enregistre')

  const zoneParCaissier = await req('POST', '/zones', { name: 'Pirate', fee: 0 }, cash)
  check(zoneParCaissier.status === 403, 'Un caissier ne cree pas de zone')

  const publiques = await req('GET', '/zones')
  check(publiques.status === 200 && publiques.data.some((z) => z.id === zone.data.id),
    'Les zones sont lisibles par le client, sans compte')

  const sansZone = await req('POST', '/orders/online', {
    ...panier, fulfillmentType: 'delivery', deliveryAddress: '12 rue des Oliviers, Gabes',
  }, clientToken)
  check(sansZone.status === 400, 'Une livraison sans zone est refusee')

  const sansAdresse = await req('POST', '/orders/online', {
    ...panier, fulfillmentType: 'delivery', deliveryZoneId: zone.data.id,
  }, clientToken)
  check(sansAdresse.status === 400, 'Une livraison sans adresse est refusee')

  const sousMinimum = await req('POST', '/orders/online', {
    ...panier,
    fulfillmentType: 'delivery',
    deliveryAddress: '12 rue des Oliviers, Gabes',
    deliveryZoneId: zone.data.id,
  }, clientToken)
  check(sousMinimum.status === 400, 'Sous le minimum de la zone, la livraison est refusee')
  check(/minimum/i.test(sousMinimum.data.error || ''), 'Le refus nomme le minimum manquant')

  // Assez de plats pour depasser les 15 DT du minimum.
  const gros = {
    items: [{ productId: prods[0].id, quantity: 10, optionIds: [] }],
  }
  const livree = await req('POST', '/orders/online', {
    ...gros,
    fulfillmentType: 'delivery',
    deliveryAddress: '12 rue des Oliviers, Gabes',
    deliveryZoneId: zone.data.id,
    customerPhone: '20 123 456',
  }, clientToken)
  check(livree.status === 201, 'Au-dessus du minimum, la livraison passe')
  check(near(livree.data.deliveryFee, 2.5), 'Les frais viennent de la zone, pas du code')
  check(livree.data.deliveryZoneId === zone.data.id, 'La zone retenue est memorisee')
  check(
    near(livree.data.totalAmount, livree.data.subtotal + 2.5),
    'Le total ajoute bien les frais de la zone'
  )

  const zoneInconnue = await req('POST', '/orders/online', {
    ...gros,
    fulfillmentType: 'delivery',
    deliveryAddress: '12 rue des Oliviers, Gabes',
    deliveryZoneId: '00000000-0000-4000-8000-000000000000',
  }, clientToken)
  check(zoneInconnue.status === 400, 'Une zone inventee est refusee')

  const nouveauTarif = await req('PUT', `/zones/${zone.data.id}`, { fee: 4 }, mgr)
  check(near(nouveauTarif.data.fee, 4), 'Le tarif se corrige')
  const auJournal = await req('GET', '/reports/audit?action=zone.fee_changed', null, mgr)
  check(
    auJournal.data.some((e) => e.details?.to === 4),
    'Un changement de tarif de livraison passe au journal'
  )

  await req('DELETE', `/zones/${zone.data.id}`, null, mgr)
  const apresRetrait = await req('GET', '/zones')
  check(
    !apresRetrait.data.some((z) => z.id === zone.data.id),
    'Une zone retiree n\'est plus proposee'
  )
  const toujoursLa = await req('GET', `/orders/${livree.data.id}`, null, mgr)
  check(
    toujoursLa.data.deliveryZoneId === zone.data.id,
    'La commande passee garde sa zone : elle est desactivee, pas effacee'
  )

  /* ───────── Contact du client ───────── */
  console.log('\n— Contact du client —')

  const avecContact = await req('POST', '/orders/counter', {
    ...panier,
    fulfillmentType: 'pickup',
    customerName: 'Slim',
    customerPhone: '22 334 455',
  }, cash)
  check(avecContact.data.customerName === 'Slim', 'Le nom est retenu au comptoir')
  check(avecContact.data.customerPhone === '22 334 455', 'Le telephone aussi')
  check(livree.data.customerPhone === '20 123 456', 'Et en ligne')

  /* ───────── Ecran mural ───────── */
  console.log('\n— Ecran mural —')

  await req('POST', `/orders/${avecContact.data.id}/pay`, { paymentMethod: 'cash' }, cash)
  const tableau = await req('GET', '/orders/board')
  check(tableau.status === 200, 'L\'ecran lit le tableau sans aucun compte')

  const ligne = tableau.data.find((e) => e.orderNumber === avecContact.data.orderNumber)
  check(!!ligne, 'La commande encaissee apparait au tableau')
  check(
    ligne && Object.keys(ligne).sort().join(',') === 'orderNumber,since,status',
    'Le tableau ne transporte que numero, etat et heure'
  )
  check(
    JSON.stringify(tableau.data).indexOf('Slim') === -1,
    'Aucun nom de client ne part vers l\'ecran de salle'
  )
  check(
    !/totalAmount|unitPrice|productName/.test(JSON.stringify(tableau.data)),
    'Aucun montant ni plat non plus'
  )

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
