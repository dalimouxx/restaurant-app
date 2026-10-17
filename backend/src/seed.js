require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const {
  sequelize, User, Category, Ingredient, Product, ProductIngredient,
} = require('./models');

async function seed() {
  await sequelize.sync({ force: true }); // ATTENTION: efface et recree toutes les tables

  // --- Utilisateurs de base ---
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  await User.create({
    fullName: 'Super Admin',
    email: 'admin@restaurant.com',
    passwordHash: adminPasswordHash,
    role: 'super_admin',
  });

  const managerPasswordHash = await bcrypt.hash('manager123', 10);
  await User.create({
    fullName: 'Mohamed (Gerant)',
    email: 'manager@restaurant.com',
    passwordHash: managerPasswordHash,
    role: 'manager',
  });

  await User.create({
    fullName: 'Caissier 1',
    role: 'cashier',
    loginCode: '1234',
    qrToken: uuidv4(),
  });

  await User.create({
    fullName: 'Livreur 1',
    role: 'driver',
    phone: '20000000',
    qrToken: uuidv4(),
  });

  // --- Categories ---
  const pizzaCategory = await Category.create({ name: 'Pizzas', displayOrder: 1 });
  const drinksCategory = await Category.create({ name: 'Boissons', displayOrder: 2 });

  // --- Ingredients / stock ---
  const dough = await Ingredient.create({ name: 'Pate a pizza', unit: 'piece', quantityInStock: 50, alertThreshold: 10, costPerUnit: 1.5 });
  const cheese = await Ingredient.create({ name: 'Fromage', unit: 'kg', quantityInStock: 20, alertThreshold: 3, costPerUnit: 12 });
  const tomatoSauce = await Ingredient.create({ name: 'Sauce tomate', unit: 'l', quantityInStock: 15, alertThreshold: 2, costPerUnit: 4 });
  const cola = await Ingredient.create({ name: 'Canette Cola', unit: 'piece', quantityInStock: 100, alertThreshold: 20, costPerUnit: 0.8 });

  // --- Produits ---
  const margherita = await Product.create({
    name: 'Pizza Margherita',
    description: 'Sauce tomate, mozzarella, basilic',
    price: 18,
    categoryId: pizzaCategory.id,
  });
  await ProductIngredient.bulkCreate([
    { productId: margherita.id, ingredientId: dough.id, quantityNeeded: 1 },
    { productId: margherita.id, ingredientId: cheese.id, quantityNeeded: 0.15 },
    { productId: margherita.id, ingredientId: tomatoSauce.id, quantityNeeded: 0.1 },
  ]);

  const colaProduct = await Product.create({
    name: 'Cola 33cl',
    price: 3,
    categoryId: drinksCategory.id,
  });
  await ProductIngredient.create({ productId: colaProduct.id, ingredientId: cola.id, quantityNeeded: 1 });

  console.log('Donnees de demarrage creees avec succes.');
  console.log('Admin: admin@restaurant.com / admin123');
  console.log('Manager: manager@restaurant.com / manager123');
  console.log('Caissier - code: 1234');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
