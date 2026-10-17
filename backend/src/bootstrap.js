const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const {
  User,
  Category,
  Product,
  Ingredient,
  ProductIngredient,
} = require('./models');

/**
 * Amorçage de production — sûr à exécuter à chaque démarrage.
 *
 * Contrairement à `seed.js` (qui efface tout et ne sert qu'en développement),
 * ce script ne crée le premier compte administrateur que si la table des
 * utilisateurs est vide. Il ne touche jamais aux données existantes.
 *
 * Le mot de passe vient des variables d'environnement : aucun identifiant
 * par défaut ne doit exister sur une instance accessible publiquement.
 */
async function bootstrapAdmin() {
  const count = await User.count();
  if (count > 0) return { created: false, reason: 'des comptes existent déjà' };

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME || 'Administrateur';

  if (!email || !password) {
    return {
      created: false,
      reason:
        'base vide, mais ADMIN_EMAIL et ADMIN_PASSWORD ne sont pas définis',
    };
  }

  if (password.length < 10) {
    return {
      created: false,
      reason: 'ADMIN_PASSWORD doit faire au moins 10 caractères',
    };
  }

  await User.create({
    fullName,
    email: email.toLowerCase().trim(),
    passwordHash: await bcrypt.hash(password, 12),
    role: 'super_admin',
    qrToken: uuidv4(),
  });

  return { created: true, email };
}

/**
 * Menu de démonstration — uniquement si aucun produit n'existe et si
 * SEED_DEMO vaut 'true'. Permet de tester un déploiement neuf sans saisir
 * une carte à la main. À désactiver avant d'entrer en service réel.
 *
 * N'écrase jamais rien : dès qu'un produit existe, la fonction s'arrête.
 */
async function bootstrapDemoMenu() {
  if (process.env.SEED_DEMO !== 'true') {
    return { created: false, reason: 'SEED_DEMO non activé' };
  }

  const existing = await Product.count();
  if (existing > 0) {
    return { created: false, reason: 'la carte contient déjà des produits' };
  }

  const pizzas = await Category.create({ name: 'Pizzas', displayOrder: 1 });
  const sandwichs = await Category.create({ name: 'Sandwichs', displayOrder: 2 });
  const boissons = await Category.create({ name: 'Boissons', displayOrder: 3 });

  const pate = await Ingredient.create({
    name: 'Pâte à pizza', unit: 'piece',
    quantityInStock: 60, alertThreshold: 12, costPerUnit: 1.5,
  });
  const fromage = await Ingredient.create({
    name: 'Fromage râpé', unit: 'kg',
    quantityInStock: 20, alertThreshold: 3, costPerUnit: 12,
  });
  const sauce = await Ingredient.create({
    name: 'Sauce tomate', unit: 'l',
    quantityInStock: 15, alertThreshold: 2, costPerUnit: 4,
  });
  const thon = await Ingredient.create({
    name: 'Thon', unit: 'kg',
    quantityInStock: 8, alertThreshold: 2, costPerUnit: 22,
  });
  const baguette = await Ingredient.create({
    name: 'Baguette', unit: 'piece',
    quantityInStock: 40, alertThreshold: 10, costPerUnit: 0.6,
  });
  const cola = await Ingredient.create({
    name: 'Canette cola', unit: 'piece',
    quantityInStock: 120, alertThreshold: 24, costPerUnit: 0.8,
  });
  const eau = await Ingredient.create({
    name: 'Bouteille d eau 50 cl', unit: 'piece',
    quantityInStock: 100, alertThreshold: 20, costPerUnit: 0.4,
  });

  async function addProduct(data, recipe) {
    const product = await Product.create(data);
    await ProductIngredient.bulkCreate(
      recipe.map((r) => ({
        productId: product.id,
        ingredientId: r.id,
        quantityNeeded: r.qty,
      }))
    );
    return product;
  }

  await addProduct(
    {
      name: 'Pizza Margherita',
      description: 'Sauce tomate, fromage, basilic',
      price: 18,
      categoryId: pizzas.id,
    },
    [
      { id: pate.id, qty: 1 },
      { id: fromage.id, qty: 0.15 },
      { id: sauce.id, qty: 0.1 },
    ]
  );

  await addProduct(
    {
      name: 'Pizza Thon',
      description: 'Sauce tomate, fromage, thon, olives',
      price: 22,
      categoryId: pizzas.id,
    },
    [
      { id: pate.id, qty: 1 },
      { id: fromage.id, qty: 0.15 },
      { id: sauce.id, qty: 0.1 },
      { id: thon.id, qty: 0.08 },
    ]
  );

  await addProduct(
    {
      name: 'Sandwich thon',
      description: 'Baguette, thon, légumes',
      price: 7,
      categoryId: sandwichs.id,
    },
    [
      { id: baguette.id, qty: 1 },
      { id: thon.id, qty: 0.1 },
    ]
  );

  await addProduct(
    { name: 'Cola 33 cl', price: 3, categoryId: boissons.id },
    [{ id: cola.id, qty: 1 }]
  );

  await addProduct(
    { name: 'Eau 50 cl', price: 1.5, categoryId: boissons.id },
    [{ id: eau.id, qty: 1 }]
  );

  return { created: true, products: 5, categories: 3, ingredients: 7 };
}

module.exports = { bootstrapAdmin, bootstrapDemoMenu };
