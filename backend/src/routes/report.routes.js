const express = require('express');
const { Op } = require('sequelize');
const {
  Order, OrderItem, Ingredient, StockMovement, CashSession, AuditLog,
} = require('../models');
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

  // Une remise accordee n'est jamais encaissee : la compter dans le chiffre
  // d'affaires ferait croire a une marge que personne n'a touchee.
  const totalDiscounts = orders.reduce((sum, o) => sum + (o.discountAmount || 0), 0);
  const totalRevenue = orders.reduce(
    (sum, o) => sum + o.subtotal - (o.discountAmount || 0) + o.deliveryFee,
    0
  );
  const totalDeliveryFees = orders.reduce((sum, o) => sum + o.deliveryFee, 0);
  const driverPayout = totalDeliveryFees * (DRIVER_COMMISSION_PERCENT / 100);

  /**
   * Cout des ingredients reellement consommes.
   *
   * Les ventes retirent du stock, les annulations lui rendent ce qui n'a
   * pas ete prepare. Compter les seules deductions ferait porter au
   * benefice net le cout de plats jamais sortis de la cuisine.
   */
  const movements = await StockMovement.findAll({
    where: {
      type: ['sale_deduction', 'cancellation', 'waste'],
      ...(from || to ? { createdAt: dateFilter } : {}),
    },
    include: [{ model: Ingredient }],
  });

  /**
   * Les ventes consomment, les annulations rendent, les pertes coutent.
   * Une casse ou un plat brule est de la matiere payee qui n'a rien
   * rapporte : l'ignorer gonflerait la marge d'autant.
   */
  const ingredientCost = movements.reduce((sum, m) => {
    const cost = m.Ingredient ? m.Ingredient.costPerUnit : 0;
    const signed = m.type === 'cancellation' ? -Math.abs(m.quantity) : Math.abs(m.quantity);
    return sum + signed * cost;
  }, 0);

  const wasteCost = movements
    .filter((m) => m.type === 'waste')
    .reduce((sum, m) => sum + Math.abs(m.quantity) * (m.Ingredient ? m.Ingredient.costPerUnit : 0), 0);

  const netProfit = totalRevenue - ingredientCost - driverPayout;

  res.json({
    totalRevenue,
    totalDiscounts,
    ingredientCost,
    wasteCost,
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
  // Les lignes des commandes annulees n'ont jamais ete vendues : les
  // compter ferait remonter un plat qu'on a surtout saisi par erreur.
  const items = await OrderItem.findAll({
    include: [{
      model: Order,
      attributes: [],
      required: true,
      where: { status: { [Op.ne]: 'cancelled' } },
    }],
  });
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

/**
 * Heures de pointe.
 *
 * Quand le restaurant travaille vraiment, par creneau d'une heure. C'est
 * ce qui dit a un patron a quelle heure mettre un employe de plus, et a
 * quelle heure il paie quelqu'un a attendre.
 */
router.get('/peak-hours', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const jours = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const depuis = new Date(Date.now() - jours * 24 * 60 * 60 * 1000);

  const orders = await Order.findAll({
    where: {
      status: { [Op.notIn]: ['cancelled', 'awaiting_payment'] },
      paidAt: { [Op.gte]: depuis },
    },
    attributes: ['paidAt', 'subtotal', 'discountAmount', 'deliveryFee'],
  });

  const TZ = process.env.RESTAURANT_TIMEZONE || 'Africa/Tunis';
  const heureLocale = (date) =>
    Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, hour: '2-digit', hour12: false,
      }).format(date)
    ) % 24;

  const creneaux = Array.from({ length: 24 }, (_, h) => ({
    hour: h, orders: 0, revenue: 0,
  }));

  for (const o of orders) {
    const h = heureLocale(o.paidAt);
    creneaux[h].orders += 1;
    creneaux[h].revenue += o.subtotal - (o.discountAmount || 0) + o.deliveryFee;
  }

  // On ne renvoie que les heures ou le restaurant a reellement servi :
  // vingt-quatre barres dont dix-huit a zero ne disent rien.
  const servies = creneaux.filter((c) => c.orders > 0);
  res.json({
    days: jours,
    hours: servies,
    busiest: servies.reduce((a, b) => (b.orders > (a?.orders ?? 0) ? b : a), null),
  });
});

/**
 * Marge par plat.
 *
 * Le classement par quantite vendue flatte les boissons. Celui-ci dit ce
 * que chaque plat rapporte reellement, une fois ses ingredients payes.
 */
router.get('/margins', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const { Product, ProductIngredient, Ingredient: Ing } = require('../models');

  const produits = await Product.findAll({ where: { isArchived: false } });
  const liens = await ProductIngredient.findAll();
  const ingredients = await Ing.findAll();
  const coutDe = new Map(ingredients.map((i) => [i.id, i.costPerUnit]));

  const coutParProduit = new Map();
  for (const l of liens) {
    const cout = (coutDe.get(l.ingredientId) || 0) * l.quantityNeeded;
    coutParProduit.set(l.productId, (coutParProduit.get(l.productId) || 0) + cout);
  }

  // Quantites vendues, hors commandes annulees.
  const lignes = await OrderItem.findAll({
    include: [{
      model: Order, attributes: [], required: true,
      where: { status: { [Op.notIn]: ['cancelled', 'awaiting_payment'] } },
    }],
  });
  const vendus = new Map();
  for (const l of lignes) {
    vendus.set(l.productId, (vendus.get(l.productId) || 0) + l.quantity);
  }

  const resultat = produits.map((p) => {
    const cost = Math.round((coutParProduit.get(p.id) || 0) * 1000) / 1000;
    const margin = Math.round((p.price - cost) * 1000) / 1000;
    const sold = vendus.get(p.id) || 0;
    return {
      id: p.id,
      name: p.name,
      price: p.price,
      cost,
      margin,
      marginPercent: p.price > 0 ? Math.round((margin / p.price) * 1000) / 10 : 0,
      hasRecipe: coutParProduit.has(p.id),
      soldCount: sold,
      totalMargin: Math.round(margin * sold * 1000) / 1000,
    };
  });

  resultat.sort((a, b) => b.totalMargin - a.totalMargin);
  res.json(resultat);
});

