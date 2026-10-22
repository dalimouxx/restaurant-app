const express = require('express');
const { filtreEtablissement } = require('../tenant');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { Order, OrderItem, Product, ProductOption, DeliveryZone } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { deductStockForOrderItems, restoreStockForOrderItems } = require('./stock.routes');
const socket = require('../sockets/socketHandler');
const audit = require('../audit');
const { badRequest, HttpError } = require('../errors');
const { getSettings } = require('../models/Setting');
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
  // Le filtre est explicite : une agregation ne passe pas par les
  // crochets de cloisonnement, et sans lui le numero reprendrait au
  // compteur du restaurant voisin au lieu de repartir a 1.
  const highest = await Order.max('orderNumber', {
    where: { orderDate, ...filtreEtablissement() },
  });
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
      // Pour rappeler le client quand c'est pret, a emporter surtout.
      customerName: req.body.customerName,
      customerPhone: req.body.customerPhone,
    });

    socket.emitNewKitchenTicket(order);
    res.status(201).json(order);
  }
);

// --- Creation d'une commande en ligne, avec choix retrait/livraison ---
router.post('/online', requireAuth, async (req, res) => {
  const {
    items, fulfillmentType, deliveryAddress, deliveryLat, deliveryLng,
    deliveryZoneId, customerName, customerPhone,
  } = req.body;

  /**
   * Hors des heures d'ouverture, on refuse ici et pas seulement dans le
   * navigateur : un onglet laisse ouvert depuis la veille passerait
   * commande a 3 h du matin, et c'est le restaurant qui s'excuserait.
   */
  const { opening } = await getSettings();
  if (!opening.open) {
    throw new HttpError(
      409,
      opening.opensAt
        ? `Le restaurant est fermé. Commandes à partir de ${opening.opensAt}${opening.opensDay ? ` ${opening.opensDay}` : ''}.`
        : 'Le restaurant est fermé pour le moment.'
    );
  }

  let deliveryFee = 0;
  let zone = null;

  if (fulfillmentType === 'delivery') {
    if (!deliveryAddress || String(deliveryAddress).trim().length < 5) {
      throw badRequest('Adresse de livraison requise.');
    }
    zone = deliveryZoneId
      ? await DeliveryZone.findOne({ where: { id: deliveryZoneId, isActive: true } })
      : null;
    if (!zone) throw badRequest('Choisissez votre zone de livraison.');
    deliveryFee = zone.fee;
  }

  const order = await createOrderWithItems({
    items,
    source: 'online',
    fulfillmentType,
    status: 'awaiting_payment',
    customerId: req.user.id,
    customerName,
    customerPhone,
    deliveryAddress,
    deliveryLat,
    deliveryLng,
    deliveryZoneId: zone?.id ?? null,
    deliveryFee,
    // Le minimum de la zone porte sur les plats, jamais sur les frais.
    minimumOrder: zone?.minimumOrder ?? 0,
    zoneName: zone?.name,
  });

  res.status(201).json(order);
});

async function createOrderWithItems(opts) {
  const {
    items, source, fulfillmentType, status, customerId,
    customerName, customerPhone,
    deliveryAddress, deliveryLat, deliveryLng, deliveryZoneId,
    deliveryFee = 0, minimumOrder = 0, zoneName,
  } = opts;

  /**
   * Livraison suspendue.
   *
   * Le controle est ici, dans la fabrique commune, et non dans chaque
   * route : la borne ne passe pas par le meme chemin que le site, et un
   * garde pose cote site l'aurait laissee prendre des livraisons que
   * personne n'etait la pour porter. Toute commande, d'ou qu'elle
   * vienne, passe par cette fonction.
   *
   * Les courses deja acceptees ne sont pas concernees : elles vont
   * jusqu'au bout. On ne laisse pas un client en plan parce qu'un
   * reglage a change pendant qu'il attendait.
   */
  if (fulfillmentType === 'delivery') {
    const { livraisonActive } = await getSettings();
    if (livraisonActive !== 'oui') {
      throw new HttpError(409, 'La livraison est suspendue pour le moment.');
    }
  }

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
      prepMinutes: product.prepMinutes || 0,
      unitPrice,
      quantity: item.quantity,
      customization,
      optionIds: options.map((o) => o.id),
    });
  }

  if (minimumOrder > 0 && subtotal < minimumOrder) {
    throw badRequest(
      `Minimum de ${minimumOrder.toFixed(3)} DT pour livrer${zoneName ? ` à ${zoneName}` : ''}. ` +
      `Votre commande est à ${subtotal.toFixed(3)} DT.`
    );
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
        customerName: customerName ? String(customerName).trim().slice(0, 80) : null,
        customerPhone: customerPhone ? String(customerPhone).trim().slice(0, 30) : null,
        subtotal,
        deliveryFee,
        totalAmount: subtotal + deliveryFee,
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        deliveryZoneId: deliveryZoneId ?? null,
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
  // Les commandes garees restent accessibles, mais hors de la file active.
  res.json(orders.filter((o) => !o.isParked));
});

