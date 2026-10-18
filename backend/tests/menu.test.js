// Gestion de la carte : categories, plats, photos, choix predefinis, recettes.
// Verifie aussi que les decisions du gerant se repercutent immediatement sur
// ce que la borne et la caisse peuvent commander.

const BASE = 'http://localhost:4000/api'
let pass = 0
let fail = 0

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`) }
  else { fail++; console.log(`  FAIL - ${msg}`) }
}

/** Les montants passent par un flottant en base : on compare au millime. */
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

const tag = `T${Date.now().toString().slice(-6)}`

async function run() {
  console.log('\n===== GESTION DE LA CARTE =====\n')

  const manager = await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })
  const mgr = manager.data.token
  const cashier = await req('POST', '/auth/login-code', { loginCode: '1234' })
  const cash = cashier.data.token

  // Un cuisinier est necessaire : c'est lui qui constate une rupture.
  const cookCode = String(Date.now()).slice(-4)
  const cookAccount = await req('POST', '/users', {
    fullName: `Cuisinier ${tag}`, role: 'cook', loginCode: cookCode,
  }, mgr)
  const cookLogin = await req('POST', '/auth/login-code', { loginCode: cookCode })
  const cook = cookLogin.data.token
  check(cookAccount.status === 201, 'Compte cuisinier de test cree')
  check(!!cook, 'Un cuisinier se connecte avec son code, comme un caissier')

  const emptyCode = await req('POST', '/auth/login-code', {})
  check(emptyCode.status === 400, 'Un code absent est refuse proprement')
  const emptyBadge = await req('POST', '/auth/login-qr', {})
  check(emptyBadge.status === 400, 'Un badge absent est refuse proprement')

  /* ───────── Categories ───────── */
  console.log('\n— Categories —')

  const cat = await req('POST', '/products/categories', { name: `Carte ${tag}` }, mgr)
  check(cat.status === 201, 'Le gerant cree une categorie')
  check(typeof cat.data.displayOrder === 'number', 'La categorie recoit une place')
  const catId = cat.data.id

  const refused = await req('POST', '/products/categories', { name: 'Pirate' }, cash)
  check(refused.status === 403, 'Un caissier ne peut pas creer de categorie')

  const tooShort = await req('POST', '/products/categories', { name: 'x' }, mgr)
  check(tooShort.status === 400, 'Un nom d\'une lettre est refuse')

  const renamed = await req('PUT', `/products/categories/${catId}`, {
    name: `Carte ${tag} bis`,
  }, mgr)
  check(renamed.data.name === `Carte ${tag} bis`, 'La categorie se renomme')

  const listed = await req('GET', '/products/categories')
  check(
    listed.data.some((c) => c.id === catId),
    'La categorie apparait dans la liste publique'
  )

  /* ───────── Creation d'un plat ───────── */
  console.log('\n— Creation d\'un plat —')

  const ingredients = (await req('GET', '/stock', null, mgr)).data
  const first = ingredients[0]
  const second = ingredients[1]

  const created = await req('POST', '/products', {
    name: `Sandwich ${tag}`,
    price: 6.5,
    categoryId: catId,
    description: 'Thon, oeuf, harissa',
    recipe: [{ ingredientId: first.id, quantityNeeded: 0.2 }],
    options: [
      { kind: 'remove', label: 'Oignon' },
      { kind: 'add', label: 'Fromage', extraPrice: 1.2, ingredientId: second.id, quantityDelta: 0.05 },
    ],
  }, mgr)
  check(created.status === 201, 'Le gerant cree un plat')
  check(created.data.price === 6.5, 'Le prix est enregistre')
  const dishId = created.data.id

  const byCashier = await req('POST', '/products', {
    name: 'Pirate', price: 1, categoryId: catId,
  }, cash)
  check(byCashier.status === 403, 'Un caissier ne peut pas creer de plat')

  const badPrice = await req('POST', '/products', {
    name: `Mauvais ${tag}`, price: -3, categoryId: catId,
  }, mgr)
  check(badPrice.status === 400, 'Un prix negatif est refuse')

  const badCategory = await req('POST', '/products', {
    name: `Orphelin ${tag}`, price: 3,
    categoryId: '00000000-0000-4000-8000-000000000000',
  }, mgr)
  check(badCategory.status === 400, 'Une categorie inconnue est refusee')

  /* ───────── Lecture ───────── */
  console.log('\n— Lecture —')

  const publicMenu = await req('GET', '/products')
  const inMenu = publicMenu.data.find((p) => p.id === dishId)
  check(!!inMenu, 'Le plat apparait aussitot dans le menu public')
  check(inMenu.options.length === 2, 'Ses deux choix predefinis sont fournis')

  const full = await req('GET', '/products/all', null, mgr)
  const managed = full.data.find((p) => p.id === dishId)
  check(Array.isArray(managed.recipe), 'La vue du gerant fournit la recette')
  check(managed.recipe.length === 1, 'La recette compte un ingredient')

  const allByCashier = await req('GET', '/products/all', null, cash)
  check(allByCashier.status === 403, 'La vue du gerant est fermee au caissier')

  /* ───────── Photo ───────── */
  console.log('\n— Photo —')

  const withPhoto = await req('PUT', `/products/${dishId}`, {
    imageUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==',
  }, mgr)
  check(withPhoto.status === 200, 'Une photo en data URL est acceptee')
  check(withPhoto.data.imageUrl.startsWith('data:image/jpeg'), 'La photo est conservee')

  const notAnImage = await req('PUT', `/products/${dishId}`, {
    imageUrl: 'javascript:alert(1)',
  }, mgr)
  check(notAnImage.status === 400, 'Une chaine qui n\'est pas une image est refusee')

  const tooHeavy = await req('PUT', `/products/${dishId}`, {
    imageUrl: 'data:image/png;base64,' + 'A'.repeat(400_001),
  }, mgr)
  check(tooHeavy.status === 413, 'Une photo trop lourde est refusee')

  const removedPhoto = await req('PUT', `/products/${dishId}`, { imageUrl: null }, mgr)
  check(removedPhoto.data.imageUrl === null, 'La photo peut etre retiree')

  /* ───────── Prix et commande ───────── */
  console.log('\n— Le prix du jour est celui qui s\'applique —')

  await req('PUT', `/products/${dishId}`, { price: 7.2 }, mgr)
  const afterPriceChange = await req('POST', '/orders/kiosk', {
    items: [{ productId: dishId, quantity: 1, optionIds: [] }],
    fulfillmentType: 'pickup',
  })
  check(
    near(afterPriceChange.data.subtotal, 7.2),
    'Une commande passee apres la hausse utilise le nouveau prix'
  )

  /* ───────── Epuise ───────── */
  console.log('\n— Epuise —')

  const soldOut = await req('POST', `/products/${dishId}/toggle-available`, null, cook)
  check(soldOut.status === 200, 'Le cuisinier peut declarer une rupture')
  check(soldOut.data.isAvailable === false, 'Le plat est marque epuise')

  const refusedOrder = await req('POST', '/orders/kiosk', {
    items: [{ productId: dishId, quantity: 1, optionIds: [] }],
    fulfillmentType: 'pickup',
  })
  check(refusedOrder.status >= 400, 'Un plat epuise ne peut plus etre commande')

  const stillListed = await req('GET', '/products')
  check(
    stillListed.data.some((p) => p.id === dishId),
    'Il reste visible, affiche epuise plutot que disparu'
  )

  const backOn = await req('POST', `/products/${dishId}/toggle-available`, null, mgr)
  check(backOn.data.isAvailable === true, 'Le gerant le remet disponible')

  const byCashierToggle = await req('POST', `/products/${dishId}/toggle-available`, null, cash)
  check(byCashierToggle.status === 403, 'Le caissier ne touche pas a la disponibilite')

  /* ───────── Choix predefinis ───────── */
  console.log('\n— Choix predefinis —')

  const freeRemoval = await req('POST', `/products/${dishId}/options`, {
    kind: 'remove', label: 'Harissa', extraPrice: 5,
  }, mgr)
  check(freeRemoval.status === 201, 'Un retrait s\'ajoute')
  check(freeRemoval.data.extraPrice === 0, 'Un retrait reste gratuit meme si un prix est envoye')

  const badKind = await req('POST', `/products/${dishId}/options`, {
    kind: 'whatever', label: 'Test',
  }, mgr)
  check(badKind.status === 400, 'Un type de choix inconnu est refuse')

  const paidAdd = await req('POST', `/products/${dishId}/options`, {
    kind: 'add', label: 'Olives', extraPrice: 0.8,
  }, mgr)
  const editedAdd = await req('PUT', `/products/options/${paidAdd.data.id}`, {
    label: 'Olives noires', extraPrice: 1,
  }, mgr)
  check(editedAdd.data.label === 'Olives noires', 'Un ajout se renomme')
  check(editedAdd.data.extraPrice === 1, 'Son supplement se corrige')

  const withOption = await req('POST', '/orders/kiosk', {
    items: [{ productId: dishId, quantity: 1, optionIds: [paidAdd.data.id] }],
    fulfillmentType: 'pickup',
  })
  check(near(withOption.data.subtotal, 8.2), 'Le supplement corrige est facture (7,2 + 1)')

  await req('DELETE', `/products/options/${paidAdd.data.id}`, null, mgr)
  const afterDelete = await req('GET', `/products/${dishId}/options`)
  check(
    !afterDelete.data.some((o) => o.id === paidAdd.data.id),
    'Un choix supprime n\'est plus propose'
  )
  const orderKeepsTrace = await req('GET', `/orders/${withOption.data.id}`, null, mgr)
  check(
    orderKeepsTrace.data.items[0].customization.added[0].label === 'Olives noires',
    'La commande passee garde l\'intitule, le choix etant desactive et non efface'
  )

  const reorderedOption = await req('POST', '/orders/kiosk', {
    items: [{ productId: dishId, quantity: 1, optionIds: [paidAdd.data.id] }],
    fulfillmentType: 'pickup',
  })
  check(reorderedOption.status >= 400, 'Un choix supprime ne peut plus etre commande')

  /* ───────── Recette ───────── */
  console.log('\n— Recette —')

  const newRecipe = await req('PUT', `/products/${dishId}/recipe`, {
    recipe: [
      { ingredientId: first.id, quantityNeeded: 0.3 },
      { ingredientId: second.id, quantityNeeded: 0.1 },
    ],
  }, mgr)
  check(newRecipe.data.length === 2, 'La recette se remplace entierement')

  const reread = await req('GET', `/products/${dishId}/recipe`, null, mgr)
  const line = reread.data.find((l) => l.ingredientId === first.id)
  check(line && line.quantityNeeded === 0.3, 'La nouvelle quantite persiste')

  const emptied = await req('PUT', `/products/${dishId}/recipe`, { recipe: [] }, mgr)
  check(emptied.data.length === 0, 'Une recette peut etre videe')
  await req('PUT', `/products/${dishId}/recipe`, {
    recipe: [{ ingredientId: first.id, quantityNeeded: 0.2 }],
  }, mgr)

  /* ───────── Ordre d'affichage ───────── */
  console.log('\n— Ordre d\'affichage —')

  const second2 = await req('POST', '/products', {
    name: `Boisson ${tag}`, price: 2, categoryId: catId,
  }, mgr)
  const secondId = second2.data.id

  await req('PUT', '/products/reorder', { ids: [secondId, dishId] }, mgr)
  const ordered = (await req('GET', '/products')).data.filter(
    (p) => p.categoryId === catId
  )
  check(ordered[0].id === secondId, 'L\'ordre choisi par le gerant est celui du menu')

  /* ───────── Retrait de la carte ───────── */
  console.log('\n— Retrait de la carte —')

  const neverSold = await req('DELETE', `/products/${secondId}`, null, mgr)
  check(neverSold.data.deleted === true, 'Un plat jamais vendu est supprime pour de bon')

  const sold = await req('DELETE', `/products/${dishId}`, null, mgr)
  check(sold.data.deleted === false, 'Un plat deja vendu est archive, pas supprime')
  check(sold.data.archived === true, 'Il est marque retire de la carte')

  const publicAfter = await req('GET', '/products')
  check(
    !publicAfter.data.some((p) => p.id === dishId),
    'Un plat retire disparait du menu public'
  )

  const orderArchived = await req('POST', '/orders/kiosk', {
    items: [{ productId: dishId, quantity: 1, optionIds: [] }],
    fulfillmentType: 'pickup',
  })
  check(orderArchived.status >= 400, 'Un plat retire ne peut plus etre commande')

  const managerAfter = await req('GET', '/products/all', null, mgr)
  check(
    managerAfter.data.some((p) => p.id === dishId && p.isArchived),
    'Le gerant le voit encore, marque archive'
  )

  const restored = await req('POST', `/products/${dishId}/restore`, null, mgr)
  check(restored.data.isArchived === false, 'Il se remet a la carte')

  /* ───────── Suppression d'une categorie ───────── */
  console.log('\n— Suppression d\'une categorie —')

  const busyCategory = await req('DELETE', `/products/categories/${catId}`, null, mgr)
  check(busyCategory.status === 409, 'Une categorie contenant des plats ne se supprime pas')
  check(
    typeof busyCategory.data.error === 'string' && busyCategory.data.error.includes('plat'),
    'Le refus explique quoi faire d\'abord'
  )

  // Une categorie qui ne garde que des plats archives reste protegee : la
  // contrainte de cle etrangere emporterait les lignes de commande.
  await req('DELETE', `/products/${dishId}`, null, mgr)
  const archivedOnly = await req('DELETE', `/products/categories/${catId}`, null, mgr)
  check(
    archivedOnly.status === 409,
    'Une categorie ne gardant que des plats archives reste protegee'
  )
  check(
    archivedOnly.data.error.includes('Renommez'),
    'Le refus propose de la renommer plutot'
  )

  const stillThere = await req('GET', '/products/all', null, mgr)
  check(
    stillThere.data.some((p) => p.id === dishId),
    'Aucun plat n\'a ete emporte par la tentative de suppression'
  )

  const fresh = await req('POST', '/products/categories', { name: `Vide ${tag}` }, mgr)
  const removable = await req('DELETE', `/products/categories/${fresh.data.id}`, null, mgr)
  check(removable.status === 200, 'Une categorie sans aucun plat se supprime')

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1) })
