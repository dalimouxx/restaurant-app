// Parcours complets, joues dans un vrai navigateur.
//
// Pourquoi cette serie existe.
//
// Les autres verifient des pieces : le serveur refuse-t-il la livraison
// quand elle est coupee, l'API cree-t-elle une commande sans compte.
// Toutes passaient au vert pendant que trois defauts bien reels
// dormaient dans l'application — la livraison proposee alors qu'elle
// etait suspendue, une commande scannee a table qui n'atteignait jamais
// la cuisine, un bouton principal qui menait a un mur de connexion.
//
// Aucun ne pouvait etre attrape en testant des pieces, parce qu'aucun
// n'etait dans une piece : ils etaient dans la jointure. Un reglage qui
// change le comportement cote serveur mais pas cote ecran ne produit
// aucune erreur — il produit un client qui perd son temps.
//
// D'ou cette serie, qui ne teste rien d'autre que des trajets : du
// premier geste du client jusqu'a l'ecran de salle, en passant par les
// postes. Elle est lente, et c'est le prix a payer pour attraper ce
// qu'aucun test rapide ne voit.

const { createRequire } = require('node:module');
const { chromium } = createRequire('/home/claude/restaurant-app/web/package.json')('playwright');

const BASE = 'http://localhost:4000';
const REPERE = 'principal';

