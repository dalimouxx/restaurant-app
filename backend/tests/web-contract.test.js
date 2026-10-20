// Vérifie que les réponses réelles du backend correspondent aux types

const { pizzaDeTest, toujoursOuvert } = require('./fixture');
// attendus par l'application web (src/lib/types.ts). Une divergence ici
// produirait un écran blanc ou des « undefined » en production.

const BASE = 'http://localhost:4000/api'
let pass = 0
let fail = 0

function check(cond, msg) {
  if (cond) {
    pass++
    console.log(`  OK   - ${msg}`)
  } else {
    fail++
    console.log(`  FAIL - ${msg}`)
  }
}

/** Vérifie la présence et le type de chaque champ attendu. */
function shape(obj, spec, label) {
  for (const [key, type] of Object.entries(spec)) {
    const v = obj?.[key]
    const ok =
      type === 'number'
        ? typeof v === 'number'
        : type === 'string'
          ? typeof v === 'string'
          : type === 'boolean'
            ? typeof v === 'boolean'
            : type === 'array'
              ? Array.isArray(v)
              : v !== undefined
    check(ok, `${label}.${key} est un ${type} (reçu: ${JSON.stringify(v)?.slice(0, 40)})`)
  }
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
  try {
    data = await res.json()
  } catch {
    /* pas de corps */
  }
  return { status: res.status, data }
}

