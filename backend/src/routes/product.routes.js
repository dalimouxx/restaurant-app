const express = require('express');
const {
  Product,
  Category,
  Ingredient,
  ProductIngredient,
  ProductOption,
} = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// --- Liste publique du menu, avec les choix predefinis de chaque plat ---
router.get('/', async (req, res) => {
  const products = await Product.findAll({
    include: [
      { model: Category },
      {
        model: ProductOption,
        as: 'options',
        where: { isActive: true },
        required: false,
        attributes: ['id', 'kind', 'label', 'extraPrice', 'displayOrder'],
      },
    ],
    order: [
      ['name', 'ASC'],
      [{ model: ProductOption, as: 'options' }, 'displayOrder', 'ASC'],
    ],
  });
  res.json(products);
});

// --- Choix predefinis d'un produit (retraits et ajouts) ---
router.get('/:id/options', async (req, res) => {
  const options = await ProductOption.findAll({
    where: { productId: req.params.id, isActive: true },
    order: [['kind', 'ASC'], ['displayOrder', 'ASC']],
  });
  res.json(options);
});

// --- Ajout d'un choix a un produit (gerant) ---
router.post(
  '/:id/options',
  requireAuth,
  requireRole('manager', 'admin', 'super_admin'),
  async (req, res) => {
    const { kind, label, extraPrice, ingredientId, quantityDelta, displayOrder } = req.body;

    if (!['remove', 'add'].includes(kind)) {
      return res.status(400).json({ error: 'Type de choix invalide.' });
    }
    if (!label || label.trim().length < 2) {
      return res.status(400).json({ error: 'Intitule du choix requis.' });
    }
    // Un retrait ne se facture pas : c'est ce que le client ne prend pas.
    const price = kind === 'remove' ? 0 : Number(extraPrice) || 0;

    const option = await ProductOption.create({
      productId: req.params.id,
      kind,
      label: label.trim(),
      extraPrice: price,
      ingredientId: ingredientId || null,
      quantityDelta: Number(quantityDelta) || 0,
      displayOrder: Number(displayOrder) || 0,
    });
    res.status(201).json(option);
  }
);

// --- Retrait d'un choix ---
router.delete(
  '/options/:optionId',
  requireAuth,
  requireRole('manager', 'admin', 'super_admin'),
  async (req, res) => {
    const option = await ProductOption.findByPk(req.params.optionId);
    if (!option) return res.status(404).json({ error: 'Choix introuvable.' });
    // Desactive plutot que supprime : les commandes passees y font reference.
    option.isActive = false;
    await option.save();
    res.json({ ok: true });
  }
);

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
