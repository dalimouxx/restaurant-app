const express = require('express');
const {
  Ingredient,
  StockMovement,
  Product,
  ProductIngredient,
  ProductOption,
} = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const audit = require('../audit');

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
 * Motifs de perte, fermes.
 *
 * Un ingredient sort du stock sans vente : casse, brule, perime, repas du
 * personnel. Sans ces motifs, le gerant voit un stock qui fond sans
 * jamais savoir pourquoi, et ne peut pas distinguer un probleme de
 * conservation d'un probleme de personnel.
 */
const WASTE_REASONS = {
  broken: 'Cassé',
  burnt: 'Brûlé ou raté',
  expired: 'Périmé',
  staff: 'Repas du personnel',
  error: 'Erreur de préparation',
};

router.get('/waste-reasons', requireAuth, async (req, res) => {
  res.json(Object.entries(WASTE_REASONS).map(([code, label]) => ({ code, label })));
});

/** Declare une perte : le stock baisse, le benefice net en tient compte. */
router.post(
  '/:id/waste',
  requireAuth,
  requireRole('cook', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const reason = String(req.body.reason ?? '');
    if (!WASTE_REASONS[reason]) {
      return res.status(400).json({ error: 'Motif de perte invalide.' });
    }
    const quantity = Number(String(req.body.quantity ?? '').replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantité invalide.' });
    }

    const ingredient = await Ingredient.findByPk(req.params.id);
    if (!ingredient) return res.status(404).json({ error: 'Ingrédient introuvable.' });

    ingredient.quantityInStock = Math.max(0, ingredient.quantityInStock - quantity);
    await ingredient.save();

    await StockMovement.create({
      ingredientId: ingredient.id,
      type: 'waste',
      quantity: -quantity,
      note: WASTE_REASONS[reason],
    });

    await audit.record(req, {
      action: 'stock.waste',
      entityType: 'ingredient',
      entityId: ingredient.id,
      summary:
        `Perte de ${quantity} ${ingredient.unit} de ${ingredient.name} ` +
        `(${WASTE_REASONS[reason]})`,
      details: {
        name: ingredient.name,
        quantity,
        unit: ingredient.unit,
        reason,
        value: Math.round(quantity * ingredient.costPerUnit * 1000) / 1000,
      },
    });

    await refreshProductsAvailability();
    res.json(ingredient);
  }
);

/**
 * Inventaire physique.
 *
 * On compte reellement, et l'ecart avec le stock theorique se voit. C'est
 * la seule facon de reperer la demarque : tant que personne ne compte, un
 * stock theorique parfait peut cacher n'importe quoi.
 */
router.post(
  '/inventory',
  requireAuth,
  requireRole('manager', 'admin', 'super_admin'),
  async (req, res) => {
    const comptes = Array.isArray(req.body.counts) ? req.body.counts : [];
    if (comptes.length === 0) {
      return res.status(400).json({ error: 'Aucun comptage fourni.' });
    }

    const lignes = [];
    let valeurEcart = 0;

    for (const ligne of comptes) {
      const compte = Number(String(ligne.counted ?? '').replace(',', '.'));
      if (!Number.isFinite(compte) || compte < 0) continue;

      const ingredient = await Ingredient.findByPk(ligne.ingredientId);
      if (!ingredient) continue;

      const theorique = ingredient.quantityInStock;
      const ecart = Math.round((compte - theorique) * 1000) / 1000;
      if (Math.abs(ecart) >= 0.001) {
        ingredient.quantityInStock = compte;
        await ingredient.save();
        await StockMovement.create({
          ingredientId: ingredient.id,
          type: 'adjustment',
          quantity: ecart,
          note: 'Inventaire physique',
        });
      }

      valeurEcart += ecart * ingredient.costPerUnit;
      lignes.push({
        ingredientId: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        expected: theorique,
        counted: compte,
        gap: ecart,
        value: Math.round(ecart * ingredient.costPerUnit * 1000) / 1000,
      });
    }

    valeurEcart = Math.round(valeurEcart * 1000) / 1000;
    const manquants = lignes.filter((l) => l.gap < 0).length;

    await audit.record(req, {
      action: 'stock.inventory',
      entityType: 'inventory',
      summary:
        `Inventaire sur ${lignes.length} référence(s) — ` +
        (Math.abs(valeurEcart) < 0.001
          ? 'aucun écart'
          : `${valeurEcart > 0 ? 'excédent' : 'manquant'} de ${Math.abs(valeurEcart).toFixed(3)} DT`),
      details: { lines: lignes.length, shortages: manquants, value: valeurEcart },
    });

    await refreshProductsAvailability();
    res.json({ lines: lignes, value: valeurEcart, shortages: manquants });
  }
);

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
