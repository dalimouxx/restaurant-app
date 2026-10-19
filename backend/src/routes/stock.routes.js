const express = require('express');
const {
  Ingredient,
  StockMovement,
  Product,
  ProductIngredient,
  ProductOption,
} = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// --- Liste des ingredients avec statut d'alerte ---
router.get('/', requireAuth, requireRole('manager', 'admin', 'super_admin', 'cook'), async (req, res) => {
  const ingredients = await Ingredient.findAll({ order: [['name', 'ASC']] });
  const withStatus = ingredients.map((i) => ({
    ...i.toJSON(),
    isLow: i.quantityInStock <= i.alertThreshold,
  }));
  res.json(withStatus);
});

// --- Ajout d'un nouvel ingredient ---
router.post('/', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const ingredient = await Ingredient.create(req.body);
  res.status(201).json(ingredient);
});

// --- Reapprovisionnement (entree de stock) ---
router.post('/:id/restock', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const { quantity, note } = req.body;
  const ingredient = await Ingredient.findByPk(req.params.id);
  if (!ingredient) return res.status(404).json({ error: 'Ingredient introuvable.' });

  ingredient.quantityInStock += Number(quantity);
  await ingredient.save();

  await StockMovement.create({
    ingredientId: ingredient.id,
    type: 'restock',
    quantity: Number(quantity),
    note,
  });

  // Reactive automatiquement les produits qui dependent de cet ingredient si le stock est revenu
  await refreshProductsAvailability();

  res.json(ingredient);
});

// --- Ajustement manuel (perte, casse, correction d'inventaire) ---
router.post('/:id/adjust', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const { quantity, note, type } = req.body; // quantity peut etre negatif
  const ingredient = await Ingredient.findByPk(req.params.id);
  if (!ingredient) return res.status(404).json({ error: 'Ingredient introuvable.' });

  ingredient.quantityInStock += Number(quantity);
  await ingredient.save();

  await StockMovement.create({
    ingredientId: ingredient.id,
    type: type || 'adjustment',
    quantity: Number(quantity),
    note,
  });

  await refreshProductsAvailability();
  res.json(ingredient);
});

// --- Historique des mouvements d'un ingredient ---
router.get('/:id/movements', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const movements = await StockMovement.findAll({
    where: { ingredientId: req.params.id },
    order: [['createdAt', 'DESC']],
    limit: 100,
  });
  res.json(movements);
});

/**
 * Quantite de chaque ingredient qu'une ligne de commande consomme.
 *
 * La recette d'abord, puis les choix du client : un « extra fromage »
 * consomme du fromage, un « sans oignon » en rend. Sans cela le benefice
 * net serait fausse.
 */
async function ingredientNeedsFor(item) {
  const needed = new Map();

  const links = await ProductIngredient.findAll({ where: { productId: item.productId } });
  for (const link of links) {
    needed.set(
      link.ingredientId,
      (needed.get(link.ingredientId) || 0) + link.quantityNeeded * item.quantity
    );
  }

  const custom = item.customization || {};
  const chosenIds = [
    ...(custom.removed || []).map((o) => o.id),
    ...(custom.added || []).map((o) => o.id),
  ].filter(Boolean);

  if (chosenIds.length > 0) {
    const options = await ProductOption.findAll({ where: { id: chosenIds } });
    for (const opt of options) {
      if (!opt.ingredientId || !opt.quantityDelta) continue;
      const delta = opt.quantityDelta * item.quantity;
      const current = needed.get(opt.ingredientId) || 0;
      needed.set(
        opt.ingredientId,
        opt.kind === 'add' ? current + delta : Math.max(0, current - delta)
      );
    }
  }

  return needed;
}

// --- Deduit le stock apres une vente, selon la recette de chaque produit ---
async function deductStockForOrderItems(items, orderId) {
  for (const item of items) {
    const needed = await ingredientNeedsFor(item);

    for (const [ingredientId, quantity] of needed) {
      if (quantity <= 0) continue;
      const ingredient = await Ingredient.findByPk(ingredientId);
      if (!ingredient) continue;

      ingredient.quantityInStock = Math.max(0, ingredient.quantityInStock - quantity);
      await ingredient.save();

      await StockMovement.create({
        ingredientId: ingredient.id,
        type: 'sale_deduction',
        quantity: -quantity,
        relatedOrderId: orderId,
      });
    }
  }
  await refreshProductsAvailability();
}

/**
 * Rend au stock ce qu'une commande annulee n'a finalement pas consomme.
 *
 * Le mouvement porte un type a part plutot qu'un simple ajustement : le
 * calcul du benefice net doit pouvoir retrancher ce cout sans le confondre
 * avec une correction faite a la main par le gerant.
 */
async function restoreStockForOrderItems(items, orderId) {
  for (const item of items) {
    const needed = await ingredientNeedsFor(item);

    for (const [ingredientId, quantity] of needed) {
      if (quantity <= 0) continue;
      const ingredient = await Ingredient.findByPk(ingredientId);
      if (!ingredient) continue;

      ingredient.quantityInStock += quantity;
      await ingredient.save();

      await StockMovement.create({
        ingredientId: ingredient.id,
        type: 'cancellation',
        quantity,
        relatedOrderId: orderId,
        note: 'Commande annulee',
      });
    }
  }
  await refreshProductsAvailability();
}

/** Le stock suffit-il a preparer ce plat ? */
async function stockAllows(productId) {
  const links = await ProductIngredient.findAll({ where: { productId } });
  for (const link of links) {
    const ingredient = await Ingredient.findByPk(link.ingredientId);
    if (!ingredient || ingredient.quantityInStock < link.quantityNeeded) return false;
  }
  return true;
}

/**
 * Recalcule la disponibilite d'un plat.
 *
 * Deux causes d'indisponibilite se superposent et ne doivent pas se
 * marcher dessus : le stock qui manque, et la decision du gerant ou de la
 * cuisine. Sans le drapeau manuel, la premiere vente suivante remettrait
 * en vente un plat qu'on vient de declarer epuise, parce que les
 * ingredients, eux, sont encore la.
 */
async function recomputeAvailability(product) {
  const available = !product.manuallyUnavailable && (await stockAllows(product.id));
  if (product.isAvailable !== available) {
    product.isAvailable = available;
    await product.save();
  }
  return product;
}

async function refreshProductsAvailability() {
  const products = await Product.findAll({ where: { isArchived: false } });
  for (const product of products) await recomputeAvailability(product);
}

module.exports = {
  router,
  deductStockForOrderItems,
  restoreStockForOrderItems,
  refreshProductsAvailability,
  recomputeAvailability,
  stockAllows,
};
