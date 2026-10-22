// Gestion : heures de pointe, marges, inventaire, pertes, comparaison, export.

const { pizzaDeTest, FROMAGE } = require('./fixture');

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
  console.log('\n===== GESTION =====\n')

  const mgr = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token
  const cash = (await req('POST', '/auth/login-code', { loginCode: '1234' })).data.token

  const plat = await pizzaDeTest(mgr)

  // Deux ventes, pour avoir de la matiere.
  for (let i = 0; i < 2; i++) {
    const o = (await req('POST', '/orders/kiosk', {
      items: [{ productId: plat.id, quantity: 1, optionIds: [] }],
      fulfillmentType: 'dine_in',
    })).data
    await req('POST', `/orders/${o.id}/pay`, { paymentMethod: 'cash' }, cash)
  }

  /* ───────── Heures de pointe ───────── */
  console.log('— Heures de pointe —')

  const pointe = await req('GET', '/reports/peak-hours?days=7', null, mgr)
  check(pointe.status === 200, 'Le gerant lit ses heures de pointe')
  check(Array.isArray(pointe.data.hours), 'Un creneau par heure servie')
  check(
    pointe.data.hours.every((h) => h.orders > 0),
    'Seules les heures reellement servies sont renvoyees'
  )
  check(
    pointe.data.busiest === null || pointe.data.busiest.orders >= 1,
    'L\'heure la plus chargee est designee'
  )
  check(
    (await req('GET', '/reports/peak-hours', null, cash)).status === 403,
    'Un caissier ne lit pas les heures de pointe'
  )

  /* ───────── Marges ───────── */
  console.log('\n— Marge par plat —')

  const marges = await req('GET', '/reports/margins', null, mgr)
  check(marges.status === 200, 'Les marges sont calculees')

  const laPizza = marges.data.find((m) => m.id === plat.id)
  check(!!laPizza, 'Le plat de reference y figure')
  check(laPizza.hasRecipe === true, 'Il est marque comme ayant une recette')
  check(
    near(laPizza.margin, laPizza.price - laPizza.cost),
    'La marge est le prix moins le cout matiere'
  )
  check(laPizza.cost > 0, 'Le cout vient des ingredients de la recette')
  check(
    laPizza.marginPercent > 0 && laPizza.marginPercent <= 100,
    'Le pourcentage de marge est coherent'
  )

  const sansRecette = (await req('POST', '/products', {
    name: `Sans recette ${Date.now().toString().slice(-5)}`,
    price: 5,
    categoryId: (await req('GET', '/products/categories')).data[0].id,
  }, mgr)).data
  const apres = await req('GET', '/reports/margins', null, mgr)
  const orphelin = apres.data.find((m) => m.id === sansRecette.id)
  check(
    orphelin && orphelin.hasRecipe === false,
    'Un plat sans recette est signale, pas credite d\'une marge de 100 %'
  )

  /* ───────── Comparaison ───────── */
  console.log('\n— Comparaison avec la periode precedente —')

  const compare = await req('GET', '/reports/compare?days=7', null, mgr)
  check(compare.status === 200, 'La comparaison repond')
  check(
    typeof compare.data.current.revenue === 'number' &&
      typeof compare.data.previous.revenue === 'number',
    'Les deux periodes sont chiffrees'
  )
  check(
    compare.data.current.orders > 0,
    'La periode courante compte les commandes encaissees'
  )
  check(
    compare.data.change.revenue === null ||
      typeof compare.data.change.revenue === 'number',
    'L\'ecart est fourni, ou nul faute de point de comparaison'
  )

  /* ───────── Pertes ───────── */
  console.log('\n— Declaration de perte —')

  const motifs = await req('GET', '/stock/waste-reasons', null, mgr)
  check(motifs.data.length >= 3, 'Les motifs de perte sont fournis, a toucher')

  const stock = (await req('GET', '/stock', null, mgr)).data
  const fromage = stock.find((i) => i.name === FROMAGE)
  const avant = fromage.quantityInStock

  const perte = await req('POST', `/stock/${fromage.id}/waste`, {
    quantity: 0.5, reason: 'burnt',
  }, mgr)
  check(perte.status === 200, 'Une perte se declare')
  check(near(perte.data.quantityInStock, avant - 0.5), 'Le stock baisse d\'autant')

  const motifInvente = await req('POST', `/stock/${fromage.id}/waste`, {
    quantity: 1, reason: 'parce que',
  }, mgr)
  check(motifInvente.status === 400, 'Un motif hors liste est refuse')

  const quantiteNulle = await req('POST', `/stock/${fromage.id}/waste`, {
    quantity: 0, reason: 'burnt',
  }, mgr)
  check(quantiteNulle.status === 400, 'Une quantite nulle est refusee')

  const mouvements = await req('GET', `/stock/${fromage.id}/movements`, null, mgr)
  check(
    mouvements.data.some((m) => m.type === 'waste'),
    'La perte laisse un mouvement de stock a part'
  )

  const journal = await req('GET', '/reports/audit?action=stock.waste', null, mgr)
  check(
    journal.data.some((e) => e.details?.name === FROMAGE),
    'La perte passe au journal, avec sa valeur'
  )

  const benefice = await req('GET', '/reports/net-profit', null, mgr)
  check(
    typeof benefice.data.wasteCost === 'number' && benefice.data.wasteCost > 0,
    'Le cout des pertes apparait dans le benefice net'
  )

  /* ───────── Inventaire physique ───────── */
  console.log('\n— Inventaire physique —')

  const avantInv = (await req('GET', '/stock', null, mgr)).data.find((i) => i.id === fromage.id)
  const compte = Math.round((avantInv.quantityInStock - 1.25) * 1000) / 1000

  const inventaire = await req('POST', '/stock/inventory', {
    counts: [{ ingredientId: fromage.id, counted: compte }],
  }, mgr)
  check(inventaire.status === 200, 'L\'inventaire est accepte')
  check(inventaire.data.lines.length === 1, 'Une ligne par reference comptee')
  check(near(inventaire.data.lines[0].gap, -1.25), 'L\'ecart constate est exact')
  check(inventaire.data.shortages === 1, 'Le manquant est compte comme tel')
  check(inventaire.data.value < 0, 'La valeur du manquant est negative')

  const apresInv = (await req('GET', '/stock', null, mgr)).data.find((i) => i.id === fromage.id)
  check(
    near(apresInv.quantityInStock, compte),
    'Le stock est aligne sur ce qui a ete reellement compte'
  )

  const parCaissier = await req('POST', '/stock/inventory', {
    counts: [{ ingredientId: fromage.id, counted: 999 }],
  }, cash)
  check(parCaissier.status === 403, 'Un caissier ne fait pas l\'inventaire')

  const vide = await req('POST', '/stock/inventory', { counts: [] }, mgr)
  check(vide.status === 400, 'Un inventaire vide est refuse')

  const invJournal = await req('GET', '/reports/audit?action=stock.inventory', null, mgr)
  check(invJournal.data.length > 0, 'L\'inventaire passe au journal')

  /* ───────── Export comptable ───────── */
  console.log('\n— Export comptable —')

  const res = await fetch(`${BASE}/reports/export`, {
    headers: { Authorization: `Bearer ${mgr}` },
  })
  check(res.status === 200, 'L\'export repond')
  check(
    (res.headers.get('content-type') || '').includes('text/csv'),
    'Il est servi comme un fichier CSV'
  )
  check(
    (res.headers.get('content-disposition') || '').includes('attachment'),
    'Et propose en telechargement'
  )

  // On lit les octets bruts : `res.text()` retire le marqueur d'encodage
  // en decodant, et on ne verrait jamais s'il a ete envoye.
  const octets = new Uint8Array(await res.clone().arrayBuffer())
  check(
    octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf,
    'Le marqueur d\'encodage est envoye : Excel ouvre sans casser les accents'
  )

  const csv = await res.text()
  const lignes = csv.trim().split('\r\n')
  check(lignes[0].includes('Numero') && lignes[0].includes('Total'), 'L\'en-tete nomme les colonnes')
  check(lignes[0].split(';').length >= 12, 'Toutes les colonnes attendues sont presentes')
  check(lignes.length > 1, 'Au moins une vente exportee')
  check(
    lignes[1].split(';').length === lignes[0].split(';').length,
    'Chaque ligne a autant de colonnes que l\'en-tete'
  )

  const parCaissierExport = await fetch(`${BASE}/reports/export`, {
    headers: { Authorization: `Bearer ${cash}` },
  })
  check(parCaissierExport.status === 403, 'Un caissier n\'exporte pas la comptabilite')

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
