// Test de bout en bout : le parcours complet d'une commande en livraison,

const { pizzaDeTest, toujoursOuvert } = require('./fixture');
// du panier client jusqu'au versement de la commission au livreur.

const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });
const jwt = require('jsonwebtoken');

const BASE = 'http://localhost:4000/api';
let pass = 0, fail = 0;

function check(cond, msg) {
  if (cond) { pass++; console.log(`  OK   - ${msg}`); }
  else { fail++; console.log(`  FAIL - ${msg}`); }
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // Comme une borne configuree sur le terrain : sans session, c'est
      // le seul moyen de dire de quel etablissement on depend.
      'X-Restaurant': 'principal',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function run() {
  const db = new Client({ host: 'localhost', port: 5432, database: 'restaurant_db', user: 'postgres', password: 'postgres' });
  await db.connect();

  console.log('\n========== CYCLE DE VIE COMPLET D\'UNE LIVRAISON ==========\n');

  // --- Preparation des acteurs ---
  const admin = await req('POST', '/auth/login', { email: 'admin@restaurant.com', password: 'admin123' });
  const adminToken = admin.data.token;

  const cashier = await req('POST', '/auth/login-code', { loginCode: '1234' });
  const cashierToken = cashier.data.token;

  const manager = await req('POST', '/auth/login', { email: 'manager@restaurant.com', password: 'manager123' });
  const managerToken = manager.data.token;

  // Creation d'un livreur via l'API de gestion des employes
  const suffix = Date.now().toString().slice(-6);
  // Le gerant, et non le super admin : c'est ce que dit le controle
  // juste en dessous, et c'est le geste reel. Un super admin travaille
  // sur l'installation entiere ; il doit nommer l'etablissement.
  const driverRes = await req('POST', '/users', {
    fullName: 'Livreur E2E', role: 'driver', phone: '60' + suffix,
  }, managerToken);
  check(driverRes.status === 201, 'Le manager peut creer un compte livreur');

  const driverQr = driverRes.data.qrToken;
  const driverLogin = await req('POST', '/auth/login-qr', { qrToken: driverQr });
  check(driverLogin.status === 200 && driverLogin.data.user.role === 'driver',
    'Le livreur se connecte en scannant son badge QR');
  const driverToken = driverLogin.data.token;

  // Client
  const customer = await req('POST', '/auth/register-customer', {
    fullName: 'Client E2E', phone: '61' + suffix,
  });
  const customerToken = customer.data.token;

  // --- Etape 1 : le client commande avec livraison ---
  const products = await req('GET', '/products');
  const pizza = await pizzaDeTest(managerToken);


/**
 * Une livraison exige desormais une zone : les frais ne sont plus ecrits
 * dans le code. On ouvre aussi le restaurant, sinon la commande en ligne
 * est refusee hors des heures de service.
 */
  await req('PUT', '/settings', { openingHours: toujoursOuvert() }, managerToken);
  const zoneLivraison = (await req('GET', '/zones')).data[0];

  const order = await req('POST', '/orders/online', {
    items: [{ productId: pizza.id, quantity: 2 }],
    fulfillmentType: 'delivery',
    deliveryAddress: '5 Avenue Habib Bourguiba, Kairouan',
    deliveryLat: 35.6781, deliveryLng: 10.0963,
    deliveryZoneId: zoneLivraison.id,
  }, customerToken);

  check(order.status === 201, 'Le client passe une commande en livraison');
  check(order.data.subtotal === 36, 'Sous-total correct (2 pizzas a 18 DT)');
  // Les frais viennent de la zone choisie, plus d'une constante du code.
  const frais = zoneLivraison.fee;
  check(order.data.deliveryFee === frais, `Frais de livraison appliques (${frais} DT)`);
  check(
    Math.abs(order.data.totalAmount - (order.data.subtotal + frais)) < 0.01,
    'Total = sous-total + frais de la zone'
  );
  const orderId = order.data.id;
  const orderQr = order.data.qrToken;

  // --- Etape 2 : encaissement ---
  const paid = await req('POST', `/orders/${orderId}/pay`, { paymentMethod: 'cash_on_delivery' }, cashierToken);
  check(paid.status === 200 && paid.data.status === 'in_kitchen', 'Paiement enregistre, commande envoyee en cuisine');

  // --- Etape 3 : la cuisine voit le ticket ---
  const queue = await req('GET', '/orders/kitchen/queue', null, managerToken);
  check(queue.data.some((o) => o.id === orderId), 'La commande apparait sur l\'ecran cuisine');

  // --- Etape 4 : preparation puis pret ---
  await req('POST', `/orders/${orderId}/kitchen-status`, { status: 'preparing' }, managerToken);
  const ready = await req('POST', `/orders/${orderId}/kitchen-status`, { status: 'ready' }, managerToken);
  check(ready.data.status === 'awaiting_driver',
    'Une fois prete, la commande passe automatiquement en attente de livreur');

  // --- Etape 5 : le livreur la voit et l'accepte ---
  const available = await req('GET', '/delivery/available', null, driverToken);
  check(
    Array.isArray(available.data) && available.data.some((o) => o.id === orderId),
    'La livraison apparait chez le livreur'
  );

  const accepted = await req('POST', `/delivery/${orderId}/accept`, {}, driverToken);
  check(accepted.status === 200 && accepted.data.status === 'out_for_delivery',
    'Le livreur accepte, la commande passe en cours de livraison');

  // --- Etape 6 : elle disparait pour les autres livreurs ---
  const availableAfter = await req('GET', '/delivery/available', null, driverToken);
  check(!availableAfter.data.some((o) => o.id === orderId),
    'La commande disparait de la liste des livraisons disponibles');

  // --- Etape 7 : mise a jour de la position ---
  const loc = await req('POST', '/delivery/location', { lat: 35.6700, lng: 10.0900 }, driverToken);
  check(loc.status === 200, 'Le livreur transmet sa position pour le suivi client');

  // --- Etape 8 : le client ajoute un pourboire ---
  const tipped = await req('POST', `/delivery/${orderId}/tip`, { tipAmount: 3 }, customerToken);
  check(tipped.data.tipAmount === 3, 'Le client ajoute un pourboire de 3 DT');
  check(
    Math.abs(tipped.data.totalAmount - (tipped.data.subtotal + frais + 3)) < 0.01,
    'Le total est recalcule avec le pourboire'
  );

  // --- Etape 9 : mauvais QR refuse ---
  const badQr = await req('POST', `/delivery/${orderId}/confirm-delivery`, { qrToken: 'faux-token' }, driverToken);
  check(badQr.status === 400, 'Un QR code invalide est refuse (securite)');

  // --- Etape 10 : bon QR accepte ---
  const confirmed = await req('POST', `/delivery/${orderId}/confirm-delivery`, { qrToken: orderQr }, driverToken);
  check(confirmed.status === 200 && confirmed.data.status === 'delivered',
    'Le scan du bon QR confirme la livraison');

  // --- Etape 11 : commission du livreur ---
  const stats = await req('GET', '/delivery/my-stats', null, driverToken);
  const expectedEarning = frais * 0.7 + 3; // 70 % des frais de la zone + pourboire
  check(Math.abs(stats.data.totalDriverEarnings - expectedEarning) < 0.01,
    `Commission correcte : 70% de 7 DT + 3 DT de pourboire = ${expectedEarning.toFixed(2)} DT (recu: ${stats.data.totalDriverEarnings.toFixed(2)})`);
  check(stats.data.deliveriesCount === 1, 'Une livraison comptabilisee dans l\'historique');
  check(
    Math.abs(stats.data.totalCollected - tipped.data.totalAmount) < 0.01,
    'Montant total encaisse par le livreur'
  );

  // --- Etape 12 : le client suit sa commande ---
  const tracked = await req('GET', `/orders/${orderId}`, null, customerToken);
  check(tracked.data.status === 'delivered', 'Le client voit sa commande comme livree');

  console.log(`\n========== RESULTAT : ${pass} reussis, ${fail} echecs ==========\n`);

  await db.end();
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error('Erreur:', e); process.exit(1); });
