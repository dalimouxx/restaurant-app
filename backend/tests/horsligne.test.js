// La caisse qui tient sans reseau.
//
// Trois mecaniques, et elles ne valent que prises ensemble.
//
// 1. Un envoi rejoue n'aboutit qu'une fois. Une caisse qui encaisse puis
//    perd la reponse n'avait aucun moyen de savoir si la vente etait
//    passee : le caissier retentait, et vendait deux fois.
// 2. Des numeros mis de cote d'avance. Hors ligne, la caisse ne peut ni
//    demander au serveur ni deviner — et deux caisses qui comptent
//    chacune dans leur coin servent deux tickets « 42 » le meme midi.
// 3. L'heure reelle de la vente. Sans elle, la cuisine verrait un ticket
//    « a l'instant » pour un sandwich prepare il y a vingt minutes, et le
//    journal entasserait tout le creux de la coupure sur une minute.

const { randomUUID } = require('node:crypto')

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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

async function run() {
  console.log('\n===== LA CAISSE SANS RESEAU =====')

  const mgr = (await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token

  const produits = (await req('GET', '/products', null, mgr)).data
  const plat = produits.find((p) => p.isAvailable)
  const ligne = [{ productId: plat.id, quantity: 1, optionIds: [] }]

  /* ───────── Un envoi rejoue ───────── */
  console.log('\n— Le caissier retente apres une reponse perdue —')

  const ref = randomUUID()
  const premiere = await req('POST', '/orders/kiosk', {
    items: ligne, fulfillmentType: 'pickup', clientRef: ref,
  })
  check(premiere.status === 201, `La vente est enregistree (#${premiere.data?.orderNumber})`)

  const rejouee = await req('POST', '/orders/kiosk', {
    items: ligne, fulfillmentType: 'pickup', clientRef: ref,
  })
  check(
    rejouee.data?.id === premiere.data?.id,
    'Le meme envoi rend la meme vente : le client ne paie pas deux fois'
  )
  check(
    rejouee.data?.orderNumber === premiere.data?.orderNumber,
    'Et le meme numero : deux tickets differents pour un sandwich seraient pires que rien'
  )

  /* Deux tentatives qui se croisent dans la meme seconde : c'est le cas
     que la verification seule laisserait passer, et que l'index unique
     en base doit rattraper.
     On passe par la caisse et non par la borne : celle-ci est bridee a
     quarante commandes par quart d'heure et par adresse, et c'est la
     limite — pas un doublon — qui ferait echouer le controle. */
  const caissier = (await req('POST', '/auth/login-code', { loginCode: '1234' })).data.token
  const refCourse = randomUUID()
  const simultanees = await Promise.all(
    [1, 2, 3].map(() =>
      req('POST', '/orders/counter', {
        items: ligne, fulfillmentType: 'dine_in', clientRef: refCourse,
      }, caissier)
    )
  )
  const ids = new Set(simultanees.map((r) => r.data?.id).filter(Boolean))
  check(
    ids.size === 1,
    `Trois tentatives simultanees ne font qu'une vente (${ids.size} distincte(s))`
  )
  check(
    simultanees.every((r) => r.status < 400),
    'Et aucune ne repart en erreur : le poste n\'a pas a deviner laquelle a gagne'
  )

  /* Une reference mal formee ne doit pas faire perdre la vente. */
  const bancale = await req('POST', '/orders/kiosk', {
    items: ligne, fulfillmentType: 'pickup', clientRef: 'pas-un-uuid',
  })
  check(
    bancale.status === 201,
    'Une reference mal formee est ignoree, pas refusee : l\'argent est deja dans le tiroir'
  )

  /* ───────── Les numeros mis de cote ───────── */
  console.log('\n— La caisse met des numeros de cote —')

  const cash = caissier
  const tranche = await req('POST', '/orders/reserver-numeros', {
    poste: 'caisse-1-test', combien: 5,
  }, cash)
  check(tranche.status === 201, `Elle recoit une tranche (${tranche.data?.depuis}–${tranche.data?.jusqua})`)
  check(
    tranche.data?.jusqua - tranche.data?.depuis === 4,
    'De la taille demandee'
  )

  /* LE POINT QUI COMPTE : tant que la tranche est reservee, personne
     d'autre ne doit recevoir ces numeros — sinon la coupure produit
     exactement les doublons qu'on voulait eviter. */
  const pendant = await req('POST', '/orders/counter', {
    items: ligne, fulfillmentType: 'dine_in', clientRef: randomUUID(),
  }, caissier)
  const dansLaTranche =
    pendant.data?.orderNumber >= tranche.data?.depuis &&
    pendant.data?.orderNumber <= tranche.data?.jusqua
  check(
    !dansLaTranche,
    `Une vente en ligne ne pioche pas dans la tranche (${pendant.data?.orderNumber} hors de ${tranche.data?.depuis}–${tranche.data?.jusqua})`
  )

  /**
   * Et elle ne saute pas par-dessus pour autant : une tranche posee en
   * hauteur ne doit pas faire commencer la journee a 331.
   *
   * Ca ne se voit que sur un etablissement dont la journee est encore
   * jeune. Ici, le restaurant principal porte deja des centaines de
   * ventes du jour — sa tranche se pose donc au-dessus d'elles, et le
   * controle ne prouverait rien. On ouvre une journee propre ailleurs.
   */
  const admin = (await req('POST', '/auth/login', {
    email: 'admin@restaurant.com', password: 'admin123',
  })).data.token
  const listeB = (await req('GET', '/restaurants', null, admin)).data
  const voisin = Array.isArray(listeB) && listeB.find((r) => r.slug === 'fastfood-test-b')

  if (voisin) {
    const chezLeVoisin = async (m, p, b, t) => {
      const res = await fetch(BASE + p, {
        method: m,
        headers: {
          'Content-Type': 'application/json',
          'X-Restaurant': 'fastfood-test-b',
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
        body: b ? JSON.stringify(b) : undefined,
      })
      let data = null
      try { data = await res.json() } catch {}
      return { status: res.status, data }
    }

    const platsB = (await chezLeVoisin('GET', '/products')).data
    const unPlatB = Array.isArray(platsB) && platsB.find((p) => p.isAvailable)

    if (unPlatB) {
      const trancheB = await chezLeVoisin(
        'POST', '/orders/reserver-numeros', { poste: 'journee-jeune', combien: 5 }, admin
      )
      const venteB = await chezLeVoisin('POST', '/orders/kiosk', {
        items: [{ productId: unPlatB.id, quantity: 1, optionIds: [] }],
        fulfillmentType: 'pickup',
      })
      check(
        trancheB.data?.depuis >= 300,
        `Sur une journee jeune, la reserve se pose en hauteur (${trancheB.data?.depuis})`
      )
      check(
        venteB.data?.orderNumber < trancheB.data?.depuis,
        `Et la vente en ligne garde sa place dans le bas (${venteB.data?.orderNumber} < ${trancheB.data?.depuis})`
      )
    }
  }

  const deuxieme = await req('POST', '/orders/reserver-numeros', {
    poste: 'caisse-2-test', combien: 5,
  }, cash)
  check(
    deuxieme.data?.depuis > tranche.data?.jusqua,
    'Une deuxieme caisse recoit une tranche disjointe'
  )

  /* Deux caisses qui demandent en meme temps : c'est la que deux
     tranches pourraient se chevaucher. */
  const course = await Promise.all(
    ['a', 'b', 'c'].map((p) =>
      req('POST', '/orders/reserver-numeros', { poste: `course-${p}`, combien: 4 }, cash)
    )
  )
  const bornes = course.map((r) => [r.data?.depuis, r.data?.jusqua]).sort((x, y) => x[0] - y[0])
  const chevauchent = bornes.some((b, i) => i > 0 && b[0] <= bornes[i - 1][1])
  check(
    !chevauchent,
    `Trois demandes simultanees donnent trois tranches disjointes : ${bornes.map((b) => b.join('–')).join(', ')}`
  )

  /* ───────── La vente hors ligne remonte ───────── */
  console.log('\n— La coupure finit, les ventes remontent —')

  const ilYAVingtMinutes = new Date(Date.now() - 20 * 60 * 1000).toISOString()
  const rattrapage = await req('POST', '/orders/counter', {
    items: ligne,
    fulfillmentType: 'dine_in',
    clientRef: randomUUID(),
    orderNumber: tranche.data.depuis,
    priseA: ilYAVingtMinutes,
  }, cash)
  check(
    rattrapage.status === 201 && rattrapage.data?.orderNumber === tranche.data.depuis,
    `Elle garde le numero pioche dans sa tranche (${rattrapage.data?.orderNumber})`
  )
  check(
    Math.abs(new Date(rattrapage.data?.createdAt) - new Date(ilYAVingtMinutes)) < 60000,
    'Et son heure reelle : la cuisine ne voit pas un ticket « a l\'instant » pour un plat d\'il y a vingt minutes'
  )

  /* Un numero deja servi ne se reprend pas. */
  const reprise = await req('POST', '/orders/counter', {
    items: ligne,
    fulfillmentType: 'dine_in',
    clientRef: randomUUID(),
    orderNumber: tranche.data.depuis,
  }, cash)
  check(
    reprise.data?.orderNumber !== tranche.data.depuis,
    `Un numero deja en service n'est pas repris (${reprise.data?.orderNumber})`
  )

  /* Un numero invente ne doit pas permettre de se choisir une place. */
  const invente = await req('POST', '/orders/counter', {
    items: ligne, fulfillmentType: 'dine_in', clientRef: randomUUID(), orderNumber: 1,
  }, cash)
  check(
    invente.data?.orderNumber !== 1,
    `Un numero qui n'appartient a aucune tranche est ignore (${invente.data?.orderNumber})`
  )

  /* Une horloge deregle ne doit pas antidater une vente. */
  const futur = await req('POST', '/orders/counter', {
    items: ligne,
    fulfillmentType: 'dine_in',
    clientRef: randomUUID(),
    priseA: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  }, cash)
  check(
    new Date(futur.data?.createdAt) <= new Date(Date.now() + 60000),
    'Une heure dans le futur est ecartee : c\'est une horloge deregle, pas une coupure'
  )

  /* ───────── Ce qui bloque, et ce qui ne bloque pas ───────── */
  console.log('\n— Un refus definitif, et un refus passager —')

  /**
   * La distinction decide du sort d'une vente en attente : un refus
   * definitif demande un arbitrage humain, tout le reste se retente.
   * Les confondre a un cout precis — un caissier dont le jeton vient
   * d'expirer verrait TOUTES ses ventes marquees « ne passeront
   * jamais », alors qu'il suffit de se reconnecter.
   */
  const platDisparu = await req('POST', '/orders/counter', {
    items: [{ productId: '00000000-0000-4000-8000-000000000999', quantity: 1, optionIds: [] }],
    fulfillmentType: 'dine_in',
    clientRef: randomUUID(),
  }, caissier)
  check(
    platDisparu.status === 400,
    `Un plat qui n'existe plus est refuse pour de bon (${platDisparu.status})`
  )

  const sansJeton = await req('POST', '/orders/counter', {
    items: ligne, fulfillmentType: 'dine_in', clientRef: randomUUID(),
  })
  check(
    sansJeton.status === 401,
    `Une session expiree repond autrement (${sansJeton.status}) : elle se repare toute seule`
  )

  console.log(`\n  ${pass} reussis, ${fail} echecs`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
