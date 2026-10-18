const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Order, OrderItem, Product, ProductOption } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { deductStockForOrderItems } = require('./stock.routes');
const socket = require('../sockets/socketHandler');

const router = express.Router();

// Genere le prochain numero de commande du jour (simple compteur, remis a 1 chaque jour en pratique
// via une tache planifiee ou un filtre sur la date - simplifie ici)
async function getNextOrderNumber() {
  const count = await Order.count();
  return (count % 999) + 1;
}

// --- Creation d'une commande depuis la borne (kiosque) ou le comptoir : statut = en attente de paiement ---
router.post('/kiosk', async (req, res) => {
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
    if (!product) throw new Error('Produit introuvable: ' + item.productId);
    if (!product.isAvailable) {
      throw new Error(`"${product.name}" est actuellement indisponible (stock).`);
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
      throw new Error(`Choix inconnu pour "${product.name}".`);
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

  const orderNumber = await getNextOrderNumber();
  const order = await Order.create({
    orderNumber,
    source,
    fulfillmentType,
    status,
    customerId,
    subtotal,
    deliveryFee,
    totalAmount: subtotal + deliveryFee,
    deliveryAddress,
    deliveryLat,
    deliveryLng,
    qrToken: uuidv4(),
  });

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
router.get('/pending-payment', requireAuth, requireRole('cashier', 'manager', 'admin', 'super_admin'), async (req, res) => {
  const orders = await Order.findAll({
    where: { status: 'awaiting_payment' },
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
