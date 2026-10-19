const express = require('express');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { Order, OrderItem, Product, ProductOption, User } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { deductStockForOrderItems, restoreStockForOrderItems } = require('./stock.routes');
const socket = require('../sockets/socketHandler');
const audit = require('../audit');
const { badRequest } = require('../errors');
const { throttle } = require('../middleware/rateLimit');

const router = express.Router();

/**
 * Journee commerciale, au fuseau du restaurant.
 *
 * Une commande prise a 00 h 30 appartient au service de la veille pour le
 * personnel, mais le serveur, lui, raisonne en UTC. On fige donc la date
 * locale a la creation plutot que de la recalculer ensuite : c'est elle
 * qui porte la numerotation du jour.
 */
const TIMEZONE = process.env.RESTAURANT_TIMEZONE || 'Africa/Tunis';

function businessDay(date = new Date()) {
  // 'en-CA' donne AAAA-MM-JJ, le format attendu par une colonne DATE.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Numero affiche au client : reprend a 1 chaque jour.
 *
 * L'ancien compteur tournait sur le nombre total de commandes modulo 999 :
 * le numero 1 pouvait designer une commande d'hier, et deux commandes
 * pouvaient porter le meme numero le meme jour. Un index unique sur
 * (journee, numero) rend cela impossible, et l'appelant retente si deux
 * commandes se croisent.
 */
async function getNextOrderNumber(orderDate) {
  const highest = await Order.max('orderNumber', { where: { orderDate } });
  return Number.isFinite(highest) ? highest + 1 : 1;
}

/**
 * Borne en libre-service : aucune connexion, par nature. L'ecran est dans
 * la salle, mais l'adresse, elle, est sur Internet — une boucle depuis
 * n'importe ou pouvait remplir la file de la caisse de fausses commandes.
 * Quarante par quart d'heure et par adresse : au-dela du rythme d'une
 * borne en plein coup de feu.
 */
router.post('/kiosk', throttle('borne', { max: 40, windowMs: 15 * 60 * 1000 }), async (req, res) => {
  const { items, fulfillmentType } = req.body;
  // items = [{ productId, quantity, customization }]

  const order = await createOrderWithItems({
    items,
    source: 'kiosk',
    fulfillmentType: fulfillmentType || 'pickup',
    status: 'awaiting_payment',
  });

  socket.emitNewKitchenTicket(order);
  res.status(201).json(order);
});

/**
 * Prise de commande au comptoir par le caissier.
 *
 * Identique a la borne, mais tracee au nom du caissier et marquee
 * « comptoir » pour distinguer les deux canaux dans les rapports.
 */
router.post(
  '/counter',
  requireAuth,
  requireRole('cashier', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const { items, fulfillmentType } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'La commande est vide.' });
    }

    const order = await createOrderWithItems({
      items,
      source: 'counter',
      fulfillmentType: fulfillmentType || 'dine_in',
      status: 'awaiting_payment',
      cashierId: req.user.id,
    });

    socket.emitNewKitchenTicket(order);
    res.status(201).json(order);
  }
);

// --- Creation d'une commande en ligne (app mobile), avec choix retrait/livraison ---
router.post('/online', requireAuth, async (req, res) => {
  const { items, fulfillmentType, deliveryAddress, deliveryLat, deliveryLng } = req.body;

  const DELIVERY_FEE = 7; // a rendre configurable via l'app super admin plus tard

  const order = await createOrderWithItems({
    items,
    source: 'online',
    fulfillmentType,
    status: 'awaiting_payment',
    customerId: req.user.id,
    deliveryAddress,
    deliveryLat,
    deliveryLng,
    deliveryFee: fulfillmentType === 'delivery' ? DELIVERY_FEE : 0,
  });

  res.status(201).json(order);
});

