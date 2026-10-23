// Une mise a jour pendant qu'un client commande.
//
// Chaque deploiement renomme les fichiers de l'application — c'est ce qui
// permet au navigateur de les garder en cache sans jamais servir une
// version perimee. Mais un client qui avait deja la page ouverte garde
// l'ancienne liste de noms : au moment ou il touche « Suivre », le
// fichier demande n'existe plus. Ecran blanc, au milieu d'une commande.
//
// Ce n'est pas une hypothese : la serie de parcours l'a subi pour de
// vrai, le jour ou l'application a ete reconstruite pendant qu'elle
// tournait. Cinq controles sont tombes d'un coup, avec « Failed to fetch
// dynamically imported module » pour seule explication.

import { createRequire } from 'node:module'
const { chromium } = createRequire('/home/claude/restaurant-app/web/package.json')('playwright')

const BASE = 'http://localhost:4000'
let ok = 0, ko = 0
const check = (c, m) => { c ? (ok++, console.log(`  OK   - ${m}`)) : (ko++, console.log(`  FAIL - ${m}`)) }

const api = async (m, p, b) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', 'X-Restaurant': 'principal' },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => null) }
}

console.log('\n===== UNE MISE A JOUR EN PLEIN SERVICE =====\n')

const produits = (await api('GET', '/products')).data
const plat = produits.find((p) => p.isAvailable)

const commande = await api('POST', '/orders/kiosk', {
  items: [{ productId: plat.id, quantity: 1, optionIds: [] }],
  fulfillmentType: 'pickup',
})
check(commande.status === 201, `Un client passe commande (#${commande.data?.orderNumber})`)

const navigateur = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
const page = await navigateur.newPage({ viewport: { width: 420, height: 900 }, hasTouch: true })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))

/**
 * On simule le deploiement de la facon la plus fidele : le fichier que
 * la page va chercher a disparu du serveur. Une seule fois — apres le
 * rechargement, le nouveau serveur repond normalement.
 */
let refus = 0
await page.route('**/assets/TrackingScreen-*.js', (route) => {
  if (refus === 0) {
    refus++
    return route.fulfill({ status: 404, body: 'Not Found' })
  }
  return route.continue()
})

let rechargements = 0
page.on('load', () => { rechargements++ })

await page.goto(`${BASE}/commande/${commande.data.id}?restaurant=principal`, {
  waitUntil: 'networkidle',
})
// Le temps que le rechargement parte et que la page revienne.
await page.waitForTimeout(4000)

check(refus === 1, 'Le fichier attendu par sa page a bien disparu, une fois')
check(rechargements >= 2, `La page s'est rechargee d'elle-meme (${rechargements} chargements)`)

const texte = await page.evaluate(() => document.body.innerText)
check(
  texte.includes(String(commande.data.orderNumber).padStart(3, '0')),
  'Et le client retrouve son suivi, au lieu d\'un ecran blanc'
)
check(
  texte.trim().length > 40,
  `L'ecran n'est pas vide (${texte.trim().length} caracteres)`
)

/**
 * Une seule fois, et c'est tout aussi important : si le fichier reste
 * introuvable — reseau coupe, serveur a terre — une boucle de
 * rechargements rendrait le telephone inutilisable sans rien reparer.
 */
const page2 = await navigateur.newPage({ viewport: { width: 420, height: 900 } })
let refusContinus = 0
await page2.route('**/assets/TrackingScreen-*.js', (route) => {
  refusContinus++
  return route.fulfill({ status: 404, body: 'Not Found' })
})
let chargements2 = 0
page2.on('load', () => { chargements2++ })
await page2.goto(`${BASE}/commande/${commande.data.id}?restaurant=principal`, {
  waitUntil: 'domcontentloaded',
})
await page2.waitForTimeout(6000)
check(
  chargements2 <= 2,
  `Un echec persistant ne boucle pas : ${chargements2} chargements pour ${refusContinus} refus`
)

await navigateur.close()
console.log(`\n===== ${ok} reussis, ${ko} echecs =====`)
process.exit(ko > 0 ? 1 : 0)
