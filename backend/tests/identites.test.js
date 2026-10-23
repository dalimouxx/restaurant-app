// Les identites qui traversent les etablissements : le code a quatre
// chiffres d'un employe, et le numero de telephone d'un client.
//
// Les deux colonnes portent une contrainte d'unicite globale, heritee de
// l'epoque ou il n'y avait qu'un restaurant. Les verifications, elles,
// passaient par le cloisonnement et ne voyaient que la maison. Un code
// deja pris chez le voisin franchissait donc le controle, puis se
// heurtait a l'index au moment de l'insertion : le gerant recevait une
// erreur de base de donnees a la place d'une phrase, et n'avait aucun
// moyen de deviner quoi faire. L'ecart ne se voit qu'avec deux
// etablissements ouverts — d'ou cette serie.
//
// Elle verifie aussi les deux regles qui n'ont pas de place ailleurs :
// une session atterrit toujours sur la maison de l'employe et jamais sur
// celle de la tablette, et un compte client n'appartient a aucune maison
// — dans une chaine, la meme personne commande chez plusieurs fastfoods.

console.log('\n===== IDENTITES ENTRE ETABLISSEMENTS =====')

const BASE = 'http://localhost:4000/api'
let ok = 0, ko = 0
const check = (c, m) => { c ? (ok++, console.log(`  OK   - ${m}`)) : (ko++, console.log(`  FAIL - ${m}`)) }

const req = async (m, p, b, t, entetes = {}) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...entetes },
    body: b ? JSON.stringify(b) : undefined,
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, data }
}

const marque = Date.now().toString().slice(-6)

const admin = (await req('POST', '/auth/login', {
  email: 'admin@restaurant.com', password: 'admin123',
})).data.token

const liste = (await req('GET', '/restaurants', null, admin)).data
const a = liste.find((r) => r.slug === 'principal')
let b = liste.find((r) => r.slug === 'fastfood-test-b')
if (!b) {
  b = (await req('POST', '/restaurants', {
    name: 'Fastfood B (serie de tests)', slug: 'fastfood-test-b',
  }, admin)).data
}
await req('PATCH', `/restaurants/${b.id}`, { isActive: true }, admin)

/* ───────── Le code a quatre chiffres d'un employe ───────── */
console.log('\n— Le code personnel traverse les etablissements —')

// Un code libre : on en cherche un que personne n'a.
let code = null
for (let n = 7100; n < 7400 && !code; n++) {
  const essai = await req('POST', '/users', {
    fullName: `Caissier A ${marque}`, role: 'cashier',
    loginCode: String(n), restaurantId: a.id,
  }, admin)
  if (essai.status === 201) code = String(n)
}
check(code !== null, `Un caissier de A prend un code libre (${code})`)

const chezB = await req('POST', '/users', {
  fullName: `Caissier B ${marque}`, role: 'cashier',
  loginCode: code, restaurantId: b.id,
}, admin)
check(
  chezB.status === 409,
  `Le meme code refuse chez B, avec une phrase (recu ${chezB.status} : ${chezB.data?.error ?? '—'})`
)

/**
 * La connexion cherche dans toute l'installation, et c'est voulu : au
 * moment ou quelqu'un tape son code, on ne sait pas encore ou il
 * travaille. Ce qui compte n'est donc pas qu'il soit refuse sur la
 * tablette du voisin, mais qu'il y retrouve SA maison — et jamais celle
 * sur laquelle la tablette est reglee.
 */
const entree = await req('POST', '/auth/login-code', { loginCode: code }, null, {
  'X-Restaurant': 'fastfood-test-b',
})
check(entree.status === 200, 'Un employe de A tape son code sur la tablette de B')

const vu = await req('GET', '/settings', null, entree.data?.token, {
  'X-Restaurant': 'fastfood-test-b',
})
check(
  vu.data?.etablissement?.id === a.id,
  `Et c'est sa maison qu'il voit, pas celle de la tablette (${vu.data?.etablissement?.name ?? '—'})`
)

const sienne = await req('POST', '/auth/login-code', { loginCode: code }, null, {
  'X-Restaurant': 'principal',
})
check(sienne.status === 200, 'Il rentre evidemment chez lui aussi')

/* ───────── Le numero de telephone d'un client ───────── */
console.log('\n— Le meme client commande dans les deux maisons —')

const tel = `2${marque}0`
const chezA = await req('POST', '/auth/register-customer', {
  fullName: `Client ${marque}`, phone: tel, password: 'secret123',
}, null, { 'X-Restaurant': 'principal' })
check(chezA.status === 201, 'Il se cree un compte chez A')

const encore = await req('POST', '/auth/register-customer', {
  fullName: `Client ${marque}`, phone: tel, password: 'secret123',
}, null, { 'X-Restaurant': 'fastfood-test-b' })
check(
  encore.status === 409,
  `Le meme numero chez B : refus lisible, pas une erreur de base (recu ${encore.status} : ${encore.data?.error ?? '—'})`
)

/**
 * Un compte client n'appartient a aucun etablissement : dans une chaine,
 * la meme personne commande chez plusieurs fastfoods. On verifie donc
 * qu'il est bien cree sans maison, faute de quoi il deviendrait invisible
 * d'un restaurant a l'autre.
 */
const moi = await req(
  'GET',
  `/orders/customer/${chezA.data?.user?.id}`,
  null,
  chezA.data?.token,
  { 'X-Restaurant': 'fastfood-test-b' },
)
check(
  moi.status === 200,
  `Son compte le reconnait aussi chez B : c'est la meme personne (recu ${moi.status})`
)

console.log(`\n===== ${ok} reussis, ${ko} echecs =====`)
process.exit(ko > 0 ? 1 : 0)