async function createOrderWithItems(opts) {
  const {
    items, source, fulfillmentType, status, customerId,
    deliveryAddress, deliveryLat, deliveryLng, deliveryFee = 0,
  } = opts;

  let subtotal = 0;
  const enrichedItems = [];

  for (const item of items) {
    const product = await Product.findByPk(item.productId);
    if (!product) throw badRequest('Un plat de la commande n\'existe plus.');
    // Un plat retire de la carte peut encore tenir dans un onglet reste
    // ouvert ou dans un panier abandonne : on refuse sans ambiguite.
    if (product.isArchived) {
      throw badRequest(`« ${product.name} » ne figure plus à la carte.`);
    }
    if (!product.isAvailable) {
      throw badRequest(`« ${product.name} » est épuisé.`);
    }

    /**
     * Les choix viennent toujours de la liste predefinie du produit : le
     * client envoie des identifiants, jamais un prix ni un texte libre.
     * On relit les options en base pour que personne ne puisse fabriquer
     * un supplement gratuit depuis le navigateur.
     */
    const requested = Array.isArray(item.optionIds) ? item.optionIds : [];
    const options = requested.length
      ? await ProductOption.findAll({
          where: { id: requested, productId: product.id, isActive: true },
        })
      : [];

    if (options.length !== requested.length) {
      throw badRequest(`Choix inconnu pour « ${product.name} ».`);
    }

    const extras = options.reduce((sum, o) => sum + o.extraPrice, 0);
    const unitPrice = product.price + extras;
    subtotal += unitPrice * item.quantity;

    // Memorise pour la cuisine et pour le ticket, avec le vocabulaire fige.
    const customization = {
      removed: options
        .filter((o) => o.kind === 'remove')
        .map((o) => ({ id: o.id, label: o.label })),
      added: options
        .filter((o) => o.kind === 'add')
        .map((o) => ({ id: o.id, label: o.label, price: o.extraPrice })),
    };

    enrichedItems.push({
      productId: product.id,
      productNameSnapshot: product.name,
      unitPrice,
      quantity: item.quantity,
      customization,
      optionIds: options.map((o) => o.id),
    });
  }

  const orderDate = businessDay();

  // Deux commandes prises dans la meme seconde peuvent viser le meme
  // numero. L'index unique les departage et on retente, plutot que de
  // laisser deux tickets « 12 » circuler en salle.
  let order = null;
  for (let attempt = 1; attempt <= 5 && !order; attempt++) {
    try {
      order = await Order.create({
        orderNumber: await getNextOrderNumber(orderDate),
        orderDate,
        source,
        fulfillmentType,
        status,
        customerId,
        cashierId: opts.cashierId ?? null,
        subtotal,
        deliveryFee,
        totalAmount: subtotal + deliveryFee,
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        qrToken: uuidv4(),
      });
    } catch (err) {
      if (err.name !== 'SequelizeUniqueConstraintError' || attempt === 5) throw err;
    }
  }

  for (const item of enrichedItems) {
    // optionIds sert a la deduction du stock, pas au stockage de la ligne.
    const { optionIds, ...line } = item;
    await OrderItem.create({ ...line, orderId: order.id });
  }

  return getFullOrder(order.id);
}

async function getFullOrder(orderId) {
  return Order.findByPk(orderId, { include: [{ model: OrderItem, as: 'items' }] });
}

// --- Liste des commandes en attente de paiement (vue caisse) ---
/**
 * File d'attente de la caisse.
 *
 * Bornee a douze heures : une commande prise a la borne puis abandonnee
 * par le client reste « en attente de paiement » pour toujours. Sans cette
 * limite, la file grossit de jour en jour et le caissier finit par
 * chercher la commande du moment au milieu de celles de la semaine. Douze
 * heures couvrent largement un service, meme a cheval sur minuit, sans
 * avoir a raisonner sur les fuseaux.
 */
const QUEUE_WINDOW_MS = 12 * 60 * 60 * 1000;

router.get('/pending-payment', requireAuth, requireRole('cashier', 'manager', 'admin', 'super_admin'), async (req, res) => {
  const orders = await Order.findAll({
    where: {
      status: 'awaiting_payment',
      createdAt: { [Op.gte]: new Date(Date.now() - QUEUE_WINDOW_MS) },
    },
    include: [{ model: OrderItem, as: 'items' }],
    order: [['createdAt', 'ASC']],
  });
  res.json(orders);
});

// --- Encaissement d'une commande par le caissier : des validation -> envoi direct en cuisine ---
router.post('/:id/pay', requireAuth, requireRole('cashier', 'manager', 'admin', 'super_admin'), async (req, res) => {
  const { paymentMethod } = req.body;
  const order = await getFullOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  if (order.status !== 'awaiting_payment') {
    return res.status(400).json({ error: 'Cette commande a deja ete traitee.' });
  }

  order.status = 'in_kitchen';
  order.paymentMethod = paymentMethod || 'cash';
  order.paidAt = new Date();
  order.cashierId = req.user.id;
  await order.save();

  // Deduction du stock au moment ou la commande part reellement en preparation
  await deductStockForOrderItems(order.items, order.id);

  socket.emitOrderStatusChanged(order);
  socket.emitNewKitchenTicket(order);

  res.json(order);
});

/* ─────────── Annulation ─────────── */

/**
 * Motifs d'annulation, fermes.
 *
 * Le caissier ne tape rien : il choisit. Une zone de texte libre donnerait
 * « erreur », « rien », ou pire une justification ecrite apres coup. Un
 * motif choisi dans une liste reste comparable d'un mois sur l'autre, et
 * c'est ce qui permet de voir qu'un poste annule trois fois plus que les
 * autres.
 */