// --- Encaissement d'une commande par le caissier : des validation -> envoi direct en cuisine ---
router.post('/:id/pay', requireAuth, requireRole('cashier', 'manager', 'admin', 'super_admin'), async (req, res) => {
  const { paymentMethod } = req.body;
  const order = await getFullOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  if (order.status !== 'awaiting_payment') {
    return res.status(400).json({ error: 'Cette commande a deja ete traitee.' });
  }

  const methode = paymentMethod || 'cash';

  /**
   * Addition partagee : chaque part est encaissee a son tour, et peut
   * l'etre par un moyen different. La commande ne part en cuisine qu'une
   * fois la derniere part reglee — sinon le premier qui paie emporterait
   * la commande des autres.
   */
  if (order.splitCount > 1) {
    const partsRestantes = order.splitCount - order.splitPaidCount;
    const montantPart = Math.round((order.totalAmount / order.splitCount) * 1000) / 1000;
    // La derniere part absorbe l'arrondi, pour que la somme tombe juste.
    const montant =
      partsRestantes === 1
        ? Math.round((order.totalAmount - montantPart * (order.splitCount - 1)) * 1000) / 1000
        : montantPart;

    order.splitPayments = [
      ...(order.splitPayments ?? []),
      { method: methode, amount: montant, at: new Date().toISOString() },
    ];
    order.splitPaidCount += 1;
    order.cashierId = req.user.id;

    if (order.splitPaidCount < order.splitCount) {
      await order.save();
      return res.json(await getFullOrder(order.id));
    }
  }

  /**
   * Ou va la commande une fois payee.
   *
   * Sans ecran cuisine, « en cuisine » designerait un poste qui n'existe
   * pas : la commande resterait la jusqu'a ce que quelqu'un la pousse a
   * la main, et personne ne le ferait. Elle est donc prete tout de suite,
   * et l'ecran de salle appelle le numero.
   */
  const { etapesCuisine } = await getSettings();
  order.status = etapesCuisine === 'aucune' ? 'ready' : 'in_kitchen';
  order.paymentMethod = methode;
  order.paidAt = new Date();
  order.cashierId = req.user.id;
  order.isParked = false;
  await order.save();

  // Deduction du stock au moment ou la commande part reellement en preparation
  await deductStockForOrderItems(order.items, order.id);

  socket.emitOrderStatusChanged(order);
  socket.emitNewKitchenTicket(order);
  socket.emitBoard(order);

  res.json(order);
});

/**
 * Écran mural des commandes prêtes.
 *
 * Public, et volontairement avare : numéro, état, heure. Aucun montant,
 * aucun plat, aucun nom — tout ce qui s'affiche là est lu par la salle
 * entière, et souvent photographié.
 */
router.get('/board', async (req, res) => {
  /**
   * Les plus recentes d'abord pour la troncature, puis remises dans
   * l'ordre d'arrivee pour l'affichage. Trier a l'endroit et couper a 40
   * revenait a jeter les commandes du moment pour garder celles du matin,
   * c'est-a-dire exactement l'inverse de ce que le client cherche.
   */
  const orders = await Order.findAll({
    where: { status: ['in_kitchen', 'preparing', 'ready'], orderDate: businessDay() },
    attributes: ['orderNumber', 'status', 'updatedAt'],
    order: [['updatedAt', 'DESC']],
    limit: 40,
  });
  res.json(
    orders
      .map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        since: o.updatedAt,
      }))
      .reverse()
  );
});

