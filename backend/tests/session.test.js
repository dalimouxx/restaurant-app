// La session d'un employe, du matin au dernier client.
//
// Un jeton vit douze heures. Un fastfood ouvert de 11 h a 1 h du matin a
// donc un caissier connecte a 11 h dont la session meurt a 23 h — au coup
// de feu. Et elle mourait mal : le stockage etait vide mais l'ecran
// restait visuellement connecte, chaque appel echouait, et rien ne disait
// quoi faire. Une caisse ouverte, une commande a moitie saisie, et un
// caissier qui redemarre la tablette en plein service.
//
// Deux regles, donc, et elles se contredisent assez pour meriter d'etre
// verifiees ensemble : la session se prolonge tant qu'on travaille, et
// elle se termine franchement quand elle est vraiment finie.

const jwt = require('jsonwebtoken')
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

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
  return { status: res.status, data, jetonFrais: res.headers.get('X-Jeton-Renouvele') }
}

/** Fabrique un jeton d'un age donne, sans attendre douze heures. */
function jetonAge(payload, dureeS, ageS) {
  const maintenant = Math.floor(Date.now() / 1000)
  return jwt.sign(
    { ...payload, iat: maintenant - ageS, exp: maintenant - ageS + dureeS },
    process.env.JWT_SECRET,
  )
}

async function run() {
  console.log('\n===== LA SESSION D\'UNE JOURNEE DE TRAVAIL =====')

  const connexion = await req('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })
  const frais = connexion.data.token
  const moi = jwt.decode(frais)

  console.log('\n— Un jeton tout neuf —')
  const jeune = await req('GET', '/users', null, frais)
  check(jeune.status === 200, 'Il ouvre les portes')
  check(
    !jeune.jetonFrais,
    'Et il ne se renouvelle pas pour rien : renouveler a chaque appel userait le serveur sans rien gagner'
  )

  console.log('\n— Le meme, au coup de feu —')
  /* Sept heures sur douze : passe la moitie de sa vie, il doit se
     renouveler de lui-meme. */
  const use = jetonAge(
    { id: moi.id, role: moi.role, restaurantId: moi.restaurantId },
    12 * 3600,
    7 * 3600,
  )
  const renouvele = await req('GET', '/users', null, use)
  check(renouvele.status === 200, 'Il travaille encore')
  check(!!renouvele.jetonFrais, 'Et le serveur lui en rend un neuf, sans qu\'il demande')

  if (renouvele.jetonFrais) {
    const neuf = jwt.decode(renouvele.jetonFrais)
    check(neuf.id === moi.id && neuf.role === moi.role, 'Le neuf designe bien la meme personne')
    check(
      (neuf.restaurantId ?? null) === (moi.restaurantId ?? null),
      'Et le meme etablissement : une session qui change de maison serait pire que pas de session'
    )
    check(
      neuf.exp > Math.floor(Date.now() / 1000) + 11 * 3600,
      'Il repart pour une journee entiere'
    )
    const suite = await req('GET', '/users', null, renouvele.jetonFrais)
    check(suite.status === 200, 'Et il fonctionne tout de suite')
  }

  console.log('\n— Une tablette oubliee sur un comptoir —')
  /* La prolongation suit l'activite, pas l'horloge : sans requete, rien
     ne se prolonge. Une tablette volee le soir est hors service au
     matin, exactement comme avant. */
  const perime = jetonAge(
    { id: moi.id, role: moi.role, restaurantId: moi.restaurantId },
    12 * 3600,
    13 * 3600,
  )
  const refus = await req('GET', '/users', null, perime)
  check(refus.status === 401, 'Un jeton depasse est refuse, net')
  check(
    !refus.jetonFrais,
    'Et surtout pas renouvele : une session morte ne doit jamais ressusciter'
  )
  check(
    /expir|invalide/i.test(refus.data?.error ?? ''),
    `Le refus se lit : « ${refus.data?.error ?? '—'} »`
  )

  console.log(`\n  ${pass} reussis, ${fail} echecs`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
