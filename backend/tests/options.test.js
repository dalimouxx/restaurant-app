// Choix predefinis : prix, vocabulaire transmis a la cuisine, stock et

const { pizzaDeTest, toujoursOuvert, FROMAGE } = require('./fixture');
// impossibilite de fabriquer un supplement depuis le navigateur.

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
  console.log('\n===== CHOIX PREDEFINIS =====\n')

  const admin = await req('POST', '/auth/login', {
    email: 'manager@restaurant.com',
    password: 'manager123',
  })
  const adminToken = admin.data.token
  const cashier = await req('POST', '/auth/login-code', { loginCode: '1234' })
  const cashierToken = cashier.data.token

  console.log('— Le menu porte les choix —')
  const products = await req('GET', '/products')
  const pizza = await pizzaDeTest(adminToken)
  check(!!pizza, 'Pizza Margherita presente')

  // La base de developpement est creee par seed.js, sans options :
  // on en ajoute pour ce test, comme le ferait le gerant.
  let options = pizza.options || []
  if (options.length === 0) {
    const stock = await req('GET', '/stock', null, adminToken)
    const fromage = stock.data.find((i) => i.name === FROMAGE)

    await req(
      'POST',
      `/products/${pizza.id}/options`,
      { kind: 'remove', label: 'Basilic' },
      adminToken,
    )
    await req(
      'POST',
      `/products/${pizza.id}/options`,
      {
        kind: 'add',
        label: 'Fromage',
        extraPrice: 2,
        ingredientId: fromage.id,
        quantityDelta: 0.08,
      },
      adminToken,
    )
    const fresh = await req('GET', `/products/${pizza.id}/options`)
    options = fresh.data
  }

  const basilic = options.find((o) => o.kind === 'remove')
  const extraFromage = options.find((o) => o.kind === 'add' && o.extraPrice > 0)
  check(!!basilic && !!extraFromage, 'Un retrait et un supplement payant existent')

  console.log('\n— Un retrait est gratuit —')
  const r1 = await req('POST', '/orders/kiosk', {
    items: [{ productId: pizza.id, quantity: 1, optionIds: [basilic.id] }],
    fulfillmentType: 'dine_in',
  })
  check(r1.status === 201, 'Commande avec un retrait acceptee')
  check(
    Math.abs(r1.data.subtotal - pizza.price) < 0.001,
    `Prix inchange : ${r1.data.subtotal} DT (${pizza.price} attendu)`,
  )
  check(
    r1.data.items[0].customization.removed?.[0]?.label === basilic.label,
    'Le retrait est transmis a la cuisine avec son intitule',
  )

  console.log('\n— Un supplement est facture —')
  const r2 = await req('POST', '/orders/kiosk', {
    items: [{ productId: pizza.id, quantity: 2, optionIds: [extraFromage.id] }],
    fulfillmentType: 'dine_in',
  })
  const attendu = (pizza.price + extraFromage.extraPrice) * 2
  check(
    Math.abs(r2.data.subtotal - attendu) < 0.001,
    `Prix avec supplement : ${r2.data.subtotal} DT (${attendu} attendu)`,
  )
  check(
    r2.data.items[0].customization.added?.[0]?.price === extraFromage.extraPrice,
    'Le prix du supplement est fige sur la ligne',
  )

  console.log('\n— Le navigateur ne peut rien inventer —')
  const faux = await req('POST', '/orders/kiosk', {
    items: [
      {
        productId: pizza.id,
        quantity: 1,
        optionIds: ['00000000-0000-0000-0000-000000000000'],
      },
    ],
    fulfillmentType: 'dine_in',
  })
  check(faux.status >= 400, 'Un choix inconnu est refuse')

  const autreProduit = products.data.find((p) => p.id !== pizza.id)
  if (autreProduit) {
    const autresOptions = await req('GET', `/products/${autreProduit.id}/options`)
    if (autresOptions.data.length > 0) {
      const croise = await req('POST', '/orders/kiosk', {
        items: [
          { productId: pizza.id, quantity: 1, optionIds: [autresOptions.data[0].id] },
        ],
        fulfillmentType: 'dine_in',
      })
      check(croise.status >= 400, "Un choix appartenant a un autre plat est refuse")
    }
  }

  const triche = await req('POST', '/orders/kiosk', {
    items: [
      {
        productId: pizza.id,
        quantity: 1,
        optionIds: [extraFromage.id],
        unitPrice: 1,
        customization: { added: [{ label: 'Offert', price: 0 }] },
      },
    ],
    fulfillmentType: 'dine_in',
  })
  check(
    Math.abs(triche.data.subtotal - (pizza.price + extraFromage.extraPrice)) < 0.001,
    'Un prix envoye par le navigateur est ignore',
  )

  console.log('\n— Le supplement consomme du stock —')
  const avant = await req('GET', '/stock', null, adminToken)
  const fromageAvant = avant.data.find((i) => i.name === FROMAGE).quantityInStock

  const r3 = await req('POST', '/orders/kiosk', {
    items: [{ productId: pizza.id, quantity: 1, optionIds: [extraFromage.id] }],
    fulfillmentType: 'dine_in',
  })
  await req('POST', `/orders/${r3.data.id}/pay`, { paymentMethod: 'cash' }, cashierToken)

  const apres = await req('GET', '/stock', null, adminToken)
  const fromageApres = apres.data.find((i) => i.name === FROMAGE).quantityInStock
  const consomme = fromageAvant - fromageApres

  check(
    consomme > 0.15,
    `Le supplement s'ajoute a la recette : ${consomme.toFixed(3)} kg retires (plus que la recette seule)`,
  )

  console.log('\n— Prise de commande au comptoir —')
  const comptoir = await req(
    'POST',
    '/orders/counter',
    {
      items: [{ productId: pizza.id, quantity: 1, optionIds: [basilic.id] }],
      fulfillmentType: 'dine_in',
    },
    cashierToken,
  )
  check(comptoir.status === 201, 'Le caissier peut creer une commande')
  check(comptoir.data.source === 'counter', 'Elle est tracee comme « comptoir »')
  check(
    comptoir.data.status === 'awaiting_payment',
    'Elle arrive dans la file a encaisser',
  )

  const sansJeton = await req('POST', '/orders/counter', {
    items: [{ productId: pizza.id, quantity: 1 }],
  })
  check(sansJeton.status === 401, 'Sans authentification, le comptoir est ferme')

  const vide = await req('POST', '/orders/counter', { items: [] }, cashierToken)
  check(vide.status === 400, 'Une commande vide est refusee')

  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => {
  console.error('Erreur:', e)
  process.exit(1)
})
