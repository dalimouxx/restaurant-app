const express = require('express');
const { Product, Category, Ingredient, ProductIngredient } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// --- Liste publique du menu (utilisee par borne, app mobile) ---
router.get('/', async (req, res) => {
  const products = await Product.findAll({
    include: [{ model: Category }],
    order: [['name', 'ASC']],
  });
  res.json(products);
});

router.get('/categories', async (req, res) => {
  const categories = await Category.findAll({ order: [['displayOrder', 'ASC']] });
  res.json(categories);
});

// --- Creation d'un produit (reserve au manager/admin) ---
router.post('/', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const { name, description, price, imageUrl, categoryId, recipe } = req.body;
  // recipe = [{ ingredientId, quantityNeeded }, ...]
  const product = await Product.create({ name, description, price, imageUrl, categoryId });

  if (Array.isArray(recipe)) {
    for (const item of recipe) {
      await ProductIngredient.create({
        productId: product.id,
        ingredientId: item.ingredientId,
        quantityNeeded: item.quantityNeeded,
      });
    }
  }
  res.status(201).json(product);
});

// --- Mise a jour d'un produit ---
router.put('/:id', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
  await product.update(req.body);
  res.json(product);
});

// --- Fonction utilitaire: verifie si un produit peut etre prepare selon le stock actuel ---
async function checkAvailability(productId) {
  const links = await ProductIngredient.findAll({ where: { productId } });
  for (const link of links) {
    const ingredient = await Ingredient.findByPk(link.ingredientId);
    if (!ingredient || ingredient.quantityInStock < link.quantityNeeded) {
      return false;
    }
  }
  return true;
}

module.exports = { router, checkAvailability };
