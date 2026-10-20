const express = require('express');
const { Order, OrderItem, DriverLocation, User } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const socket = require('../sockets/socketHandler');

const router = express.Router();

const DRIVER_COMMISSION_PERCENT = Number(process.env.DRIVER_COMMISSION_PERCENT || 70);

// --- Liste des livraisons disponibles (pas encore prises) ---
router.get('/available', requireAuth, requireRole('driver'), async (req, res) => {
  const orders = await Order.findAll({
    where: { status: 'awaiting_driver' },
    include: [{ model: OrderItem, as: 'items' }],
    order: [['createdAt', 'ASC']],
  });
  res.json(orders);
});

/**
 * La course en cours du livreur.
 *
 * Sans cette route, l'ecran du livreur ne connaissait sa course que par la
 * reponse de l'acceptation, gardee en memoire. Un rafraichissement, un
 * telephone qui se verrouille, une coupure de reseau, et la course
 * disparaissait de son ecran alors qu'elle lui etait toujours assignee :
 * il n'avait plus ni l'adresse, ni le montant a encaisser.
 */
router.get('/mine', requireAuth, requireRole('driver'), async (req, res) => {
  const order = await Order.findOne({
    where: { driverId: req.user.id, status: 'out_for_delivery' },
    include: [{ model: OrderItem, as: 'items' }],
    order: [['updatedAt', 'DESC']],
  });
  res.json(order); // null quand le livreur est libre
});

// --- Un livreur accepte une commande : le PREMIER arrive gagne (mise a jour atomique) ---
router.post('/:id/accept', requireAuth, requireRole('driver'), async (req, res) => {
  const orderId = req.params.id;

  // update conditionnel: ne reussit que si la commande est encore "awaiting_driver"
  // et sans livreur assigne -> evite que 2 livreurs prennent la meme commande en meme temps
  const [affectedRows] = await Order.update(
    { status: 'out_for_delivery', driverId: req.user.id },
    { where: { id: orderId, status: 'awaiting_driver', driverId: null } }
  );

  if (affectedRows === 0) {
    return res.status(409).json({ error: 'Cette commande a deja ete prise par un autre livreur.' });
  }

  const order = await Order.findByPk(orderId, { include: [{ model: OrderItem, as: 'items' }] });
  socket.emitDeliveryTaken(orderId, req.user.id);
  socket.emitOrderStatusChanged(order);

  res.json(order);
});

// --- Mise a jour de la position du livreur (aussi disponible via socket, ceci est un fallback REST) ---
router.post('/location', requireAuth, requireRole('driver'), async (req, res) => {
  const { lat, lng } = req.body;
  const [location] = await DriverLocation.findOrCreate({
    where: { driverId: req.user.id },
    defaults: { lat, lng },
  });
  location.lat = lat;
  location.lng = lng;
  location.updatedAt = new Date();
  await location.save();
  res.json(location);
});

// --- Confirmation de la remise via scan du QR code chez le client ---
router.post('/:id/confirm-delivery', requireAuth, requireRole('driver'), async (req, res) => {
  const { qrToken } = req.body;
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  if (order.driverId !== req.user.id) {
    return res.status(403).json({ error: "Cette commande n'est pas assignee a ce livreur." });
  }
  if (order.qrToken !== qrToken) {
    return res.status(400).json({ error: 'QR code invalide pour cette commande.' });
  }

  order.status = 'delivered';
  await order.save();

  socket.emitOrderStatusChanged(order);
  res.json(order);
});

// --- Le client ajoute un pourboire (avant ou apres livraison) ---
router.post('/:id/tip', requireAuth, async (req, res) => {
  const { tipAmount } = req.body;
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

  order.tipAmount = tipAmount;
  order.totalAmount = order.subtotal + order.deliveryFee + tipAmount;
  await order.save();
  res.json(order);
});

// --- Tableau de bord du livreur : gains, commission (70%), historique ---
router.get('/my-stats', requireAuth, requireRole('driver'), async (req, res) => {
  const orders = await Order.findAll({
    where: { driverId: req.user.id, status: ['delivered', 'completed'] },
    order: [['createdAt', 'DESC']],
  });

  let totalCollected = 0;
  let totalDriverEarnings = 0;
  let totalTips = 0;

  const list = orders.map((o) => {
    const driverShareOfDeliveryFee = o.deliveryFee * (DRIVER_COMMISSION_PERCENT / 100);
    const driverEarning = driverShareOfDeliveryFee + o.tipAmount;

    totalCollected += o.totalAmount;
    totalDriverEarnings += driverEarning;
    totalTips += o.tipAmount;

    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      totalAmount: o.totalAmount,
      deliveryFee: o.deliveryFee,
      tip: o.tipAmount,
      driverEarning,
      date: o.createdAt,
    };
  });

  res.json({
    commissionPercent: DRIVER_COMMISSION_PERCENT,
    totalCollected,
    totalDriverEarnings,
    totalTips,
    deliveriesCount: orders.length,
    orders: list,
  });
});

module.exports = router;
