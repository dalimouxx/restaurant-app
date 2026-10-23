// Le poste laisse ouvert sur un comptoir.
//
// Une tablette de caisse vit allumee et connectee toute la journee.
// Celui qui s'en approche pendant que le caissier est au fond de la
// cuisine peut encaisser, annuler, remettre une commande. Une tablette
// de gestion oubliee sur un bureau, c'est pire : les prix, les chiffres,
// l'equipe.
//
// Deux regles qui se contredisent assez pour meriter d'etre verifiees
// ensemble : le poste se couvre quand personne ne s'en occupe, et la
// cuisine ne se couvre JAMAIS — un ecran qui demande un code au coup de
// feu est un danger, et il est de toute facon derriere le comptoir.

const { createRequire } = require('node:module')
const { chromium } = createRequire('/home/claude/restaurant-app/web/package.json')('playwright')

const BASE = 'http://localhost:4000'
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
      'X-Restaurant': 'principal',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch {}
  return { status: res.status, data }
}

/**
 * On ne fait pas attendre trois minutes a une serie de tests : revenir
 * sur l'onglet verrouille tout de suite, et c'est un vrai chemin — le
 * plus courant, meme. On verrouille l'ecran de la tablette et on la
 * pose ; au retour, on ne sait pas qui revient.
 */
async function poserEtRevenir(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true, get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(900)
}

async function ouvrirPoste(navigateur, route, compte, erreurs) {
  const page = await navigateur.newPage({ viewport: { width: 1300, height: 900 } })
  page.on('pageerror', (e) => erreurs.push(e.message))
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('service.token', t)
    localStorage.setItem('service.user', u)
  }, [compte.token, JSON.stringify(compte.user)])
  await page.goto(`${BASE}${route}?restaurant=principal`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
  return page
}