async function run() {
  console.log('\n===== CONTRAT API ↔ APPLICATION WEB =====\n')

  console.log('— Authentification —')
  const admin = await req('POST', '/auth/login', {
    email: 'admin@restaurant.com',
    password: 'admin123',
  })
  check(admin.status === 200, 'Connexion administrateur')
  shape(admin.data, { token: 'string' }, 'login')
  shape(
    admin.data.user,
    { id: 'string', fullName: 'string', role: 'string', isActive: 'boolean' },
    'login.user',
  )
  const adminToken = admin.data.token

  const cashier = await req('POST', '/auth/login-code', { loginCode: '1234' })
  check(cashier.status === 200, 'Connexion caissier par code')
  check(cashier.data.user.role === 'cashier', 'Le rôle renvoyé est bien « cashier »')
  const cashierToken = cashier.data.token

  console.log('\n— Catalogue (lecture publique, écran borne) —')
  const cats = await req('GET', '/products/categories')
  check(Array.isArray(cats.data) && cats.data.length > 0, 'Catégories accessibles sans jeton')
  shape(cats.data[0], { id: 'string', name: 'string' }, 'category')

  const prods = await req('GET', '/products')
  check(Array.isArray(prods.data), 'Produits accessibles sans jeton')
  shape(
    prods.data[0],
    {
      id: 'string',
      name: 'string',
      price: 'number',
      isAvailable: 'boolean',
      categoryId: 'string',
    },
    'product',
  )
  check(
    typeof prods.data[0].price === 'number',
    'Le prix est numérique et non une chaîne (sinon les totaux se concatènent)',
  )

  const pizza = await pizzaDeTest(adminToken)

  console.log('\n— Commande depuis la borne —')
  const kiosk = await req('POST', '/orders/kiosk', {
    items: [{ productId: pizza.id, quantity: 2, customization: {} }],
    fulfillmentType: 'dine_in',
  })
  check(kiosk.status === 201, 'Commande créée sans authentification')
  shape(
    kiosk.data,
    {
      id: 'string',
      orderNumber: 'number',
      status: 'string',
      subtotal: 'number',
      deliveryFee: 'number',
      totalAmount: 'number',
      createdAt: 'string',
      items: 'array',
    },
    'order',
  )
  check(typeof kiosk.data.tipAmount === 'number', 'order.tipAmount est présent et numérique')
  shape(
    kiosk.data.items[0],
    {
      id: 'string',
      productNameSnapshot: 'string',
      unitPrice: 'number',
      quantity: 'number',
    },
    'orderItem',
  )

  console.log('\n— File de caisse —')
  const openRes = await req('POST', '/cashier/open', { openingFloat: 100 }, cashierToken)
  check([200, 201, 400].includes(openRes.status), 'Ouverture de caisse traitée')

  const current = await req('GET', '/cashier/current', null, cashierToken)
  check(current.status === 200, 'Session courante lisible')
  check(
    current.data === null || typeof current.data.openingFloat === 'number',
    'cashSession.openingFloat est numérique ou la session est nulle',
  )

  const pending = await req('GET', '/orders/pending-payment', null, cashierToken)
  check(Array.isArray(pending.data), 'File des commandes à encaisser')
  check(
    pending.data.some((o) => o.id === kiosk.data.id),
    'La commande de la borne apparaît en caisse',
  )
  check(
    Array.isArray(pending.data[0]?.items),
    'Les lignes sont incluses (sinon le ticket est vide à l’écran)',
  )

  console.log('\n— Encaissement et cuisine —')
  const paid = await req('POST', `/orders/${kiosk.data.id}/pay`, { paymentMethod: 'cash' }, cashierToken)
  check(paid.status === 200 && paid.data.status === 'in_kitchen', 'Paiement puis envoi en cuisine')

  const queue = await req('GET', '/orders/kitchen/queue', null, adminToken)
  check(Array.isArray(queue.data), 'File cuisine lisible')
  const ticket = queue.data.find((o) => o.id === kiosk.data.id)
  check(!!ticket, 'Le ticket figure dans la file cuisine')
  check(typeof ticket?.createdAt === 'string', 'order.createdAt présent (calcul du temps écoulé)')
  check(typeof ticket?.source === 'string', 'order.source présent (différenciation des canaux)')

  console.log('\n— Stock et rapports (écrans de gestion) —')
  const st = await req('GET', '/stock', null, adminToken)
  check(Array.isArray(st.data), 'Stock lisible')
  shape(
    st.data[0],
    {
      id: 'string',
      name: 'string',
      unit: 'string',
      quantityInStock: 'number',
      alertThreshold: 'number',
      costPerUnit: 'number',
      isLow: 'boolean',
    },
    'ingredient',
  )

  const profit = await req('GET', '/reports/net-profit', null, adminToken)
  shape(
    profit.data,
    {
      totalRevenue: 'number',
      ingredientCost: 'number',
      driverPayout: 'number',
      netProfit: 'number',
      ordersCount: 'number',
    },
    'netProfit',
  )

  const top = await req('GET', '/reports/top-products', null, adminToken)
  check(Array.isArray(top.data), 'Top produits lisible')
  if (top.data.length > 0) {
    shape(top.data[0], { name: 'string', quantitySold: 'number', revenue: 'number' }, 'topProduct')
  }

  console.log('\n— Équipe et badges —')
  const staff = await req('GET', '/users', null, adminToken)
  check(Array.isArray(staff.data), 'Liste des employés lisible')
  shape(staff.data[0], { id: 'string', fullName: 'string', role: 'string', isActive: 'boolean' }, 'user')

  const badge = await req('GET', `/users/${staff.data[0].id}/badge`, null, adminToken)
  check(
    typeof badge.data?.qrImage === 'string' && badge.data.qrImage.startsWith('data:image/png'),
    'Le badge renvoie une image PNG en base64 affichable dans un <img>',
  )

  console.log('\n— Parcours livraison —')
  /**
   * Une livraison exige desormais une zone : les frais ne sont plus ecrits
   * dans le code. On ouvre aussi le restaurant, sinon la commande en ligne
   * est refusee hors des heures de service.
   */
  await req('PUT', '/settings', { openingHours: toujoursOuvert() }, adminToken)
  const zoneLivraison = (await req('GET', '/zones')).data[0]
  check(!!zoneLivraison, 'Une zone de livraison est proposee au client')

  const suffix = Date.now().toString().slice(-6)
  const driver = await req(
    'POST',
    '/users',
    { fullName: 'Livreur Web', role: 'driver', phone: '62' + suffix },
    adminToken,
  )
  const driverLogin = await req('POST', '/auth/login-qr', { qrToken: driver.data.qrToken })
  check(driverLogin.status === 200, 'Le livreur se connecte avec son badge')
  const driverToken = driverLogin.data.token

  const customer = await req('POST', '/auth/register-customer', {
    fullName: 'Client Web',
    phone: '63' + suffix,
  })
  check(customer.status === 201, 'Inscription client depuis le web')
  const customerToken = customer.data.token

  const online = await req(
    'POST',
    '/orders/online',
    {
      items: [{ productId: pizza.id, quantity: 1 }],
      fulfillmentType: 'delivery',
      deliveryAddress: '5 Av. Habib Bourguiba, Gabès',
      deliveryLat: 33.8815,
      deliveryLng: 10.0982,
      deliveryZoneId: zoneLivraison.id,
    },
    customerToken,
  )
  check(online.status === 201, 'Commande en ligne avec livraison')
  // Les frais viennent de la zone choisie, plus d'une constante du code.
  check(
    online.data.deliveryFee === zoneLivraison.fee,
    `Frais de livraison appliqués par le serveur (${zoneLivraison.fee} DT)`,
  )
  check(typeof online.data.qrToken === 'string', 'order.qrToken présent (QR affiché au client)')
  check(
    typeof online.data.deliveryLat === 'number',
    'Les coordonnées GPS envoyées par le web sont bien stockées',
  )

  await req('POST', `/orders/${online.data.id}/pay`, { paymentMethod: 'cash_on_delivery' }, cashierToken)
  const ready = await req('POST', `/orders/${online.data.id}/kitchen-status`, { status: 'ready' }, adminToken)
  check(ready.data.status === 'awaiting_driver', 'Une fois prête, la course est proposée aux livreurs')

  const avail = await req('GET', '/delivery/available', null, driverToken)
  check(
    avail.data.some((o) => o.id === online.data.id),
    'La course apparaît chez le livreur',
  )
  check(
    typeof avail.data[0]?.deliveryLat === 'number' || avail.data[0]?.deliveryLat === null,
    'deliveryLat exposé au livreur (calcul de distance)',
  )

  const accepted = await req('POST', `/delivery/${online.data.id}/accept`, {}, driverToken)
  check(accepted.status === 200, 'Le livreur accepte la course')

  const second = await req('POST', `/delivery/${online.data.id}/accept`, {}, driverToken)
  check(second.status === 409, 'Une seconde acceptation renvoie 409 (gérée par isTaken côté web)')

  await req('POST', `/delivery/${online.data.id}/tip`, { tipAmount: 3 }, customerToken)
  const confirmed = await req(
    'POST',
    `/delivery/${online.data.id}/confirm-delivery`,
    { qrToken: online.data.qrToken },
    driverToken,
  )
  check(confirmed.status === 200, 'Confirmation par QR acceptée')

  const stats = await req('GET', '/delivery/my-stats', null, driverToken)
  shape(
    stats.data,
    {
      commissionPercent: 'number',
      totalCollected: 'number',
      totalDriverEarnings: 'number',
      totalTips: 'number',
      deliveriesCount: 'number',
      orders: 'array',
    },
    'driverStats',
  )
  check(
    Math.abs(stats.data.totalDriverEarnings - (zoneLivraison.fee * 0.7 + 3)) < 0.01,
    `Commission : 70 % de ${zoneLivraison.fee} DT + 3 DT de pourboire ` +
      `(reçu ${stats.data.totalDriverEarnings.toFixed(2)})`,
  )

  console.log(`\n===== ${pass} vérifications réussies, ${fail} échecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => {
  console.error('Erreur:', e)
  process.exit(1)
})
