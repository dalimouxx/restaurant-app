// L'arabe, et le sens de lecture.
//
// Une interface a moitie traduite est pire que pas traduite du tout : le
// client lit trois mots dans sa langue, bute sur le quatrieme, et ne sait
// plus s'il a compris le prix. Cette serie ouvre chaque ecran que voit le
// public, bascule en arabe, et verifie trois choses — que la page se
// retourne, que le francais a bien disparu, et que le nom arabe d'un plat
// prend la place du nom d'origine quand le gerant l'a saisi.
//
// Elle verifie aussi l'inverse, qui compte autant : les postes du
// personnel restent en francais. L'equipe est formee sur un vocabulaire,
// et deux vocabulaires pour une meme caisse produisent des erreurs de
// cloture, pas du confort.

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

/** Ouvre une page deja basculee en arabe, avant tout rendu. */
async function enArabe(navigateur, erreurs, largeur = 420) {
  const page = await navigateur.newPage({
    viewport: { width: largeur, height: 900 },
    hasTouch: largeur < 700,
    deviceScaleFactor: 2,
  })
  page.on('pageerror', (e) => erreurs.push(e.message))
  await page.addInitScript(() => {
    try { localStorage.setItem('service.langue', 'ar') } catch { /* prive */ }
  })
  return page
}