async function run() {
  console.log('\n===== LE POSTE LAISSE OUVERT =====')

  const caissier = (await api('POST', '/auth/login-code', { loginCode: '1234' })).data
  const cuisinier = (await api('POST', '/auth/login-code', { loginCode: '1427' })).data
  if (!caissier?.token || !cuisinier?.token) {
    console.log('  FAIL - Comptes de test manquants')
    process.exit(1)
  }

  const navigateur = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const erreurs = []

  /* ───────── La caisse se couvre ───────── */
  console.log('\n— La tablette de caisse, posee sur le comptoir —')

  const caisse = await ouvrirPoste(navigateur, '/caisse', caissier, erreurs)
  check(
    !(await caisse.evaluate(() => document.body.innerText)).includes('Poste verrouillé'),
    'Tant qu\'on s\'en sert, rien ne gene'
  )

  await poserEtRevenir(caisse)
  const couvert = await caisse.evaluate(() => document.body.innerText)
  check(/Poste verrouillé/.test(couvert), 'Posee puis reprise, elle demande un code')
  check(
    couvert.includes(caissier.user.fullName),
    `Elle dit qui la tenait (${caissier.user.fullName})`
  )

  /**
   * LE POINT QUI COMPTE : la session n'est pas fermee, elle est
   * couverte. La fermer fermerait la caisse ouverte et la commande a
   * moitie saisie — et le caissier qui revient des toilettes perdrait
   * son travail. Il finirait par trouver le moyen de desactiver le
   * verrou, ce qui est pire que pas de verrou du tout.
   */
  check(
    (await caisse.evaluate(() => localStorage.getItem('service.token'))) !== null,
    'Mais la session tient : la caisse ouverte et la commande en cours sont intactes'
  )

  /**
   * On tape SUR LE VOILE, pas sur l'ecran qu'il couvre. La caisse a son
   * propre pave de chiffres juste derriere : viser la page entiere
   * trouvait les deux. C'est le genre de confusion qui ferait passer un
   * test alors que le voile ne sert a rien.
   */
  const voile = caisse.getByRole('dialog', { name: 'Poste verrouillé' })
  const touche = (n) => voile.getByRole('button', { name: n, exact: true })

  /* Un inconnu ne passe pas. */
  for (const chiffre of ['9', '9', '9', '9']) await touche(chiffre).click()
  await caisse.waitForTimeout(1500)
  check(
    /Poste verrouillé|incorrect/.test(await caisse.evaluate(() => document.body.innerText)),
    'Un code au hasard ne leve rien'
  )

  /**
   * La soupape doit etre la, visible, sur l'ecran de verrouillage.
   *
   * Code oublie, employe parti avec le poste ouvert : sans sortie, la
   * caisse reste couverte. Fermer la session renvoie a l'ecran de
   * connexion, qui demande lui aussi un code — on ne gagne aucun acces
   * par la, on en perd meme un.
   */
  check(
    await voile.getByRole('button', { name: /Fermer la session/ }).isVisible(),
    'Une sortie existe : fermer la session plutot qu\'un poste mort'
  )

  /* Le caissier revient avec le sien. */
  for (let i = 0; i < 4; i++) {
    const effacer = voile.getByRole('button', { name: 'Effacer un chiffre' })
    if (await effacer.count()) await effacer.click()
  }
  for (const chiffre of '1234') await touche(chiffre).click()
  await caisse.waitForTimeout(2200)
  check(
    !(await caisse.evaluate(() => document.body.innerText)).includes('Poste verrouillé'),
    'Son code a lui ouvre, en quatre touches'
  )
  await caisse.close()

  /* ───────── La cuisine ne se couvre jamais ───────── */
  console.log('\n— L\'ecran de cuisine, en plein coup de feu —')

  const cuisine = await ouvrirPoste(navigateur, '/cuisine', cuisinier, erreurs)
  await poserEtRevenir(cuisine)
  check(
    !(await cuisine.evaluate(() => document.body.innerText)).includes('Poste verrouillé'),
    'Elle ne demande jamais de code : un ecran bloque au coup de feu est un danger'
  )
  await cuisine.close()

  /* ───────── Lever le voile n'est pas se connecter ───────── */
  //
  // La route du voile a son propre compteur, et il ralentit au lieu de
  // bloquer. C'est la difference qui decide si le gerant garde le
  // verrou ou le debranche : un ecran de verrouillage se fait taper de
  // travers tous les jours, et un blocage dur laisserait la caisse
  // couverte et inouvrable en plein service.
  console.log('\n— Le voile a son propre compteur —')

  check(
    (await api('POST', '/auth/deverrouiller', { loginCode: '1234', poste: 'caisse' })).status === 401,
    'Sans session ouverte, elle ne sert a rien : ce n\'est pas une porte d\'entree'
  )

  /* Un cuisinier sur la tablette de gestion. */
  const surGestion = await api(
    'POST', '/auth/deverrouiller',
    { loginCode: '1427', poste: 'gestion' },
    (await api('POST', '/auth/login-code', { loginCode: '1234' })).data.token
  )
  check(
    surGestion.status === 403,
    'Un code de cuisinier ne prend pas la main sur la gestion'
  )

  /**
   * Et surtout : marteler le voile ne doit pas fermer la connexion de
   * tout le restaurant. Vingt faux codes, bien au-dela des huit qui
   * verrouillent la page de connexion pendant une minute.
   */
  for (let i = 0; i < 20; i++) {
    await api('POST', '/auth/deverrouiller', { loginCode: '0000', poste: 'caisse' }, caissier.token)
  }
  const apres = await api('POST', '/auth/login-code', { loginCode: '1234' })
  check(
    apres.status === 200,
    'Vingt faux codes sur le voile, et la page de connexion repond toujours'
  )

  /* Mais l'attaque, elle, rampe. */
  const refus = await api('POST', '/auth/deverrouiller', { loginCode: '0000', poste: 'caisse' }, caissier.token)
  check(
    refus.status === 429 && refus.data.retryAfter > 0,
    `Et l'essai suivant doit attendre (${refus.data?.retryAfter ?? '—'} s)`
  )
  check(
    refus.data?.retryAfter >= 8,
    'L\'escalade a bien demarre : chaque code coute desormais dix secondes'
  )
  check(
    (refus.data?.retryAfter ?? 999) <= 10,
    'Sans jamais depasser dix secondes : une caisse inouvrable serait pire'
  )

  /* Et l'attente se purge d'elle-meme : on ne reste pas coince. */
  await new Promise((r) => setTimeout(r, 10500))
  const reprise = await api(
    'POST', '/auth/deverrouiller',
    { loginCode: '1234', poste: 'caisse' }, caissier.token
  )
  check(
    reprise.status === 200,
    'Dix secondes plus tard, le vrai caissier reprend son poste'
  )

  check(erreurs.length === 0, `Aucune erreur JavaScript${erreurs.length ? ' : ' + erreurs[0] : ''}`)

  await navigateur.close()
  console.log(`\n  ${pass} reussis, ${fail} echecs`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