const CANCEL_REASONS = {
  entry_error: 'Erreur de saisie',
  customer_left: 'Client parti',
  out_of_stock: 'Plat indisponible',
  duplicate: 'Commande en double',
  kitchen_error: 'Erreur de préparation',
};

router.get('/cancel-reasons', requireAuth, async (req, res) => {
  res.json(
    Object.entries(CANCEL_REASONS).map(([code, label]) => ({ code, label }))
  );
});

/**
 * Annule une commande. Jamais de suppression : le numero reste pris, la
 * ligne reste lisible, et qui a annule quoi se retrouve dans le journal.
 */
router.post(
  '/:id/cancel',
  requireAuth,
  requireRole('cashier', 'cook', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const reason = String(req.body.reason ?? '');
    if (!CANCEL_REASONS[reason]) {
      return res.status(400).json({ error: 'Motif d\'annulation invalide.' });
    }

    const order = await getFullOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.status === 'cancelled') {
      return res.status(409).json({ error: 'Cette commande est déjà annulée.' });
    }

    /**
     * Une commande remise au client est un remboursement, pas une erreur de
     * saisie : elle touche la caisse apres coup et doit passer par le
     * gerant. Le caissier, lui, corrige ce qu'il vient de faire.
     */
    const isManager = ['manager', 'admin', 'super_admin'].includes(req.user.role);
    if (['delivered', 'completed'].includes(order.status) && !isManager) {
      return res.status(403).json({
        error: 'Commande déjà remise au client : seul le gérant peut l\'annuler.',
      });
    }

    // Le stock n'a ete deduit qu'au paiement : on ne rend que ce qui est parti.
    const wasPaid = Boolean(order.paidAt);
    if (wasPaid) await restoreStockForOrderItems(order.items, order.id);

    order.status = 'cancelled';
    order.cancelReason = reason;
    order.cancelledById = req.user.id;
    order.cancelledAt = new Date();
    await order.save();

    socket.emitOrderStatusChanged(order);

    await audit.record(req, {
      action: 'order.cancelled',
      entityType: 'order',
      entityId: order.id,
      summary:
        `Commande n° ${order.orderNumber} annulée (${CANCEL_REASONS[reason]})` +
        (wasPaid ? ` — ${order.totalAmount.toFixed(3)} DT déjà encaissés` : ''),
      details: {
        orderNumber: order.orderNumber,
        reason,
        reasonLabel: CANCEL_REASONS[reason],
        wasPaid,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        stockRestored: wasPaid,
      },
    });

    res.json(await getFullOrder(order.id));
  }
);

/**
 * Commandes de la journee en cours, les plus recentes d'abord.
 *
 * C'est ce qui manquait au caissier : une fois encaissee, une commande
 * disparaissait de son ecran. Reimprimer un recu ou rattraper une erreur
 * commise trente secondes plus tot n'etait plus possible.
 */
router.get(
  '/recent',
  requireAuth,
  requireRole('cashier', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const orders = await Order.findAll({
      where: { orderDate: businessDay() },
      include: [{ model: OrderItem, as: 'items' }],
      order: [['createdAt', 'DESC']],
      limit: 40,
    });
    res.json(orders);
  }
);

// --- Cuisine : liste des commandes actives (en cours de preparation) ---
router.get('/kitchen/queue', requireAuth, requireRole('cook', 'manager', 'admin', 'super_admin'), async (req, res) => {
  const orders = await Order.findAll({
    where: { status: ['in_kitchen', 'preparing', 'ready'] },
    include: [{ model: OrderItem, as: 'items' }],
    order: [['createdAt', 'ASC']],
  });
  res.json(orders);
});

// --- Cuisine : changer le statut d'une commande (preparing -> ready) ---
router.post('/:id/kitchen-status', requireAuth, requireRole('cook', 'manager', 'admin', 'super_admin'), async (req, res) => {
  const { status } = req.body; // 'preparing' | 'ready'
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

  order.status = status;
  await order.save();

  // Si la commande est prete ET c'est une livraison -> on la propose aux livreurs
  if (status === 'ready' && order.fulfillmentType === 'delivery') {
    order.status = 'awaiting_driver';
    await order.save();
    socket.emitDeliveryAvailable(order);
  }

  socket.emitOrderStatusChanged(order);
  res.json(order);
});

// --- Suivi d'une commande par le client ---
router.get('/:id', requireAuth, async (req, res) => {
  const order = await getFullOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  res.json(order);
});

// --- Historique des commandes d'un client ---
router.get('/customer/:customerId', requireAuth, async (req, res) => {
  const orders = await Order.findAll({
    where: { customerId: req.params.customerId },
    include: [{ model: OrderItem, as: 'items' }],
    order: [['createdAt', 'DESC']],
  });
  res.json(orders);
});

module.exports = router;
