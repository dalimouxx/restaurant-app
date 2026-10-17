// Verifie specifiquement la regle : "le premier livreur qui accepte, la commande
// disparait pour les autres". On envoie 2 requetes /accept EN PARALLELE (vraie
// concurrence reseau, pas simulee) et on verifie qu'une seule reussit.

const { Client } = require('pg');
const BASE = 'http://localhost:4000/api';

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function run() {
  const db = new Client({
    host: 'localhost', port: 5432, database: 'restaurant_db', user: 'postgres', password: 'postgres',
  });
  await db.connect();

  console.log('\n=== Test de course entre livreurs (acces concurrent reel) ===');

  // 1. Login manager pour preparer la commande
  const managerLogin = await req('POST', '/auth/login', { email: 'manager@restaurant.com', password: 'manager123' });
  const managerToken = managerLogin.data.token;

  const products = await req('GET', '/products');
  const margherita = products.data.find((p) => p.name === 'Pizza Margherita');

  const cashierLogin = await req('POST', '/auth/login-code', { loginCode: '1234' });
  const cashierToken = cashierLogin.data.token;

  // 2. Creer 2 comptes livreurs (via inscription client, puis on force le role en base)
  const suffix = Date.now();
  const d1 = await req('POST', '/auth/register-customer', { fullName: 'Livreur A', phone: '70' + suffix.toString().slice(-6) });
  const d2 = await req('POST', '/auth/register-customer', { fullName: 'Livreur B', phone: '71' + suffix.toString().slice(-6) });

  await db.query(`UPDATE users SET role = 'driver' WHERE id = $1 OR id = $2`, [d1.data.user.id, d2.data.user.id]);

  // Les tokens JWT contiennent deja le role au moment de leur emission (avant la mise a jour SQL),
  // donc on se reconnecte pour obtenir un token a jour avec le role "driver".
  const d1Login = await req('POST', '/auth/register-customer', { fullName: 'x', phone: d1.data.user.phone }).catch(() => null);
  // register-customer refusera (numero deja pris) -> on utilise login classique via un mot de passe
  // Plus simple et fiable : relire le token directement en re-signant via l'API login-qr avec le qrToken,
  // mais qrToken n'est pas defini pour ces comptes. On genere donc un JWT manuellement via jsonwebtoken
  // en reutilisant le meme secret que le serveur (charge depuis le meme .env).
  require('dotenv').config({ path: __dirname + '/../.env' });
  const jwt = require('jsonwebtoken');
  const driver1Token = jwt.sign({ id: d1.data.user.id, role: 'driver', fullName: 'Livreur A' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const driver2Token = jwt.sign({ id: d2.data.user.id, role: 'driver', fullName: 'Livreur B' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // 3. Creer une commande en ligne avec livraison, la payer, et la faire passer "ready"
  const order = await req('POST', '/orders/online', {
    items: [{ productId: margherita.id, quantity: 1 }],
    fulfillmentType: 'delivery',
    deliveryAddress: 'Adresse test course',
    deliveryLat: 35.6, deliveryLng: 10.1,
  }, driver1Token); // on utilise un token "customer-like" ; le role driver n'empeche pas de commander ici

  await req('POST', `/orders/${order.data.id}/pay`, { paymentMethod: 'cash_on_delivery' }, cashierToken);
  await req('POST', `/orders/${order.data.id}/kitchen-status`, { status: 'ready' }, managerToken);

  const available = await req('GET', '/delivery/available', null, driver1Token);
  const ok1 = available.status === 200 && available.data.some((o) => o.id === order.data.id);
  console.log(`  ${ok1 ? 'OK  ' : 'FAIL'} - La commande apparait bien dans la liste des livraisons disponibles`);

  // 4. LES DEUX LIVREURS ACCEPTENT EN MEME TEMPS (vraies requetes HTTP paralleles)
  const [res1, res2] = await Promise.all([
    req('POST', `/delivery/${order.data.id}/accept`, {}, driver1Token),
    req('POST', `/delivery/${order.data.id}/accept`, {}, driver2Token),
  ]);

  const successes = [res1, res2].filter((r) => r.status === 200);
  const conflicts = [res1, res2].filter((r) => r.status === 409);

  console.log(`  ${successes.length === 1 ? 'OK  ' : 'FAIL'} - Exactement un livreur a reussi a accepter (${successes.length}/2)`);
  console.log(`  ${conflicts.length === 1 ? 'OK  ' : 'FAIL'} - L'autre livreur recoit bien une erreur 409 (conflit) (${conflicts.length}/2)`);

  const finalOrder = await req('GET', `/orders/${order.data.id}`, null, managerToken);
  console.log(`  INFO - livreur assigne en base: ${finalOrder.data.driverId}`);

  const allGood = ok1 && successes.length === 1 && conflicts.length === 1;
  console.log(`\n=== RESULTAT COURSE LIVREURS: ${allGood ? 'SUCCES - la regle "premier arrive" est respectee' : 'ECHEC'} ===\n`);

  await db.end();
  process.exit(allGood ? 0 : 1);
}

run().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
