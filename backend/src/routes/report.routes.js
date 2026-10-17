const express = require('express');
const { Op } = require('sequelize');
const { Order, OrderItem, Ingredient, StockMovement, CashSession } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const DRIVER_COMMISSION_PERCENT = Number(process.env.DRIVER_COMMISSION_PERCENT || 70);

// --- Benefice net sur une periode donnee ---
// benefice = ventes - cout des ingredients consommes - frais de livraison verses aux livreurs
router.get('/net-profit', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = {};
  if (from) dateFilter[Op.gte] = new Date(from);
  if (to) dateFilter[Op.lte] = new Date(to);

  const orders = await Order.findAll({
    where: {
      status: { [Op.in]: ['in_kitchen', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'] },
      ...(from || to ? { paidAt: dateFilter } : {}),
    },
  });

  const totalRevenue = orders.reduce((sum, o) => sum + o.subtotal + o.deliveryFee, 0);
  const totalDeliveryFees = orders.reduce((sum, o) => sum + o.deliveryFee, 0);
  const driverPayout = totalDeliveryFees * (DRIVER_COMMISSION_PERCENT / 100);

  // Cout des ingredients consommes (via les mouvements de type sale_deduction)
  const movements = await StockMovement.findAll({
    where: {
      type: 'sale_deduction',
      ...(from || to ? { createdAt: dateFilter } : {}),
    },
    include: [{ model: Ingredient }],
  });

  const ingredientCost = movements.reduce((sum, m) => {
    const cost = m.Ingredient ? m.Ingredient.costPerUnit : 0;
    return sum + Math.abs(m.quantity) * cost;
  }, 0);

  const netProfit = totalRevenue - ingredientCost - driverPayout;

  res.json({
    totalRevenue,
    ingredientCost,
    driverPayout,
    netProfit,
    ordersCount: orders.length,
  });
});

// --- Ingredients en alerte de stock bas ---
router.get('/low-stock', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const ingredients = await Ingredient.findAll();
  const low = ingredients.filter((i) => i.quantityInStock <= i.alertThreshold);
  res.json(low);
});

// --- Produits les plus vendus ---
router.get('/top-products', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const items = await OrderItem.findAll();
  const grouped = {};
  for (const item of items) {
    if (!grouped[item.productNameSnapshot]) {
      grouped[item.productNameSnapshot] = { name: item.productNameSnapshot, quantitySold: 0, revenue: 0 };
    }
    grouped[item.productNameSnapshot].quantitySold += item.quantity;
    grouped[item.productNameSnapshot].revenue += item.quantity * item.unitPrice;
  }
  const sorted = Object.values(grouped).sort((a, b) => b.quantitySold - a.quantitySold);
  res.json(sorted);
});

// --- Historique des sessions de caisse (fond, ecarts) ---
router.get('/cash-sessions', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const sessions = await CashSession.findAll({ order: [['openedAt', 'DESC']], limit: 50 });
  res.json(sessions);
});

module.exports = router;