/**
 * Comparaison avec la periode precedente.
 *
 * Un chiffre seul ne dit rien : 1 200 dinars, c'est bien ou mal ? La
 * reponse est dans l'ecart avec la semaine d'avant.
 */
router.get('/compare', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const jours = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const msPeriode = jours * 24 * 60 * 60 * 1000;
  const finCourante = new Date();
  const debutCourante = new Date(finCourante.getTime() - msPeriode);
  const debutPrecedente = new Date(debutCourante.getTime() - msPeriode);

  async function periode(depuis, jusqua) {
    const orders = await Order.findAll({
      where: {
        status: { [Op.notIn]: ['cancelled', 'awaiting_payment'] },
        paidAt: { [Op.gte]: depuis, [Op.lt]: jusqua },
      },
      attributes: ['subtotal', 'discountAmount', 'deliveryFee'],
    });
    const revenue = orders.reduce(
      (s, o) => s + o.subtotal - (o.discountAmount || 0) + o.deliveryFee, 0
    );
    return {
      orders: orders.length,
      revenue: Math.round(revenue * 1000) / 1000,
      averageTicket: orders.length > 0 ? Math.round((revenue / orders.length) * 1000) / 1000 : 0,
    };
  }

  const courante = await periode(debutCourante, finCourante);
  const precedente = await periode(debutPrecedente, debutCourante);

  const evolution = (a, b) => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);

  res.json({
    days: jours,
    current: courante,
    previous: precedente,
    change: {
      revenue: evolution(courante.revenue, precedente.revenue),
      orders: evolution(courante.orders, precedente.orders),
      averageTicket: evolution(courante.averageTicket, precedente.averageTicket),
    },
  });
});

/**
 * Export comptable.
 *
 * Une ligne par commande encaissee, en CSV separe par points-virgules :
 * c'est ce qu'Excel francophone ouvre sans poser de question.
 */
router.get('/export', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const { from, to } = req.query;
  const where = { status: { [Op.notIn]: ['awaiting_payment'] } };
  if (from || to) {
    where.paidAt = {};
    if (from) where.paidAt[Op.gte] = new Date(String(from));
    if (to) where.paidAt[Op.lte] = new Date(String(to));
  }

  const orders = await Order.findAll({
    where,
    include: [{ model: OrderItem, as: 'items' }],
    order: [['paidAt', 'ASC']],
    limit: 5000,
  });

  const echappe = (v) => {
    const t = String(v ?? '');
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const nombre = (n) => String(Math.round((n || 0) * 1000) / 1000).replace('.', ',');

  const lignes = [
    [
      'Date', 'Heure', 'Numero', 'Canal', 'Service', 'Statut', 'Articles',
      'Sous-total', 'Remise', 'Motif remise', 'Livraison', 'Pourboire',
      'Total', 'Reglement',
    ].join(';'),
  ];

  const TZ = process.env.RESTAURANT_TIMEZONE || 'Africa/Tunis';
  const fmtDate = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, dateStyle: 'short' });
  const fmtHeure = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, timeStyle: 'short' });

  for (const o of orders) {
    const quand = o.paidAt || o.createdAt;
    lignes.push([
      fmtDate.format(quand),
      fmtHeure.format(quand),
      o.orderNumber,
      o.source,
      o.fulfillmentType,
      o.status,
      (o.items || []).reduce((s, i) => s + i.quantity, 0),
      nombre(o.subtotal),
      nombre(o.discountAmount),
      echappe(o.discountReason || ''),
      nombre(o.deliveryFee),
      nombre(o.tipAmount),
      nombre(o.totalAmount),
      o.paymentMethod || '',
    ].join(';'));
  }

  // Le BOM evite qu'Excel massacre les accents a l'ouverture.
  const csv = '\ufeff' + lignes.join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ventes-${Date.now()}.csv"`);
  res.send(csv);
});

/**
 * Journal des operations sensibles. Lecture seule, reservee au gerant :
 * c'est ce qui permet de voir qui annule, qui change les prix, et a quelle
 * heure. Aucune route ne permet d'y ecrire autrement que par l'action
 * elle-meme, ni d'en effacer une ligne.
 */
router.get('/audit', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const { action, from, to } = req.query;
  const where = {};

  if (action) where.action = String(action);
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(String(from));
    if (to) where.createdAt[Op.lte] = new Date(String(to));
  }

  const limit = Math.min(Number(req.query.limit) || 100, 300);
  const entries = await AuditLog.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
  });
  res.json(entries);
});

module.exports = router;
