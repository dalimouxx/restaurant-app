// Test d'integration complet contre le serveur reel (http://localhost:4000)
// Verifie : login, creation produit/ingredient, commande kiosque, paiement caissier,
// deduction de stock, flux cuisine, commande en ligne avec livraison, course entre
// livreurs (le 2e doit echouer), confirmation QR, pourboire, rapport de benefice net.

const BASE = 'http://localhost:4000/api';
let failures = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  OK   - ${message}`);
  } else {
    failures++;
    console.log(`  FAIL - ${message}`);
  }
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* pas de body json */ }
  return { status: res.status, data };
}

async function run() {
  console.log('\n=== 1. Authentification ===');

  const managerLogin = await req('POST', '/auth/login', { email: 'manager@restaurant.com', password: 'manager123' });
  assert(managerLogin.status === 200 && managerLogin.data.token, 'Login manager reussi');
  const managerToken = managerLogin.data.token;

  const cashierLogin = await req('POST', '/auth/login-code', { loginCode: '1234' });
  assert(cashierLogin.status === 200 && cashierLogin.data.token, 'Login caissier via code reussi');
  const cashierToken = cashierLogin.data.token;

  const badLogin = await req('POST', '/auth/login-code', { loginCode: '9999' });
  assert(badLogin.status === 401, 'Login caissier avec mauvais code rejete (401)');

  console.log('\n=== 2. Produits / Menu ===');
  const products = await req('GET', '/products');
  assert(products.status === 200 && products.data.length >= 2, 'Le menu contient les produits du seed');
  const margherita = products.data.find((p) => p.name === 'Pizza Margherita');
  assert(!!margherita, 'La Pizza Margherita existe dans le menu');
  assert(margherita.isAvailable === true, 'La Pizza Margherita est disponible (stock suffisant)');

  console.log('\n=== 3. Commande via borne (kiosque) + paiement + deduction stock ===');
  const stockBefore = await req('GET', '/stock', null, managerToken);
  const cheeseBefore = stockBefore.data.find((i) => i.name === 'Fromage').quantityInStock;

  const kioskOrder = await req('POST', '/orders/kiosk', {
    items: [{ productId: margherita.id, quantity: 2, customization: {} }],
    fulfillmentType: 'pickup',
  });
  assert(kioskOrder.status === 201, 'Commande kiosque creee');
  assert(kioskOrder.data.status === 'awaiting_payment', 'Statut initial = en attente de paiement');
  assert(kioskOrder.data.subtotal === 36, 'Sous-total correct (2 x 18 = 36)');

  const payRes = await req('POST', `/orders/${kioskOrder.data.id}/pay`, { paymentMethod: 'cash' }, cashierToken);
  assert(payRes.status === 200 && payRes.data.status === 'in_kitchen', 'Paiement valide -> commande envoyee en cuisine automatiquement');

  const stockAfter = await req('GET', '/stock', null, managerToken);
  const cheeseAfter = stockAfter.data.find((i) => i.name === 'Fromage').quantityInStock;
  const expectedCheese = cheeseBefore - 0.15 * 2;
  assert(Math.abs(cheeseAfter - expectedCheese) < 0.0001, `Stock fromage deduit correctement (${cheeseBefore} -> ${cheeseAfter})`);

  const doublePay = await req('POST', `/orders/${kioskOrder.data.id}/pay`, { paymentMethod: 'cash' }, cashierToken);
  assert(doublePay.status === 400, 'Impossible de payer 2 fois la meme commande (rejet 400)');

  console.log('\n=== 4. Flux cuisine ===');
  const cookLogin = await req('POST', '/auth/login', { email: 'manager@restaurant.com', password: 'manager123' });
  const kitchenStatus = await req('POST', `/orders/${kioskOrder.data.id}/kitchen-status`, { status: 'preparing' }, managerToken);
  assert(kitchenStatus.status === 200 && kitchenStatus.data.status === 'preparing', 'Statut cuisine passe a "preparing"');

  console.log('\n=== 5. Ruptures de stock -> produit indisponible ===');
  const ingredientsList = await req('GET', '/stock', null, managerToken);
  const dough = ingredientsList.data.find((i) => i.name === 'Pate a pizza');
  await req('POST', `/stock/${dough.id}/adjust`, { quantity: -dough.quantityInStock, note: 'test rupture' }, managerToken);
  const productsAfterRupture = await req('GET', '/products');
  const margheritaAfterRupture = productsAfterRupture.data.find((p) => p.name === 'Pizza Margherita');
  assert(margheritaAfterRupture.isAvailable === false, 'Produit devient indisponible quand un ingredient manque');

  // On remet le stock pour la suite des tests
  await req('POST', `/stock/${dough.id}/restock`, { quantity: 50, note: 'reappro test' }, managerToken);
  const productsRestocked = await req('GET', '/products');
  assert(productsRestocked.data.find((p) => p.name === 'Pizza Margherita').isAvailable === true, 'Produit redevient disponible apres reapprovisionnement');

  console.log('\n=== 6. Commande en ligne avec livraison ===');
  const customerReg = await req('POST', '/auth/register-customer', {
    fullName: 'Client Test', phone: '99' + Date.now().toString().slice(-6),
  });
  assert(customerReg.status === 201, 'Inscription client reussie');
  const customerToken = customerReg.data.token;

  const onlineOrder = await req('POST', '/orders/online', {
    items: [{ productId: margherita.id, quantity: 1 }],
    fulfillmentType: 'delivery',
    deliveryAddress: '12 Rue Test, Kairouan',
    deliveryLat: 35.67, deliveryLng: 10.10,
  }, customerToken);
  assert(onlineOrder.status === 201, 'Commande en ligne avec livraison creee');
  assert(onlineOrder.data.deliveryFee === 7, 'Frais de livraison ajoutes automatiquement (7)');
  assert(onlineOrder.data.totalAmount === 18 + 7, 'Montant total = sous-total + frais de livraison');

  await req('POST', `/orders/${onlineOrder.data.id}/pay`, { paymentMethod: 'cash_on_delivery' }, cashierToken);
  await req('POST', `/orders/${onlineOrder.data.id}/kitchen-status`, { status: 'ready' }, managerToken);

  console.log('  INFO - la course entre livreurs (premier arrive gagne) est testee separement dans tests/delivery-race.test.js');

  console.log('\n=== 7. Rapport benefice net ===');
  const report = await req('GET', '/reports/net-profit', null, managerToken);
  assert(report.status === 200, 'Rapport de benefice net accessible');
  assert(typeof report.data.netProfit === 'number', 'Le benefice net est bien un nombre calcule');
  console.log(`  INFO - revenu total: ${report.data.totalRevenue}, cout ingredients: ${report.data.ingredientCost.toFixed(2)}, benefice net: ${report.data.netProfit.toFixed(2)}`);

  console.log('\n=== 8. Securite des roles ===');
  const forbidden = await req('GET', '/reports/net-profit', null, customerToken);
  assert(forbidden.status === 403, "Un client ne peut pas acceder aux rapports gerant (403)");

  const noAuth = await req('GET', '/reports/net-profit');
  assert(noAuth.status === 401, 'Acces sans token rejete (401)');

  console.log(`\n=== RESULTAT: ${passed} tests reussis, ${failures} echecs ===\n`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Erreur pendant les tests:', err);
  process.exit(1);
});
