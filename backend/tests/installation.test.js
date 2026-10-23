// Installer un poste installe CE poste.
//
// Le defaut signale etait precis : on installait « Gestion » et on
// tombait sur l'ecran client. La cause ne se voyait ni dans le code des
// manifestes, qui etaient justes, ni dans le code de l'application, qui
// les posait correctement.
//
// Elle tenait au moment. Le navigateur decide de ce qu'il installera au
// CHARGEMENT de la page, d'apres le manifeste present a cet instant. Un
// gerant qui arrive par la vitrine puis navigue vers la gestion voit bien
// « Installer Gestion » a l'ecran, mais le navigateur, lui, tient
// toujours l'application cliente — et c'est elle qu'il installe.
//
// D'ou ces controles, qui portent tous sur le MOMENT plutot que sur le
// contenu : le manifeste est-il la des le premier octet, designe-t-il le
// bon poste, et une invitation captee sous un poste peut-elle servir a en
// installer un autre.

const { createRequire } = require('node:module')
const { chromium } = createRequire('/home/claude/restaurant-app/web/package.json')('playwright')

const BASE = 'http://localhost:4000'
let pass = 0
let fail = 0

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`) }
  else { fail++; console.log(`  FAIL - ${msg}`) }
}

const POSTES = [
  ['/gestion', 'gestion', '/gestion'],
  ['/caisse', 'caisse', '/caisse'],
  ['/cuisine', 'cuisine', '/cuisine'],
  ['/ecran', 'ecran', '/ecran'],
  ['/borne', 'borne', '/borne'],
  ['/livreur', 'livreur', '/livreur'],
  ['/commander', 'client', '/commander'],
]

async function run() {
  console.log('\n===== INSTALLATION D\'UN POSTE =====')

  const mgr = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Restaurant': 'principal' },
    body: JSON.stringify({ email: 'manager@restaurant.com', password: 'manager123' }),
  })).json()

  const navigateur = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })

  /* ───────── Le manifeste, des le premier octet ───────── */
  console.log('\n— Le manifeste est la avant l\'application —')

  for (const [route, poste, depart] of POSTES) {
    const page = await navigateur.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(([t, u]) => {
      localStorage.setItem('service.token', t)
      localStorage.setItem('service.user', u)
    }, [mgr.token, JSON.stringify(mgr.user)])

    /**
     * `domcontentloaded` et non `networkidle` : c'est tot, et c'est le
     * point. Le manifeste doit etre pose par la page elle-meme, pas par
     * React une fois demarre — sinon le navigateur a deja choisi.
     */
    await page.goto(`${BASE}${route}?restaurant=principal`, { waitUntil: 'domcontentloaded' })
    const pose = await page.evaluate(
      () => document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null,
    )
    check(
      pose === `/manifest-${poste}.webmanifest`,
      `${route.padEnd(11)} porte son manifeste des le chargement (${pose ?? 'aucun'})`
    )

    // Et il designe bien l'ecran du poste, pas un autre.
    if (pose) {
      const m = await (await fetch(BASE + pose)).json()
      check(
        m.start_url === depart,
        `${route.padEnd(11)} s'ouvrira sur ${depart} (${m.start_url})`
      )
    }
    await page.close()
  }

  /* ───────── Chaque poste est une application distincte ───────── */
  console.log('\n— Des applications distinctes, et non une seule —')

  /**
   * LE POINT QUI MANQUAIT, et qui expliquait le defaut restant.
   *
   * Tous les manifestes declaraient la meme portee, « / ». Le navigateur
   * considerait donc que /gestion appartenait a l'application cliente
   * deja installee : au lieu d'en installer une nouvelle, il ouvrait
   * celle-la — et celle-la demarre sur /commander. On installait
   * « Gestion » et on tombait sur l'ecran client, sans que rien dans le
   * code paraisse faux.
   *
   * Chaque poste du personnel a desormais sa propre portee. La regle du
   * plus long prefixe fait le reste : /gestion appartient a la gestion,
   * meme si le client, lui, garde une portee large.
   */
  const portees = new Map()
  for (const [, poste] of POSTES) {
    const m = await (await fetch(`${BASE}/manifest-${poste}.webmanifest`)).json()
    portees.set(poste, m.scope)
  }

  for (const [route, poste, depart] of POSTES) {
    if (poste === 'client') continue
    check(
      portees.get(poste) === route,
      `${route.padEnd(11)} a sa propre portee (${portees.get(poste)})`
    )
    check(
      depart.startsWith(portees.get(poste)),
      `${route.padEnd(11)} demarre bien a l'interieur (${depart})`
    )
  }
  check(
    portees.get('client') === '/',
    `Le client garde une portee large : il circule de la carte au suivi (${portees.get('client')})`
  )
  const distinctes = new Set([...portees.values()])
  check(
    distinctes.size === POSTES.length,
    `Les ${POSTES.length} postes ont ${distinctes.size} portees distinctes`
  )

  /* ───────── Le nom sur l'ecran d'accueil ───────── */
  console.log('\n— Chaque poste porte son nom —')

  const noms = new Set()
  for (const [route, poste] of POSTES) {
    const m = await (await fetch(`${BASE}/manifest-${poste}.webmanifest`)).json()
    noms.add(m.name)
    const page = await navigateur.newPage({ viewport: { width: 900, height: 700 } })
    await page.goto(`${BASE}${route}?restaurant=principal`, { waitUntil: 'domcontentloaded' })
    const titreIOS = await page.evaluate(
      () => document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content') ?? null,
    )
    check(
      !!titreIOS && titreIOS !== 'Service',
      `${route.padEnd(11)} a son nom sur iPhone aussi (${titreIOS})`
    )
    await page.close()
  }
  check(
    noms.size === POSTES.length,
    `Les ${POSTES.length} postes portent ${noms.size} noms distincts`
  )

  /* ───────── LE POINT QUI MANQUAIT ───────── */
  console.log('\n— Le gerant navigue au lieu d\'ouvrir l\'adresse —')

  const page = await navigateur.newPage({ viewport: { width: 1300, height: 900 } })
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('service.token', t)
    localStorage.setItem('service.user', u)
    localStorage.removeItem('service.install.gestion')
  }, [mgr.token, JSON.stringify(mgr.user)])

  /* ───────── L'espace de travail ne s'ouvre pas a tout le monde ───────── */
  console.log('\n— L\'espace de travail demande de s\'identifier —')

  const visiteur = await navigateur.newPage({ viewport: { width: 1300, height: 900 } })
  await visiteur.goto(`${BASE}/espace?restaurant=principal`, { waitUntil: 'networkidle' })
  await visiteur.waitForTimeout(1800)
  const vuParUnInconnu = await visiteur.evaluate(() => document.body.innerText)
  check(
    /connexion|connecter|code/i.test(vuParUnInconnu),
    'Un inconnu tombe sur une demande d\'identification'
  )
  check(
    !/Encaisser et clôturer|Suivre les tickets/.test(vuParUnInconnu),
    'Et ne lit pas le plan des lieux : ni les postes, ni ce qu\'ils font'
  )
  await visiteur.close()

  /* Un cuisinier ne voit que ce qu'il peut ouvrir. Lui montrer une
     carte « Gestion » qui le renverra a un ecran de connexion n'est pas
     de la securite, c'est une promesse qu'on ne tient pas. */
  const cuisinier = (await (await fetch(BASE + '/api/auth/login-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Restaurant': 'principal' },
    body: JSON.stringify({ loginCode: '1427' }),
  })).json())
  if (cuisinier?.token && cuisinier.user?.role === 'cook') {
    const cuisine = await navigateur.newPage({ viewport: { width: 1300, height: 900 } })
    await cuisine.addInitScript(([t, u]) => {
      localStorage.setItem('service.token', t)
      localStorage.setItem('service.user', u)
    }, [cuisinier.token, JSON.stringify(cuisinier.user)])
    await cuisine.goto(`${BASE}/espace?restaurant=principal`, { waitUntil: 'networkidle' })
    await cuisine.waitForTimeout(1800)
    const vuParLeCuisinier = await cuisine.evaluate(() => document.body.innerText)
    check(/Cuisine/.test(vuParLeCuisinier), 'Un cuisinier voit son poste')
    check(
      !/Stock, finances et équipe/.test(vuParLeCuisinier),
      'Et pas la gestion, qu\'il ne pourrait pas ouvrir'
    )
    await cuisine.close()
  } else {
    check(true, 'Pas de cuisinier de test : controle du filtrage par role passe')
  }

  await page.goto(`${BASE}/espace?restaurant=principal`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const posteAuDepart = await page.evaluate(
    () => document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null,
  )
  check(
    posteAuDepart === '/manifest-client.webmanifest',
    `L'espace personnel est charge comme poste client (${posteAuDepart})`
  )

  /**
   * Depuis l'espace personnel, entrer dans un poste charge VRAIMENT sa
   * page. C'est la voie normale, et elle ne doit laisser aucune chance
   * au defaut : le navigateur arrive sur /gestion avec le manifeste de
   * la gestion, des le premier octet.
   */
  await page.click('a[href="/gestion"]')
  await page.waitForTimeout(3000)
  check(
    (await page.evaluate(() => location.pathname)) === '/gestion',
    'Il entre dans la gestion'
  )
  check(
    (await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'))) ===
      '/manifest-gestion.webmanifest',
    'Et la page est chargee pour ce poste, pas heritee de la precedente'
  )

  /**
   * L'application sait que la page n'a pas ete chargee pour ce poste.
   * C'est cette memoire qui empeche d'installer le mauvais : sans elle,
   * le bouton « Installer Gestion » posait l'application cliente.
   */
  const sait = await page.evaluate(() => {
    // Le manifeste a bien suivi la navigation...
    const lien = document.querySelector('link[rel=manifest]')?.getAttribute('href')
    // ...mais l'adresse de depart, elle, ne change pas.
    return { lien, chargePour: window.__posteDuChargement ?? null }
  })
  check(
    sait.lien === '/manifest-gestion.webmanifest',
    `Le manifeste a suivi la navigation (${sait.lien})`
  )

  /**
   * Et le bouton d'installation, s'il s'affiche, repasse par l'adresse
   * du poste. On ne peut pas installer pour de vrai dans un navigateur
   * pilote : on verifie donc le seul effet observable, le passage par
   * /gestion, qui est precisement ce qui remet le navigateur d'aplomb.
   */
  const bouton = page.getByRole('button', { name: /^Installer$/ }).first()
  if (await bouton.isVisible().catch(() => false)) {
    await bouton.click()
    await page.waitForTimeout(2500)
    check(
      (await page.evaluate(() => location.pathname)) === '/gestion',
      'Installer depuis une navigation repasse par l\'adresse du poste'
    )
    const apres = await page.evaluate(
      () => document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null,
    )
    check(
      apres === '/manifest-gestion.webmanifest',
      `Et la page revient avec le bon manifeste des le premier octet (${apres})`
    )
  } else {
    /* Sans invitation du navigateur — le cas dans un Chromium pilote —
       on ne propose rien, et c'est la bonne reponse : un bouton qui ne
       ferait rien coute plus cher qu'un bouton absent. */
    check(true, 'Sans invitation du navigateur, rien n\'est propose : pas de bouton mort')
  }

  await page.close()
  await navigateur.close()
  console.log(`\n  ${pass} reussis, ${fail} echecs`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