/** Les commandes garees, en attente du retour du client. */
router.get(
  '/parked',
  requireAuth,
  requireRole('cashier', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const orders = await Order.findAll({
      where: {
        status: 'awaiting_payment',
        isParked: true,
        createdAt: { [Op.gte]: new Date(Date.now() - QUEUE_WINDOW_MS) },
      },
      include: [{ model: OrderItem, as: 'items' }],
      order: [['updatedAt', 'DESC']],
    });
    res.json(orders);
  }
);

/* ─────────── Remise, mise en attente, partage ─────────── */

/**
 * Motifs de remise, fermes comme ceux d'annulation.
 *
 * Un champ libre donnerait « geste » ou « ok », et le gerant ne pourrait
 * jamais savoir si son equipe offre trois cafes par mois ou trente.
 */
const DISCOUNT_REASONS = {
  gesture: 'Geste commercial',
  late: 'Plat en retard',
  kitchen_error: 'Erreur de préparation',
  loyalty: 'Client fidèle',
  staff: 'Repas du personnel',
};

/** Paliers proposes au caissier. Il touche, il ne calcule pas. */
const DISCOUNT_STEPS = [5, 10, 20, 50, 100];

/**
 * Au-dela de ce palier, la remise demande un gerant. Un caissier seul ne
 * doit pas pouvoir offrir une addition entiere : c'est la porte ouverte a
 * un encaissement qui disparait.
 */
const CASHIER_MAX_PERCENT = 20;

router.get('/discount-reasons', requireAuth, async (req, res) => {
  res.json({
    reasons: Object.entries(DISCOUNT_REASONS).map(([code, label]) => ({ code, label })),
    steps: DISCOUNT_STEPS,
    cashierMaxPercent: CASHIER_MAX_PERCENT,
  });
});

function recomputeTotal(order) {
  const net = Math.max(0, order.subtotal - order.discountAmount);
  order.totalAmount = Math.round((net + order.deliveryFee + order.tipAmount) * 1000) / 1000;
}

router.post(
  '/:id/discount',
  requireAuth,
  requireRole('cashier', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const percent = Number(req.body.percent);
    const reason = String(req.body.reason ?? '');

    if (!DISCOUNT_STEPS.includes(percent)) {
      throw badRequest('Palier de remise invalide.');
    }
    if (!DISCOUNT_REASONS[reason]) {
      throw badRequest('Motif de remise invalide.');
    }

    const isManager = ['manager', 'admin', 'super_admin'].includes(req.user.role);
    if (!isManager && percent > CASHIER_MAX_PERCENT) {
      return res.status(403).json({
        error: `Au-delà de ${CASHIER_MAX_PERCENT} %, la remise demande un gérant.`,
      });
    }

    const order = await getFullOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.status !== 'awaiting_payment') {
      throw badRequest('Remise impossible : cette commande est déjà encaissée.');
    }

    order.discountAmount = Math.round(order.subtotal * (percent / 100) * 1000) / 1000;
    order.discountReason = reason;
    order.discountById = req.user.id;
    recomputeTotal(order);
    await order.save();

    await audit.record(req, {
      action: 'order.discounted',
      entityType: 'order',
      entityId: order.id,
      summary:
        `Remise de ${percent} % sur la commande n° ${order.orderNumber} ` +
        `(${DISCOUNT_REASONS[reason]}) — ${order.discountAmount.toFixed(3)} DT`,
      details: {
        orderNumber: order.orderNumber,
        percent,
        amount: order.discountAmount,
        reason,
        reasonLabel: DISCOUNT_REASONS[reason],
        subtotal: order.subtotal,
      },
    });

    res.json(await getFullOrder(order.id));
  }
);

