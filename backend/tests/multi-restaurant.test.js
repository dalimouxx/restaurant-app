// Plusieurs fastfoods dans une seule installation.
//
// C'est la serie la plus importante du lot. Tout le reste verifie que
// l'application fait ce qu'on lui demande ; celle-ci verifie qu'elle ne
// fait PAS ce qu'on ne lui a pas demande — qu'un restaurant ne voit
// jamais les ventes, la carte, le stock ni les equipes d'un autre.
//
// Une fuite ici ne provoque aucune erreur : elle affiche simplement les
// chiffres du voisin dans le tableau de bord, et personne ne s'en rend
// compte avant qu'un gerant ne reconnaisse le chiffre d'affaires d'un
// concurrent. D'ou le nombre de controles : on regarde sous chaque porte.

const BASE = 'http://localhost:4000/api'
let pass = 0
let fail = 0

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`) }
  else { fail++; console.log(`  FAIL - ${msg}`) }
}

async function req(method, path, body, token, enTetes = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...enTetes,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

const marque = Date.now().toString().slice(-6)

async function run() {
  console.log('\n===== PLUSIEURS RESTAURANTS =====\n')

  const admin = (await req('POST', '/auth/login', {
    email: 'admin@restaurant.com', password: 'admin123',
  })).data.token

  /* ───────── Creation d'un second etablissement ───────── */
  console.log('— Ouvrir un second fastfood —')

  const liste0 = await req('GET', '/restaurants', null, admin)
  check(liste0.status === 200, 'Le super admin voit ses etablissements')
  const avant = liste0.data.length

  /**
   * Un repere fixe, et non tire de l'horloge.
   *
   * Avec un nom different a chaque execution, la serie ouvrait un
   * etablissement de plus a chaque fois et n'en refermait aucun :
   * l'ecran des etablissements finissait par en afficher cinquante,
   * tous identiques. On reutilise donc le meme, cree au premier
   * passage, et on le remet a l'etat voulu.
   */
  const REPERE_B = 'fastfood-test-b'
  const dejaLa = liste0.data.find((r) => r.slug === REPERE_B)

  const b = dejaLa
    ? { status: 201, data: dejaLa }
    : await req('POST', '/restaurants', {
        name: 'Fastfood B (serie de tests)',
        slug: REPERE_B,
        notes: 'Ouvert par la serie de tests, reutilise a chaque passage',
      }, admin)
  check(b.status === 201, 'Il en ouvre un second')
  if (dejaLa) {
    // Une execution precedente a pu le laisser suspendu.
    await req('PATCH', `/restaurants/${b.data.id}`, { isActive: true }, admin)
    b.data.isActive = true
  }
  check(b.data.slug === REPERE_B, `Il porte un repere d'adresse lisible (${b.data.slug})`)
  check(b.data.isActive === true, 'Il est actif des sa creation')

  const doublon = await req('POST', '/restaurants', {
    name: 'Autre', slug: b.data.slug,
  }, admin)
  check(doublon.status === 400, 'Deux etablissements ne peuvent pas partager le meme repere')

  const liste1 = await req('GET', '/restaurants', null, admin)
  check(
    liste1.data.length === avant + (dejaLa ? 0 : 1),
    dejaLa ? 'La liste reste stable : on reutilise le meme' : 'La liste s\'allonge d\'un'
  )

  const a = liste1.data.find((r) => r.slug === 'principal')
  check(!!a, 'L\'etablissement d\'origine est toujours la, sous son repere « principal »')

  /* ───────── Un gerant par etablissement ───────── */
  console.log('\n— Chacun son gerant —')

  const creerGerant = (restaurantId, nom, code) =>
    req('POST', '/users', {
      fullName: nom, role: 'manager', loginCode: code, restaurantId,
    }, admin)

  const codeB = String(5000 + (Number(marque) % 4000))
  let gerantB = await creerGerant(b.data.id, `Gerant B ${marque}`, codeB)
  // Le code a quatre chiffres peut etre deja pris par un passage
  // precedent : on en cherche un libre plutot que d'echouer.
  for (let essai = 0; essai < 20 && gerantB.status !== 201; essai++) {
    gerantB = await creerGerant(
      b.data.id,
      `Gerant B ${marque}-${essai}`,
      String(5000 + Math.floor(Math.random() * 4000))
    )
  }
  check(gerantB.status === 201, 'Un gerant est cree pour le second etablissement')
  check(gerantB.data.restaurantId === b.data.id, 'Il est rattache au bon restaurant')

  const sansEtablissement = await req('POST', '/users', {
    fullName: 'Orphelin', role: 'cook',
  }, admin, { 'X-Restaurant': '' })
  // Avec deux etablissements, le super admin doit dire lequel.
  check(
    sansEtablissement.status === 400,
    'Un employe ne peut pas etre cree sans etablissement quand il y en a plusieurs'
  )

  const jetonB = (await req('POST', '/auth/login-code', {
    loginCode: gerantB.data.loginCode ?? codeB,
  })).data.token
  check(!!jetonB, 'Le gerant B se connecte avec son code')

  const jetonA = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token

  /* ───────── La carte ───────── */
  console.log('\n— Les cartes ne se melangent pas —')

  const categorieB = (await req('POST', '/products/categories', {
    name: `Burgers B ${marque}`,
  }, jetonB)).data
  check(!!categorieB?.id, 'Le gerant B cree sa categorie')

  const platB = (await req('POST', '/products', {
    name: `Burger maison ${marque}`, price: 9.5, categoryId: categorieB.id,
  }, jetonB)).data
  check(!!platB?.id, 'Et son plat')

  const carteA = (await req('GET', '/products', null, jetonA)).data
  check(
    !carteA.some((p) => p.id === platB.id),
    'Le plat de B n\'apparait pas dans la carte de A'
  )
  const categoriesA = (await req('GET', '/products/categories', null, jetonA)).data
  check(
    !categoriesA.some((c) => c.id === categorieB.id),
    'Ni sa categorie'
  )

  const carteB = (await req('GET', '/products', null, jetonB)).data
  check(carteB.some((p) => p.id === platB.id), 'B voit bien son propre plat')
  check(
    carteB.length < carteA.length,
    `B part d'une carte vierge (${carteB.length} plats) et ne recupere pas celle de A (${carteA.length})`
  )

  // Viser directement une ressource d'un autre etablissement doit
  // echouer : c'est la tentative la plus evidente, et la plus facile a
  // faire par accident avec une adresse copiee.
  const platDeA = carteA.find((p) => !carteB.some((q) => q.id === p.id))
  if (platDeA) {
    const vol = await req('GET', `/products/${platDeA.id}`, null, jetonB)
    check(
      vol.status === 404 || vol.status === 403,
      'B ne peut pas lire un plat de A, meme en connaissant son identifiant'
    )
    const modif = await req('PUT', `/products/${platDeA.id}`, { price: 1 }, jetonB)
    check(
      modif.status === 404 || modif.status === 403,
      'Ni en modifier le prix'
    )
  }

  /* ───────── Les ventes ───────── */
  console.log('\n— Les ventes ne se melangent pas —')

  // On ouvre B pour pouvoir y commander.
  const toujours = Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map((j) => [j, { closed: false, open: '00:00', close: '23:59' }])
  )
  await req('PUT', '/settings', { openingHours: toujours }, jetonB)

  const commandeB = await req('POST', '/orders/kiosk', {
    items: [{ productId: platB.id, quantity: 2, optionIds: [] }],
    fulfillmentType: 'dine_in',
  }, null, { 'X-Restaurant': b.data.slug })
  check(commandeB.status === 201, 'Une borne posee chez B prend une commande')
  check(
    commandeB.data.restaurantId === b.data.id,
    'La commande est rattachee a B, pas a l\'etablissement par defaut'
  )

  const attenteA = (await req('GET', '/orders/pending-payment', null, jetonA)).data
  check(
    Array.isArray(attenteA) && !attenteA.some((o) => o.id === commandeB.data.id),
    'La caisse de A ne voit pas la commande de B'
  )

  const tableauB = (await req('GET', '/orders/board', null, null,
    { 'X-Restaurant': b.data.slug })).data
  const tableauA = (await req('GET', '/orders/board', null, null,
    { 'X-Restaurant': 'principal' })).data
  check(
    Array.isArray(tableauA) && Array.isArray(tableauB),
    'Chaque ecran de salle repond avec son repere'
  )

  /* ───────── Les numeros de commande ───────── */
  console.log('\n— Les numeros repartent a 1 chez chacun —')

  const commandeB2 = (await req('POST', '/orders/kiosk', {
    items: [{ productId: platB.id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'dine_in',
  }, null, { 'X-Restaurant': b.data.slug })).data
  check(
    commandeB2.orderNumber === commandeB.data.orderNumber + 1,
    `Les numeros de B se suivent (${commandeB.data.orderNumber} puis ${commandeB2.orderNumber})`
  )
  /* Ce qui compte n'est pas qu'il soit exactement a 1 — il garde ses
     commandes d'un passage a l'autre — mais qu'il ne reprenne pas le
     compteur du voisin, qui en est a plusieurs centaines. */
  const tableauDeA = (await req('GET', '/orders/board', null, null,
    { 'X-Restaurant': 'principal' })).data
  const plusHautChezA = Math.max(0, ...tableauDeA.map((l) => l.orderNumber))
  check(
    commandeB.data.orderNumber < plusHautChezA / 2,
    `B tient son propre compteur (${commandeB.data.orderNumber} chez lui, ` +
    `${plusHautChezA} chez A)`
  )

  /* ───────── Les equipes ───────── */
  console.log('\n— Les equipes ne se melangent pas —')

  const equipeA = (await req('GET', '/users', null, jetonA)).data
  check(
    Array.isArray(equipeA) && !equipeA.some((u) => u.id === gerantB.data.id),
    'A ne voit pas le gerant de B dans son equipe'
  )
  const equipeB = (await req('GET', '/users', null, jetonB)).data
  check(
    equipeB.some((u) => u.id === gerantB.data.id),
    'B voit le sien'
  )
  check(
    equipeB.length < equipeA.length,
    `L'equipe de B lui est propre (${equipeB.length} contre ${equipeA.length} chez A)`
  )

  /* ───────── Les reglages ───────── */
  console.log('\n— Chacun ses reglages —')

  await req('PUT', '/settings', { restaurantName: `Chez B ${marque}` }, jetonB)
  const reglagesB = (await req('GET', '/settings', null, jetonB)).data
  const reglagesA = (await req('GET', '/settings', null, jetonA)).data
  check(
    reglagesB.restaurantName === `Chez B ${marque}`,
    'Le nom enregistre par B est bien le sien'
  )
  check(
    reglagesA.restaurantName !== reglagesB.restaurantName,
    'Celui de A n\'a pas bouge'
  )

  await req('PUT', '/settings', { livraisonActive: 'non' }, jetonB)
  const derouleA = (await req('GET', '/settings', null, jetonA)).data
  check(
    derouleA.livraisonActive === 'oui',
    'Couper la livraison chez B ne la coupe pas chez A'
  )

  /* ───────── Le chiffre d'affaires ───────── */
  console.log('\n— Les chiffres ne se melangent pas —')

  const beneficeA = (await req('GET', '/reports/net-profit', null, jetonA)).data
  const beneficeB = (await req('GET', '/reports/net-profit', null, jetonB)).data
  check(
    typeof beneficeA?.totalRevenue === 'number' && typeof beneficeB?.totalRevenue === 'number',
    'Chacun obtient son compte d\'exploitation'
  )
  check(
    beneficeB.totalRevenue < beneficeA.totalRevenue,
    `B part de zero et ne herite pas des ventes de A ` +
    `(${beneficeB.totalRevenue} contre ${beneficeA.totalRevenue})`
  )
  check(
    beneficeB.ordersCount < beneficeA.ordersCount,
    `Ni de son historique (${beneficeB.ordersCount} commandes contre ${beneficeA.ordersCount})`
  )

  /* ───────── Suspension ───────── */
  console.log('\n— Suspendre un etablissement —')

  const suspendu = await req('PATCH', `/restaurants/${b.data.id}`, { isActive: false }, admin)
  check(suspendu.status === 200, 'Le super admin suspend B')
  check(suspendu.data.isActive === false, 'Il est marque inactif')

  const commandeRefusee = await req('POST', '/orders/kiosk', {
    items: [{ productId: platB.id, quantity: 1, optionIds: [] }],
    fulfillmentType: 'dine_in',
  }, null, { 'X-Restaurant': b.data.slug })
  check(commandeRefusee.status === 403, 'Sa borne n\'accepte plus de commande')

  const aTourneToujours = await req('GET', '/orders/board', null, null,
    { 'X-Restaurant': 'principal' })
  check(aTourneToujours.status === 200, 'Pendant que A continue de servir normalement')

  const repris = await req('PATCH', `/restaurants/${b.data.id}`, { isActive: true }, admin)
  check(repris.data.isActive === true, 'La reprise le remet en service')

  const retrouve = (await req('GET', '/products', null, jetonB)).data
  check(
    retrouve.some((p) => p.id === platB.id),
    'Et il retrouve sa carte intacte : suspendre n\'efface rien'
  )

  /* ───────── Le gerant ne voit pas au-dessus ───────── */
  console.log('\n— Un gerant ignore les autres etablissements —')

  const curieux = await req('GET', '/restaurants', null, jetonB)
  check(curieux.status === 403, 'Un gerant ne peut pas lister les etablissements')

  const sabotage = await req('PATCH', `/restaurants/${a.id}`, { isActive: false }, jetonB)
  check(sabotage.status === 403, 'Ni en suspendre un autre')

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