let pass = 0;
let fail = 0;

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`); }
  else { fail++; console.log(`  FAIL - ${msg}`); }
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Restaurant': REPERE,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* reponse sans corps */ }
  return { status: res.status, data };
}

/** Un ecran de client : telephone, tactile. */
async function telephone(navigateur, erreurs) {
  const page = await navigateur.newPage({
    viewport: { width: 420, height: 900 },
    hasTouch: true,
  });
  page.on('pageerror', (e) => erreurs.push(e.message));
  return page;
}

/** Ajoute le premier plat disponible au panier, variantes comprises. */
async function ajouterUnPlat(page) {
  const bouton = page.getByRole('button', { name: /^Ajouter / }).first();
  await bouton.click();
  await page.waitForTimeout(700);
  const valider = page.getByRole('button', { name: /^Ajouter — / });
  if (await valider.isVisible().catch(() => false)) {
    await valider.click();
    await page.waitForTimeout(500);
  }
}

async function run() {
  console.log('\n===== PARCOURS COMPLETS =====\n');

  const mgr = (await api('POST', '/auth/login', {
    email: 'manager@restaurant.com', password: 'manager123',
  })).data.token;
  const cash = (await api('POST', '/auth/login-code', { loginCode: '1234' })).data.token;

  // Les jours portent leurs cles courtes : ecrites en toutes lettres,
  // elles sont ignorees et le restaurant reste sur ses horaires reels —
  // ce qui, a l'heure ou tournent les tests, le laisse ferme.
  const { toujoursOuvert } = require('./fixture');
  await api('PUT', '/settings', { openingHours: toujoursOuvert() }, mgr);

  const navigateur = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const erreurs = [];

  /* ═════════════════ 1. Le client scanne le code de sa table ═════════════════
     C'est le parcours qui etait creux : la commande partait dans une
     file de caisse que personne ne tenait, et la cuisine ne la voyait
     jamais. On le joue en entier, jusqu'a l'ecran de salle. */
  console.log('— Il scanne le code pose sur sa table —');

  await api('PUT', '/settings', {
    commandesEnLigne: 'cuisine',
    commandeSansCompte: 'oui',
    etapesCuisine: 'deux',
  }, mgr);

  const client = await telephone(navigateur, erreurs);
  // Le code de table ouvre exactement cette adresse.
  await client.goto(`${BASE}/commander?restaurant=${REPERE}`, { waitUntil: 'networkidle' });
  await client.waitForTimeout(1800);

  check(
    /Notre carte/.test(await client.evaluate(() => document.body.innerText)),
    'Le code ouvre la carte du bon etablissement'
  );

  await ajouterUnPlat(client);
  const panier = client.getByRole('button', { name: /Voir le panier/ });
  check(await panier.isVisible().catch(() => false), 'Son plat est au panier');
  await panier.click();
  await client.waitForTimeout(1200);

  // Sans compte : un nom et un telephone, pas d'inscription.
  const nom = client.getByPlaceholder('Prénom ou nom');
  check(
    await nom.isVisible().catch(() => false),
    'On lui demande son nom, pas de creer un compte'
  );
  await nom.fill('Client Table');
  await client.getByPlaceholder('20 123 456').fill('20777888');
  await client.getByRole('button', { name: 'Confirmer' }).click();
  await client.waitForTimeout(2800);

  const surSuivi = await client.evaluate(() => document.body.innerText);
  if (!/Reçue|cuisine|préparation/i.test(surSuivi)) {
    console.log('    --- ce que montre l ecran ---');
    console.log(surSuivi.split('\n').filter(Boolean).slice(0, 6).map((l) => '    ' + l).join('\n'));
  }
  check(
    /Reçue|cuisine|préparation/i.test(surSuivi),
    'Sa commande est passee et son suivi s\'ouvre, sans compte'
  );

  const numero = Number((surSuivi.match(/#(\d{3,})/) || [])[1]);
  check(Number.isFinite(numero), `Elle porte un numero (${numero})`);

  // Le point qui manquait : la cuisine doit la voir.
  const enCuisine = (await api('GET', '/orders/kitchen/queue', null, mgr)).data;
  const ticket = Array.isArray(enCuisine)
    ? enCuisine.find((o) => o.orderNumber === numero)
    : null;
  check(
    !!ticket,
    'LE POINT QUI MANQUAIT : le cuisinier la voit sur son ecran, sans qu\'aucun caissier n\'intervienne'
  );

  check(
    !(await api('GET', '/orders/pending-payment', null, cash)).data
      .some((o) => o.orderNumber === numero),
    'Elle n\'attend pas dans une file de caisse que personne ne tient'
  );

  // La cuisine la termine, la salle l'appelle.
  if (ticket) {
    await api('POST', `/orders/${ticket.id}/kitchen-status`, { status: 'ready' }, mgr);
  }
  const salle = await navigateur.newPage({ viewport: { width: 1400, height: 900 } });
  salle.on('pageerror', (e) => erreurs.push(e.message));
  await salle.goto(`${BASE}/ecran?restaurant=${REPERE}`, { waitUntil: 'networkidle' });
  await salle.waitForTimeout(2200);
  check(
    (await salle.evaluate(() => document.body.innerText)).includes(String(numero)),
    'Son numero s\'affiche sur l\'ecran de salle'
  );
  await salle.close();

  // Et son suivi a suivi.
  await client.reload({ waitUntil: 'networkidle' });
  await client.waitForTimeout(1800);
  check(
    /prête|Prête|récupérer/i.test(await client.evaluate(() => document.body.innerText)),
    'Son telephone lui annonce que c\'est pret'
  );
  await client.close();

  /* ═════════════════ 2. Le meme parcours, avec un comptoir tenu ═════════════════ */
  console.log('\n— Le meme, avec un comptoir tenu —');

  await api('PUT', '/settings', { commandesEnLigne: 'caisse' }, mgr);

  const client2 = await telephone(navigateur, erreurs);
  await client2.goto(`${BASE}/commander?restaurant=${REPERE}`, { waitUntil: 'networkidle' });
  await client2.waitForTimeout(1800);
  await ajouterUnPlat(client2);
  await client2.getByRole('button', { name: /Voir le panier/ }).click();
  await client2.waitForTimeout(1200);
  await client2.getByPlaceholder('Prénom ou nom').fill('Client Comptoir');
  await client2.getByPlaceholder('20 123 456').fill('20999111');
  await client2.getByRole('button', { name: 'Confirmer' }).click();
  await client2.waitForTimeout(2800);

  const numero2 = Number(
    ((await client2.evaluate(() => document.body.innerText)).match(/#(\d{3,})/) || [])[1]
  );
  check(
    (await api('GET', '/orders/pending-payment', null, cash)).data
      .some((o) => o.orderNumber === numero2),
    'Cette fois elle attend bien l\'encaissement'
  );
  const fileCuisine = (await api('GET', '/orders/kitchen/queue', null, mgr)).data || [];
  check(
    !fileCuisine.some((o) => o.orderNumber === numero2),
    'Et la cuisine ne la voit pas encore'
  );

  /* Les numeros repartent a 1 chaque jour : un ticket jamais termine la
     veille porterait le meme numero qu'un ticket du jour, et le
     cuisinier verrait deux fois le meme sans pouvoir les distinguer. */
  const numeros = fileCuisine.map((o) => o.orderNumber);
  const doublons = numeros.filter((n, i) => numeros.indexOf(n) !== i);
  check(
    doublons.length === 0,
    doublons.length === 0
      ? 'Aucun numero en double sur l\'ecran de cuisine'
      : `Numeros en double a l'ecran : ${[...new Set(doublons)].join(', ')}`
  );
  await client2.close();

  /* ═════════════════ 3. La livraison coupee en plein service ═════════════════
     Le defaut : elle restait proposee, et le refus tombait a la toute
     fin, apres que le client avait saisi son adresse. */
  console.log('\n— La livraison est suspendue —');

  await api('PUT', '/settings', { livraisonActive: 'non' }, mgr);

  const client3 = await telephone(navigateur, erreurs);
  await client3.goto(`${BASE}/commander?restaurant=${REPERE}`, { waitUntil: 'networkidle' });
  await client3.waitForTimeout(1800);
  await ajouterUnPlat(client3);
  await client3.getByRole('button', { name: /Voir le panier/ }).click();
  await client3.waitForTimeout(1400);

  const recap = await client3.evaluate(() => document.body.innerText);
  check(
    /suspendue/i.test(recap),
    'LE POINT QUI MANQUAIT : il l\'apprend en ouvrant son panier, pas en confirmant'
  );
  check(
    (await client3.getByRole('button', { name: /Livraison/ }).first().isDisabled()
      .catch(() => false)) === true,
    'Le choix est grise : il ne peut pas s\'engager dans une impasse'
  );
  await client3.close();
  await api('PUT', '/settings', { livraisonActive: 'oui' }, mgr);

  /* ═════════════════ 4. Il ferme son navigateur ═════════════════ */
  console.log('\n— Il ferme son navigateur en pleine commande —');

  const session = await navigateur.newContext({
    viewport: { width: 420, height: 900 }, hasTouch: true,
  });
  let client4 = await session.newPage();
  client4.on('pageerror', (e) => erreurs.push(e.message));
  await client4.goto(`${BASE}/commander?restaurant=${REPERE}`, { waitUntil: 'networkidle' });
  await client4.waitForTimeout(1800);
  await ajouterUnPlat(client4);
  await ajouterUnPlat(client4);
  const avant = (await client4.evaluate(() => document.body.innerText))
    .match(/Voir le panier \((\d+)\)/)?.[1];
  await client4.close();

  client4 = await session.newPage();
  client4.on('pageerror', (e) => erreurs.push(e.message));
  await client4.goto(`${BASE}/commander?restaurant=${REPERE}`, { waitUntil: 'networkidle' });
  await client4.waitForTimeout(2000);
  const apres = (await client4.evaluate(() => document.body.innerText))
    .match(/Voir le panier \((\d+)\)/)?.[1];
  check(
    avant && apres === avant,
    `Il retrouve son panier intact (${avant} avant, ${apres} apres)`
  );
  await client4.close();
  await session.close();

  /* ═════════════════ 5. La vitrine ne montre aucun poste ═════════════════ */
  console.log('\n— Ce que voit quelqu\'un qui arrive sur l\'adresse —');

  const visiteur = await telephone(navigateur, erreurs);
  await visiteur.goto(`${BASE}/?restaurant=${REPERE}`, { waitUntil: 'networkidle' });
  await visiteur.waitForTimeout(2200);
  const vitrine = await visiteur.evaluate(() => document.body.innerText);
  check(/Commander en ligne/.test(vitrine), 'Elle l\'invite a commander');
  check(
    !/\bCaisse\b|\bCuisine\b|Mode borne|\bGestion\b/.test(vitrine),
    'Aucun poste de travail ne lui est annonce'
  );
  check(
    !/Mes commandes/.test(vitrine),
    'LE POINT QUI MANQUAIT : sans compte, on ne lui propose pas un historique qui le mene a un mur'
  );
  await visiteur.close();

  check(erreurs.length === 0, `Aucune erreur JavaScript sur le parcours${erreurs.length ? ' : ' + erreurs[0] : ''}`);

  await navigateur.close();
  console.log(`\n===== ${pass} reussis, ${fail} echecs =====\n`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1); });