async function run() {
  console.log('\n===== ARABE ET SENS DE LECTURE =====')

  const mgr = (await api('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token

  /* Un plat avec un nom arabe, et un autre sans : les deux cas doivent
     se tenir sur la meme carte.
     On les prend dans la premiere categorie, qui est celle sur laquelle
     la carte s'ouvre — un plat range ailleurs n'est tout simplement pas
     a l'ecran, et le controle ne prouverait rien. */
  const produits = (await api('GET', '/products', null, mgr)).data
  const categories = (await api('GET', '/products/categories', null, mgr)).data
  const premiere = categories[0]
  const dansLaPremiere = produits.filter((p) => p.isAvailable && p.categoryId === premiere.id)
  check(
    dansLaPremiere.length >= 2,
    `La premiere categorie (${premiere.name}) porte de quoi comparer deux plats`
  )
  const cible = dansLaPremiere[0]
  const NOM_AR = 'سندويش تن للاختبار'
  await api('PUT', `/products/${cible.id}`, { nameAr: NOM_AR }, mgr)
  check(
    (await api('GET', '/products', null, mgr)).data.find((p) => p.id === cible.id).nameAr === NOM_AR,
    'Le gerant donne un nom arabe a un plat, et seulement a celui-la'
  )

  const navigateur = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const erreurs = []

  /* ───────── La vitrine ───────── */
  console.log('\n— La vitrine —')
  const vitrine = await enArabe(navigateur, erreurs, 1280)
  await vitrine.goto(`${BASE}/?restaurant=${REPERE}`, { waitUntil: 'networkidle' })
  await vitrine.waitForTimeout(2200)

  check(
    await vitrine.evaluate(() => document.documentElement.dir) === 'rtl',
    'La page se retourne : on lit de droite a gauche'
  )
  check(
    await vitrine.evaluate(() => document.documentElement.lang) === 'ar',
    'Et elle se declare en arabe, pour le navigateur comme pour un lecteur d\'ecran'
  )

  const texteVitrine = await vitrine.evaluate(() => document.body.innerText)
  check(/اطلب|القائمة/.test(texteVitrine), 'Elle est bien en arabe')
  check(
    !/Commander en ligne|Comment ça marche|Nous trouver|Horaires/.test(texteVitrine),
    'Et il n\'y reste aucune phrase francaise'
  )
  check(
    /الاثنين|الجمعة/.test(texteVitrine),
    'Les jours de la semaine aussi : c\'est la que le mot-a-mot se voit'
  )
  await vitrine.close()

  /* ───────── La carte ───────── */
  console.log('\n— La carte —')
  const carte = await enArabe(navigateur, erreurs)
  await carte.goto(`${BASE}/commander?restaurant=${REPERE}`, { waitUntil: 'networkidle' })
  await carte.waitForTimeout(2200)

  const texteCarte = await carte.evaluate(() => document.body.innerText)
  check(/قائمتنا/.test(texteCarte), 'Le titre de la carte est en arabe')
  check(
    !/Notre carte|Mes commandes|Retrait sur place/.test(texteCarte),
    'Aucune phrase francaise n\'y subsiste'
  )
  check(
    texteCarte.includes(NOM_AR),
    'Le plat traduit porte son nom arabe'
  )
  check(
    !texteCarte.includes(cible.name),
    'Et son nom d\'origine a laisse la place'
  )

  /* Le point qui compte pour un gerant presse : un plat sans traduction
     reste lisible, au lieu de laisser un trou dans la carte. */
  const sansTraduction = dansLaPremiere[1]
  check(
    texteCarte.includes(sansTraduction.name),
    'Un plat non traduit garde son nom d\'origine, au lieu de disparaitre'
  )

  /* Un prix a l'envers, ca se discute au comptoir — et ca se discute
     avec le caissier. L'algorithme bidi du navigateur reordonne « 8,50
     DT » en « DT 8,50 » des que la page est retournee, faute de savoir
     que la monnaie appartient au nombre. */
  const prix = await carte.evaluate(() =>
    [...document.querySelectorAll('.num')]
      .map((e) => e.textContent.trim())
      .filter((v) => /\d/.test(v) && /DT/.test(v))
  )
  check(prix.length > 0, `Les prix sont a l'ecran (${prix.length})`)
  check(
    prix.every((v) => !/^DT/.test(v)),
    `Et ils se lisent dans le bon sens : ${prix.slice(0, 3).join(' | ') || '—'}`
  )

  /* Un nom francais sur une carte arabe doit se tronquer par la fin,
     pas afficher ses points de suspension devant le premier mot. */
  const sensTexte = await carte.evaluate(() => {
    const e = [...document.querySelectorAll('.texte-auto')][0]
    return e ? getComputedStyle(e).unicodeBidi : null
  })
  check(
    sensTexte === 'plaintext',
    `Un plat non traduit s'aligne d'apres son propre texte (${sensTexte})`
  )

  /* Le selecteur rend la main : quelqu'un qui bascule par erreur doit
     pouvoir revenir sans chercher. */
  await carte.getByRole('button', { name: 'FR' }).click()
  await carte.waitForTimeout(600)
  check(
    await carte.evaluate(() => document.documentElement.dir) === 'ltr',
    'Un seul geste suffit pour revenir au francais'
  )
  check(
    (await carte.evaluate(() => document.body.innerText)).includes('Notre carte'),
    'Et la carte repasse en francais'
  )
  await carte.close()

  /* ───────── La borne ───────── */
  console.log('\n— La borne du comptoir —')
  const borne = await enArabe(navigateur, erreurs, 1100)
  await borne.goto(`${BASE}/borne?restaurant=${REPERE}`, { waitUntil: 'networkidle' })
  await borne.waitForTimeout(2200)

  const texteBorne = await borne.evaluate(() => document.body.innerText)
  check(/حضّر طلبك/.test(texteBorne), 'La borne accueille en arabe')
  check(
    !/Composez votre commande|Votre commande|Panier vide/.test(texteBorne),
    'Sans phrase francaise restante'
  )
  /* Le selecteur y est grand : on le touche debout, a bout de bras. */
  const hauteur = await borne.getByRole('button', { name: 'العربية' })
    .evaluate((e) => e.getBoundingClientRect().height)
  check(hauteur >= 40, `Son selecteur se touche au doigt (${Math.round(hauteur)} px)`)
  await borne.close()

  /* ───────── L'ecran de salle ───────── */
  console.log('\n— L\'ecran de salle —')
  const salle = await navigateur.newPage({ viewport: { width: 1400, height: 900 } })
  salle.on('pageerror', (e) => erreurs.push(e.message))
  await salle.goto(`${BASE}/ecran?restaurant=${REPERE}`, { waitUntil: 'networkidle' })
  await salle.waitForTimeout(2000)

  const texteSalle = await salle.evaluate(() => document.body.innerText)
  check(
    /Prêtes/.test(texteSalle) && /جاهزة/.test(texteSalle),
    'Il est bilingue : la salle entiere le lit, et personne ne touche un mur'
  )
  await salle.close()

  /* ───────── Les postes du personnel ───────── */
  console.log('\n— Les postes du personnel —')
  const poste = await enArabe(navigateur, erreurs, 1280)
  await poste.goto(`${BASE}/espace?restaurant=${REPERE}`, { waitUntil: 'networkidle' })
  await poste.waitForTimeout(1800)

  const textePoste = await poste.evaluate(() => document.body.innerText)
  check(
    /Caisse/.test(textePoste) && /Cuisine/.test(textePoste),
    'Ils restent en francais, meme avec l\'arabe choisi : l\'equipe est formee sur ce vocabulaire'
  )
  await poste.close()

  check(erreurs.length === 0, `Aucune erreur JavaScript${erreurs.length ? ' : ' + erreurs[0] : ''}`)

  // On remet le plat comme on l'a trouve.
  await api('PUT', `/products/${cible.id}`, { nameAr: null }, mgr)

  await navigateur.close()
  console.log(`\n  ${pass} reussis, ${fail} echecs`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
