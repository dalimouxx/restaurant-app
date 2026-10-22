/**
 * Plat de référence pour les séries de tests.
 *
 * Plusieurs séries cherchaient « Pizza Margherita » par son nom, en
 * supposant que la carte de démonstration était en base. Le jour où la
 * carte a été remplacée par un vrai menu, quatre séries sont tombées pour
 * une raison qui n'avait rien à voir avec ce qu'elles testaient.
 *
 * Elles demandent maintenant ce plat ici, et il est créé s'il manque :
 * une série de tests ne doit dépendre que de ce qu'elle met elle-même en
 * place.
 */

const BASE = 'http://localhost:4000/api';

async function appel(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
    'X-Restaurant': 'principal',
      // Une borne, un ecran de salle ou un site nomment l'etablissement
      // dont ils dependent : sans session, rien d'autre ne le dit, et une
      // installation qui heberge plusieurs fastfoods refuse de deviner.
      'X-Restaurant': 'principal',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

/** L'ingrédient que la recette du plat de référence consomme. */
const FROMAGE = 'Fromage de test';

/**
 * Garantit un ingrédient ET un stock suffisant.
 *
 * Vérifier la seule existence ne suffit pas : un ingrédient laissé à zéro
 * par une série précédente rend le plat indisponible, et les séries
 * suivantes échouent sur « plat épuisé » sans rapport avec leur objet.
 */
async function ingredient(nom, patron, token) {
  const stock = (await appel('GET', '/stock', null, token)).data;
  const deja = Array.isArray(stock) ? stock.find((i) => i.name === nom) : null;

  if (!deja) {
    return (await appel('POST', '/stock', { name: nom, ...patron }, token)).data.id;
  }

  const plancher = patron.quantityInStock / 2;
  if (deja.quantityInStock < plancher) {
    await appel('POST', `/stock/${deja.id}/restock`, {
      quantity: patron.quantityInStock - deja.quantityInStock,
      note: 'Reapprovisionnement de la serie de tests',
    }, token);
  }
  return deja.id;
}

/**
 * Renvoie la « Pizza Margherita » du jeu de test, en la créant au besoin,
 * avec la recette que les séries vérifient : 150 g de fromage par pizza.
 */
async function pizzaDeTest(token) {
  // Le stock est garanti AVANT de regarder si le plat existe : un plat
  // deja cree mais dont un ingredient est tombe a zero est « epuise », et
  // la serie echouerait sur un message sans rapport avec son objet.
  const categories = (await appel('GET', '/products/categories')).data;
  const categorie =
    categories.find((c) => c.name === 'Pizzas') ??
    (await appel('POST', '/products/categories', { name: 'Pizzas' }, token)).data;

  const fromage = await ingredient(
    FROMAGE,
    { unit: 'kg', quantityInStock: 50, alertThreshold: 2, costPerUnit: 18 },
    token
  );
  const pate = await ingredient(
    'Pate a pizza',
    { unit: 'piece', quantityInStock: 200, alertThreshold: 20, costPerUnit: 0.8 },
    token
  );
  const sauce = await ingredient(
    'Sauce tomate',
    { unit: 'kg', quantityInStock: 30, alertThreshold: 2, costPerUnit: 4 },
    token
  );

  const existante = (await appel('GET', '/products')).data
    .find((p) => p.name === 'Pizza Margherita');
  if (existante) {
    return (await appel('GET', '/products')).data
      .find((p) => p.name === 'Pizza Margherita');
  }

  await appel('POST', '/products', {
    name: 'Pizza Margherita',
    price: 18,
    description: 'Tomate, mozzarella, basilic',
    categoryId: categorie.id,
    recipe: [
      { ingredientId: pate, quantityNeeded: 1 },
      { ingredientId: fromage, quantityNeeded: 0.15 },
      { ingredientId: sauce, quantityNeeded: 0.1 },
    ],
    options: [
      { kind: 'remove', label: 'Basilic' },
      { kind: 'remove', label: 'Sauce', ingredientId: sauce, quantityDelta: 0.1 },
      { kind: 'add', label: 'Fromage', extraPrice: 2, ingredientId: fromage, quantityDelta: 0.08 },
    ],
  }, token);

  return (await appel('GET', '/products')).data.find((p) => p.name === 'Pizza Margherita');
}

/** Semaine entierement ouverte : les tests ne dependent pas de l'heure. */
function toujoursOuvert() {
  return Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
      d, { open: '00:00', close: '23:59', closed: false },
    ])
  );
}

module.exports = { pizzaDeTest, toujoursOuvert, FROMAGE };
