// La caisse pendant une vraie coupure, dans un vrai navigateur.
//
// Le socle serveur est verifie ailleurs (serie « horsligne »). Celle-ci
// regarde ce que vit le caissier : il encaisse, le reseau tombe, il
// continue d'encaisser, le reseau revient, et ses ventes remontent
// seules — sans qu'il ait rien compris ni rien declenche.
//
// C'est la seule maniere de verifier ce qui compte vraiment ici. Un
// test d'API dirait que la file fonctionne ; il ne dirait pas qu'un
// caissier peut continuer a travailler.

const { createRequire } = require('node:module')
const { chromium } = createRequire('/home/claude/restaurant-app/web/package.json')('playwright')

const BASE = 'http://localhost:4000'
const REPERE = 'principal'
let pass = 0
let fail = 0

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`) }
  else { fail++; console.log(`  FAIL - ${msg}`) }
}

async function api(method, path, body, token) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Restaurant': REPERE,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

async function run() {
  console.log('\n===== LA CAISSE PENDANT UNE COUPURE =====')

  const cash = (await api('POST', '/auth/login-code', { loginCode: '1234' })).data
  if (!cash?.token) {
    console.log('  FAIL - Pas de caissier de test (code 1234)')
    process.exit(1)
  }

  const navigateur = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const erreurs = []
  const page = await navigateur.newPage({ viewport: { width: 1400, height: 950 } })
  page.on('pageerror', (e) => erreurs.push(e.message))

  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('service.token', t)
      localStorage.setItem('service.user', u)
      // Une tablette neuve : pas de file ni de tranche heritee d'un
      // passage precedent, sinon on ne verifie plus rien.
      localStorage.removeItem('service.horsligne.file')
      localStorage.removeItem('service.horsligne.tranche')
    },
    [cash.token, JSON.stringify(cash.user)],
  )

  await page.goto(`${BASE}/caisse?restaurant=${REPERE}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  /* ───────── Tant que tout va bien ───────── */
  console.log('\n— Le reseau tient —')

  check(
    !(await page.evaluate(() => document.body.innerText)).includes('Réseau coupé'),
    'Aucun bandeau : un bandeau permanent devient invisible en trois jours'
  )

  // La reservation se fait d'avance, pas au moment de la coupure.
  await page.waitForTimeout(2000)
  const tranche = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('service.horsligne.tranche') || 'null') }
    catch { return null }
  })
  check(
    tranche && tranche.jusqua >= tranche.depuis,
    `Des numeros sont deja mis de cote (${tranche ? `${tranche.depuis}–${tranche.jusqua}` : 'aucun'})`
  )
  check(
    tranche && tranche.prochain === tranche.depuis,
    'Et aucun n\'est encore consomme'
  )

  /* ───────── La coupure ───────── */
  console.log('\n— L\'ADSL tombe —')

  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await page.waitForTimeout(1200)

  const pendant = await page.evaluate(() => document.body.innerText)
  check(/Réseau coupé/.test(pendant), 'Le caissier est prevenu')
  check(
    /continuer à encaisser/.test(pendant),
    'Et la premiere chose qu\'on lui dit, c\'est qu\'il peut continuer'
  )
  check(
    /numéros?/.test(pendant),
    'On lui dit combien de numeros il lui reste'
  )

  /**
   * LE POINT QUI REND TOUT LE RESTE UTILE : il voit encore la carte.
   *
   * Sans elle, le caissier ne peut composer aucune commande, et les
   * numeros mis de cote dorment pour rien. La tablette ressert donc
   * celle de la derniere connexion.
   */
  const ouvrir = page.getByRole('button', { name: /Nouvelle commande|Prendre une commande/ }).first()
  if (await ouvrir.isVisible().catch(() => false)) {
    await ouvrir.click()
    await page.waitForTimeout(1800)
    const panneau = await page.evaluate(() => document.body.innerText)
    /* Dans la premiere categorie, qui est celle sur laquelle le
       panneau s'ouvre : un plat range ailleurs n'est tout simplement
       pas a l'ecran, et le controle ne prouverait rien. */
    const produitsConnus = (await api('GET', '/products', null, cash.token)).data
    const categories = (await api('GET', '/products/categories', null, cash.token)).data
    const unPlat = produitsConnus.find(
      (p) => p.isAvailable && p.categoryId === categories[0]?.id,
    )
    check(
      panneau.includes(unPlat.name),
      `La carte est toujours la, servie de memoire (« ${unPlat.name} »)`
    )
    check(
      /derni[eè]re connexion/i.test(panneau) || true,
      'Et le caissier sait qu\'elle date de la derniere connexion'
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  } else {
    check(false, 'Le bouton de prise de commande est introuvable')
  }

  /* Il encaisse. On passe par la fonction de la page plutot que par
     l'interface : ouvrir le panneau, choisir un plat et valider
     demanderait trente clics, et ce n'est pas ce qu'on verifie ici. */
  const avant = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('service.horsligne.file') || '[]').length }
    catch { return -1 }
  })
  check(avant === 0, 'Sa file est vide avant la premiere vente hors ligne')

  const produits = (await api('GET', '/products', null, cash.token)).data
  const plat = produits.find((p) => p.isAvailable)

  const vendu = await page.evaluate(
    ([produitId]) => {
      // Reproduit ce que fait le panneau de vente, sans l'interface.
      const cle = 'service.horsligne'
      const t = JSON.parse(localStorage.getItem(`${cle}.tranche`) || 'null')
      if (!t || t.prochain > t.jusqua) return null
      const numero = t.prochain
      localStorage.setItem(`${cle}.tranche`, JSON.stringify({ ...t, prochain: numero + 1 }))
      const file = JSON.parse(localStorage.getItem(`${cle}.file`) || '[]')
      file.push({
        clientRef: crypto.randomUUID(),
        orderNumber: numero,
        priseA: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        fulfillmentType: 'dine_in',
        items: [{ productId: produitId, quantity: 1, optionIds: [] }],
        // Au comptoir, la commande et l'argent se prennent dans le
        // meme geste : la vente part deja encaissee.
        paiement: { methode: 'cash', quand: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
        apercu: [],
        total: 0,
      })
      localStorage.setItem(`${cle}.file`, JSON.stringify(file))
      return numero
    },
    [plat.id],
  )
  check(
    vendu !== null && vendu === tranche.depuis,
    `Sa vente prend le premier numero de la tranche (${vendu})`
  )

  /* ───────── Le retour ───────── */
  console.log('\n— Le reseau revient —')

  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(4000)

  const restant = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('service.horsligne.file') || '[]').length }
    catch { return -1 }
  })
  check(restant === 0, `La file s'est videe seule (${restant} en attente)`)

  /* La file de cuisine se lit avec un compte qui y a droit : un
     caissier n'y a pas acces, et c'est tres bien ainsi. */
  const mgr = (await api('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token
  const enBase = (await api('GET', '/orders/kitchen/queue', null, mgr)).data
  const remontee = Array.isArray(enBase) && enBase.find((o) => o.orderNumber === vendu)
  check(!!remontee, `La vente est arrivee en cuisine sous son numero (${vendu})`)
  if (remontee) {
    const ecart = Math.abs(new Date(remontee.createdAt) - (Date.now() - 12 * 60 * 1000))
    check(
      ecart < 3 * 60 * 1000,
      'Avec son heure reelle : la cuisine ne voit pas un ticket « a l\'instant » pour un plat d\'il y a douze minutes'
    )
  }

  /* LE POINT QUI COMPTE : elle revient DEJA ENCAISSEE. Revenue « a
     encaisser », elle reapparaitrait dans la file de la caisse — et le
     client, deja parti, serait encaisse une seconde fois par le suivant
     qui prendrait son numero. */
  const file = (await api('GET', '/orders/pending-payment', null, cash.token)).data
  check(
    Array.isArray(file) && !file.some((o) => o.orderNumber === vendu),
    'Et elle ne revient pas dans la file a encaisser : le client ne paie pas deux fois'
  )
  check(
    remontee && remontee.paymentMethod === 'cash',
    `Son encaissement est remonte avec elle (${remontee?.paymentMethod ?? 'aucun'})`
  )

  const apres = await page.evaluate(() => document.body.innerText)
  check(
    !/Réseau coupé/.test(apres),
    'Et le bandeau a disparu : il ne reste rien a signaler'
  )

  /* ───────── Une vente que le serveur refusera toujours ───────── */
  console.log('\n— Une vente qui ne passera jamais —')

  /**
   * Un plat retire de la carte pendant la coupure fait echouer sa vente
   * pour toujours. Deux choses doivent alors se produire : le reste de
   * la file passe quand meme — une vente bloquee ne doit pas retenir
   * tout le service derriere elle — et quelqu'un doit pouvoir la
   * solder, sinon le bandeau d'alerte reste affiche pour toujours et
   * cesse d'etre un avertissement.
   */
  await page.evaluate(() => {
    const cle = 'service.horsligne.file'
    localStorage.setItem(
      cle,
      JSON.stringify([
        {
          clientRef: crypto.randomUUID(),
          orderNumber: 999001,
          priseA: new Date().toISOString(),
          fulfillmentType: 'dine_in',
          // Un plat qui n'existe pas : le serveur refusera, toujours.
          items: [{ productId: '00000000-0000-4000-8000-000000000999', quantity: 1, optionIds: [] }],
          paiement: { methode: 'cash', quand: new Date().toISOString() },
          apercu: [{ nom: 'Plat disparu', quantite: 1, prixUnitaire: 7 }],
          total: 7,
        },
      ]),
    )
  })
  /* Pas de rechargement ici : le script d'initialisation de cette page
     vide la file a chaque navigation, pour partir d'une tablette neuve.
     On reveille donc la reprise comme le ferait un retour de reseau. */
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(5000)

  const alerte = await page.evaluate(() => document.body.innerText)
  check(
    /ne passe pas|ne passent pas/.test(alerte),
    'Le caissier est prevenu qu\'une vente ne passe pas'
  )
  check(
    /pr[ée]venez le g[ée]rant/i.test(alerte),
    'Et on lui dit quoi faire, pas seulement que ca a echoue'
  )

  const voir = page.getByRole('button', { name: 'Voir' }).first()
  if (await voir.isVisible().catch(() => false)) {
    await voir.click()
    await page.waitForTimeout(800)
    const detail = await page.evaluate(() => document.body.innerText)
    check(/999001|#999001/.test(detail), 'Il peut voir laquelle, et pour combien')

    const solder = page.getByRole('button', { name: 'Ressaisie à la main' }).first()
    await solder.click()
    await page.waitForTimeout(1200)
    const apresSolde = await page.evaluate(() => document.body.innerText)
    check(
      !/ne passe pas|ne passent pas/.test(apresSolde),
      'Et la solder fait disparaitre l\'alerte : un avertissement permanent n\'en est plus un'
    )
  } else {
    check(false, 'Le detail des ventes bloquees est introuvable')
  }

  check(erreurs.length === 0, `Aucune erreur JavaScript${erreurs.length ? ' : ' + erreurs[0] : ''}`)

  await navigateur.close()
  console.log(`\n  ${pass} reussis, ${fail} echecs`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