/** Retire la remise, tant que la commande n'est pas encaissee. */
router.delete(
  '/:id/discount',
  requireAuth,
  requireRole('cashier', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const order = await getFullOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.status !== 'awaiting_payment') {
      throw badRequest('Cette commande est déjà encaissée.');
    }
    order.discountAmount = 0;
    order.discountReason = null;
    order.discountById = null;
    recomputeTotal(order);
    await order.save();
    res.json(await getFullOrder(order.id));
  }
);

/**
 * Mise en attente.
 *
 * Le client part chercher de l'argent, un autre attend derriere. La
 * commande quitte la file active sans etre annulee et y revient d'un
 * geste : sans cela, le caissier annulait puis ressaisissait tout.
 */
router.post(
  '/:id/park',
  requireAuth,
  requireRole('cashier', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.status !== 'awaiting_payment') {
      throw badRequest('Seule une commande en attente de paiement peut être garée.');
    }
    order.isParked = Boolean(req.body.parked ?? true);
    await order.save();
    res.json(await getFullOrder(order.id));
  }
);

/** Divise l'addition en parts egales. */
router.post(
  '/:id/split',
  requireAuth,
  requireRole('cashier', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const parts = Number(req.body.parts);
    if (!Number.isInteger(parts) || parts < 1 || parts > 12) {
      throw badRequest('Entre 1 et 12 parts.');
    }
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    if (order.status !== 'awaiting_payment') {
      throw badRequest('Cette commande est déjà encaissée.');
    }
    if (parts < order.splitPaidCount) {
      throw badRequest(`${order.splitPaidCount} part(s) déjà réglée(s).`);
    }
    order.splitCount = parts;
    if (parts === 1) order.splitPaidCount = 0;
    await order.save();
    res.json(await getFullOrder(order.id));
  }
);

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
  const { status } = req.body; // 'in_kitchen' | 'preparing' | 'ready'
  if (!['in_kitchen', 'preparing', 'ready'].includes(status)) {
    throw badRequest('Statut de cuisine invalide.');
  }

  /**
   * Le deroule retenu par l'etablissement fait foi.
   *
   * En un seul geste, « en preparation » n'existe pas : l'accepter
   * quand meme creerait des commandes dans un etat que l'ecran de
   * cuisine n'affiche plus, et qu'aucun bouton ne ferait avancer.
   */
  const { etapesCuisine } = await getSettings();
  if (etapesCuisine === 'aucune') {
    throw badRequest("L'ecran de cuisine est desactive dans les reglages.");
  }
  if (etapesCuisine === 'une' && status === 'preparing') {
    throw badRequest(
      "Le service se fait en un seul geste : la commande passe directement a « prete »."
    );
  }

  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

  /**
   * Rappel d'un plat marque pret par erreur.
   *
   * C'est le geste le plus courant en coup de feu : on tape sur le
   * mauvais ticket. Tant que personne n'a emporte la commande, le retour
   * en arriere doit etre possible ; une fois le livreur parti, non.
   */
  const enArriere = ['ready', 'awaiting_driver'].includes(order.status) && status !== 'ready';
  if (enArriere && order.driverId) {
    throw badRequest('Un livreur a deja pris cette commande.');
  }
  if (['out_for_delivery', 'delivered', 'completed', 'cancelled'].includes(order.status)) {
    throw badRequest('Cette commande a quitte la cuisine.');
  }

  order.status = status;
  await order.save();

  // Un rappel retire la course de la liste des livreurs.
  if (enArriere) {
    await order.save();
    socket.emitDeliveryTaken(order.id, null);
    await audit.record(req, {
      action: 'order.kitchen_undo',
      entityType: 'order',
      entityId: order.id,
      summary: `Commande n° ${order.orderNumber} rappelée en préparation`,
      details: { orderNumber: order.orderNumber },
    });
  }

  // Si la commande est prete ET c'est une livraison -> on la propose aux livreurs
  if (status === 'ready' && order.fulfillmentType === 'delivery') {
    order.status = 'awaiting_driver';
    await order.save();
    socket.emitDeliveryAvailable(order);
  }

  socket.emitOrderStatusChanged(order);
  socket.emitBoard(order);
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
