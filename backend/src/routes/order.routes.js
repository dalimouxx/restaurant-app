const express = require('express');
const { filtreEtablissement, restaurantCourant } = require('../tenant');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const {
  sequelize,
  Order, OrderItem, Product, ProductOption, DeliveryZone, NumberReservation,
} = require('../models');
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
/** La journee commerciale precedente, au fuseau du restaurant. */
function veille() {
  return businessDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

/**
 * Ce qui doit rester a l'ecran du service en cours.
 *
 * Les numeros repartent a 1 chaque jour. Sans borne de date, un ticket
 * jamais termine la veille — une commande abandonnee, un plat que
 * personne n'a decoche a la fermeture — reste affiche indefiniment et
 * finit par porter le meme numero qu'un ticket du jour. Un cuisinier
 * voit alors deux « 107 » cote a cote, et il n'a aucun moyen de savoir
 * lequel est le sien.
 *
 * On garde donc toute la journee en cours, plus la seule fin de service
 * de la veille : une commande passee a 23 h 50 doit rester visible
 * apres minuit, alors que sa journee de service, elle, a change.
 *
 * **Il faut les deux bornes, et deux versions s'y sont cassees.**
 *
 * La premiere retenait tout ce qui datait de moins de six heures, sans
 * borne de journee. A quatre heures du matin, elle rattrapait des
 * tickets d'une journee deja close dont les numeros avaient entre-temps
 * ete reattribues : elle reconstituait exactement le doublon qu'elle
 * devait empecher.
 *
 * La seconde bornait par journee commerciale — aujourd'hui et la veille
 * — sans borne d'heure. Elle ramenait alors la veille en entier, midi
 * compris : six cents tickets impayes d'un service termine depuis
 * seize heures, devant le caissier.
 *
 * La regle juste est la conjonction : la veille ne compte que par sa
 * queue, celle qui vient de franchir minuit. Au plus deux series de
 * numeros, dont la plus ancienne n'est qu'un reliquat de quelques
 * heures.
 *
 * Deux series peuvent encore se croiser — le 12 d'hier et le 12
 * d'aujourd'hui. Ce n'est plus un probleme d'affichage mais de
 * lisibilite, et c'est traite la ou il se voit : chaque ticket porte sa
 * journee, et l'ecran marque « hier » sur ceux qui n'appartiennent pas
 * au service du jour. Masquer le plus ancien serait pire — le plat,
 * lui, est bien reel.
 */
const REPORT_MS = 6 * 60 * 60 * 1000;

function fenetreDuService() {
  const debutDuReport = new Date(Date.now() - REPORT_MS);
  return {
    [Op.or]: [
      { orderDate: businessDay() },
      {
        [Op.and]: [
          { orderDate: veille() },
          { createdAt: { [Op.gte]: debutDuReport } },
        ],
      },
    ],
  };
}

/**
 * La reference d'un envoi, si elle est bien formee.
 *
 * On exige un UUID plutot que n'importe quelle chaine : une reference
 * choisie librement par un client finirait par se repeter — un compteur
 * remis a zero, deux postes qui demarrent sur la meme valeur — et deux
 * ventes distinctes se confondraient en une seule. Une chaine mal formee
 * est ignoree, pas refusee : mieux vaut une vente enregistree sans
 * protection qu'une vente perdue au comptoir.
 */
const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reference(valeur) {
  const ref = String(valeur ?? '').trim().toLowerCase();
  return FORME_UUID.test(ref) ? ref : null;
}

/**
 * Le plus grand numero deja pris pour cette journee.
 *
 * « Pris » couvre deux choses, et c'est tout l'interet : les ventes
 * enregistrees, et les tranches mises de cote pour un poste hors ligne.
 * Une caisse privee de reseau pioche dans sa tranche ; si le serveur
 * ignorait ces tranches, il attribuerait les memes numeros a ceux qui
 * sont encore connectes, et les deux tickets « 42 » reviendraient par
 * la fenetre.
 *
 * Le filtre d'etablissement est explicite : une agregation ne passe pas
 * par les crochets de cloisonnement, et sans lui le compteur repartirait
 * de celui du restaurant voisin.
 */
async function plusGrandNumeroPris(orderDate) {
  const [desVentes, desTranches] = await Promise.all([
    Order.max('orderNumber', { where: { orderDate, ...filtreEtablissement() } }),
    NumberReservation.max('jusqua', { where: { orderDate, ...filtreEtablissement() } }),
  ]);
  return Math.max(
    Number.isFinite(desVentes) ? desVentes : 0,
    Number.isFinite(desTranches) ? desTranches : 0,
  );
}

/**
 * Ou commencent les numeros mis de cote pour une coupure.
 *
 * **En hauteur, et c'est tout l'interet.** La caisse reserve sa tranche
 * des l'ouverture, avant la premiere vente. Prise au plus bas, elle
 * occupait 1 a 30 — et la premiere commande du jour portait le numero
 * 31, tous les jours, sans explication visible. Un gerant qui compte
 * ses tickets le soir s'interroge, et il a raison.
 *
 * Posee a 300, elle ne gene plus personne : la journee repart a 1, les
 * numeros du bas se remplissent normalement, et les ventes faites
 * pendant une coupure portent des numeros nettement a part — ce qui est
 * plutot commode le jour ou il faut les retrouver.
 *
 * Un service qui depasserait 300 ventes saute par-dessus la tranche et
 * reprend apres. C'est rare, c'est visible, et c'est sans danger.
 */
const DEPART_RESERVE = 300;

/**
 * Le prochain numero libre pour une vente en ligne.
 *
 * « Libre » veut dire : pas deja servi, et pas a l'interieur d'une
 * tranche mise de cote. On ne prend donc pas bêtement le plus grand
 * plus un — sinon une tranche posee a 300 ferait commencer la journee
 * a 331.
 */
async function getNextOrderNumber(orderDate) {
  const servis = await Order.max('orderNumber', {
    where: { orderDate, ...filtreEtablissement() },
  });
  let candidat = (Number.isFinite(servis) ? servis : 0) + 1;

  const tranches = await NumberReservation.findAll({
    where: { orderDate },
    order: [['depuis', 'ASC']],
  });
  for (const t of tranches) {
    if (candidat >= t.depuis && candidat <= t.jusqua) candidat = t.jusqua + 1;
  }
  return candidat;
}

/**
 * Le numero propose par un poste, s'il lui appartient vraiment.
 *
 * Un poste hors ligne a pioche dans la tranche qu'on lui a reservee, et
 * il la rend ici. On verifie qu'elle existe : sans ce controle,
 * n'importe quel appel pourrait choisir son numero et ecraser celui du
 * voisin — ou se donner le « 1 » en plein service.
 *
 * Un numero qui ne correspond a aucune tranche est ignore, pas refuse :
 * la vente a eu lieu, l'argent est dans le tiroir, et la perdre pour
 * une histoire de numerotation serait le pire des deux maux. Elle
 * prend alors le numero suivant, comme n'importe quelle vente.
 */
async function numeroReserve(valeur, orderDate) {
  const numero = Number(valeur);
  if (!Number.isInteger(numero) || numero < 1) return null;

  const tranche = await NumberReservation.findOne({
    where: {
      orderDate,
      depuis: { [Op.lte]: numero },
      jusqua: { [Op.gte]: numero },
    },
  });
  if (!tranche) return null;

  // Deja servi : une vente rejouee sans sa reference, ou un poste qui a
  // perdu le fil de sa tranche. On ne reprend pas un numero en service.
  const occupe = await Order.findOne({ where: { orderDate, orderNumber: numero } });
  return occupe ? null : numero;
}

/**
 * Quand la vente a eu lieu, et a quelle journee commerciale elle
 * appartient.
 *
 * Une heure absente, dans le futur, ou vieille de plus d'une journee ne
 * vient pas d'une coupure de reseau mais d'une horloge deregle : on
 * garde alors l'heure d'arrivee, qui est au moins vraie.
 */
const RETARD_MAX_MS = 24 * 60 * 60 * 1000;

function momentDeLaVente(valeur) {
  const maintenant = new Date();
  const annonce = valeur ? new Date(valeur) : null;
  const plausible =
    annonce &&
    !Number.isNaN(annonce.getTime()) &&
    annonce <= maintenant &&
    maintenant - annonce <= RETARD_MAX_MS;

  const priseA = plausible ? annonce : maintenant;
  return { orderDate: businessDay(priseA), priseA };
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
    clientRef: req.body.clientRef,
    orderNumber: req.body.orderNumber,
    priseA: req.body.priseA,
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

    /**
     * Une vente deja encaissee, au comptoir, sans reseau.
     *
     * Hors ligne, le caissier fait les deux gestes d'affilee : il prend
     * la commande et il prend l'argent. Les rejouer en deux appels au
     * retour du reseau ouvrait une faille : si la creation passait et
     * que l'encaissement echouait, la vente revenait « a encaisser »
     * dans la file — et le client, deja parti, payait une seconde fois
     * par le suivant qui prenait son numero.
     *
     * L'encaissement voyage donc avec la vente, dans la meme requete.
     * Une reference, une seule reponse, et rien a recoller.
     */
    const paiement = encaissementAnnonce(req.body.paiement);

    const order = await createOrderWithItems({
      items,
      clientRef: req.body.clientRef,
      orderNumber: req.body.orderNumber,
      priseA: req.body.priseA,
      source: 'counter',
      fulfillmentType: fulfillmentType || 'dine_in',
      status: 'awaiting_payment',
      cashierId: req.user.id,
      // Pour rappeler le client quand c'est pret, a emporter surtout.
      customerName: req.body.customerName,
      customerPhone: req.body.customerPhone,
    });

    // `status` encore en attente : la vente vient d'etre creee, et non
    // retrouvee par sa reference. Une vente deja encaissee ne se
    // reencaisse pas — c'est ce qui rend l'envoi rejouable.
    if (paiement && order.status === 'awaiting_payment') {
      const servi = await encaisser(order, paiement.methode, req.user.id, paiement.quand);
      return res.status(201).json(servi);
    }

    socket.emitNewKitchenTicket(order);
    res.status(201).json(order);
  }
);

/** Un encaissement annonce par un poste, s'il est exploitable. */
const MOYENS = ['cash', 'card', 'transfer'];

function encaissementAnnonce(valeur) {
  if (!valeur || typeof valeur !== 'object') return null;
  const methode = MOYENS.includes(valeur.methode) ? valeur.methode : 'cash';
  const quand = valeur.quand ? new Date(valeur.quand) : null;
  return {
    methode,
    quand: quand && !Number.isNaN(quand.getTime()) && quand <= new Date() ? quand : new Date(),
  };
}

/**
 * Authentification facultative.
 *
 * Un jeton valide identifie le client ; son absence ne bloque pas. Le
 * cas vise est celui du code a scanner pose sur les tables : personne
 * ne cree un compte assis au comptoir, et une inscription imposee a ce
 * moment-la fait perdre la commande.
 */
function authFacultative(req, res, next) {
  const entete = req.headers.authorization;
  if (!entete || !entete.startsWith('Bearer ')) return next();
  return requireAuth(req, res, next);
}

// --- Creation d'une commande en ligne, avec choix retrait/livraison ---
router.post(
  '/online',
  authFacultative,
  // Sans compte, c'est une porte ouverte : on la limite comme celle de
  // la borne. Trente commandes par quart d'heure et par adresse, bien
  // au-dela du rythme d'une vraie salle.
  throttle('commande-en-ligne', { max: 30, windowMs: 15 * 60 * 1000 }),
  async (req, res) => {
  const {
    items, fulfillmentType, deliveryAddress, deliveryLat, deliveryLng,
    deliveryZoneId, customerName, customerPhone,
  } = req.body;

  /**
   * Sans compte, le nom et le telephone sont exiges.
   *
   * Le telephone n'est pas une formalite : c'est le seul moyen de
   * joindre quelqu'un dont la commande pose probleme — un plat epuise
   * en cours de preparation, une adresse introuvable. Une commande
   * anonyme et injoignable ne sert personne.
   */
  if (!req.user) {
    const { commandeSansCompte } = await getSettings();
    if (commandeSansCompte !== 'oui') {
      throw new HttpError(401, 'Connectez-vous pour commander en ligne.');
    }
    if (!customerName || String(customerName).trim().length < 2) {
      throw badRequest('Indiquez votre nom.');
    }
    const tel = String(customerPhone || '').replace(/[^\d+]/g, '');
    if (tel.length < 8) {
      throw badRequest('Indiquez un numero de telephone joignable.');
    }
  }

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

  /**
   * Ou part la commande.
   *
   * Quand l'etablissement ne tient pas de comptoir, la faire attendre un
   * encaissement revient a ne jamais la preparer : elle s'empile dans
   * une file de caisse que personne ne regarde, pendant que le client
   * attend a sa table. Elle part alors directement en preparation et se
   * paie a la remise.
   */
  const reglagesService = await getSettings();
  const directEnCuisine = reglagesService.commandesEnLigne === 'cuisine';
  const etatInitial = directEnCuisine
    ? reglagesService.etapesCuisine === 'aucune'
      ? 'ready'
      : 'in_kitchen'
    : 'awaiting_payment';

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
    clientRef: req.body.clientRef,
    source: 'online',
    fulfillmentType,
    status: etatInitial,
    // Sans compte, la commande n'a pas de proprietaire : seuls le nom
    // et le telephone saisis la rattachent a quelqu'un.
    customerId: req.user?.id ?? null,
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

  // Elle doit atteindre les ecrans qui l'attendent : sans ces signaux,
  // la cuisine ne verrait le ticket qu'au prochain rechargement.
  if (directEnCuisine) {
    await deductStockForOrderItems(order.items, order.id);
    socket.emitNewKitchenTicket(order);
    socket.emitBoard(order);
  }

  res.status(201).json(order);
  }
);

async function createOrderWithItems(opts) {
  const {
    items, source, fulfillmentType, status, customerId,
    customerName, customerPhone,
    deliveryAddress, deliveryLat, deliveryLng, deliveryZoneId,
    deliveryFee = 0, minimumOrder = 0, zoneName,
  } = opts;

  /**
   * Un envoi rejoue n'aboutit qu'une fois.
   *
   * Une caisse qui encaisse puis perd la reponse — reseau coupe,
   * serveur qui redemarre — n'avait aucun moyen de savoir si la vente
   * etait passee. Le caissier retentait, et vendait deux fois ; le
   * client, lui, recevait deux tickets avec deux numeros differents
   * pour un seul sandwich.
   *
   * Le poste donne donc une reference a sa vente **avant** de
   * l'envoyer. Si elle est deja la, on rend celle qui existe. Le
   * controle est double : ici, pour repondre proprement, et un index
   * unique en base, pour le cas ou deux tentatives arriveraient dans
   * la meme seconde — la verification seule laisserait passer les
   * deux.
   */
  const clientRef = reference(opts.clientRef);
  if (clientRef) {
    const deja = await Order.findOne({ where: { clientRef } });
    if (deja) return getFullOrder(deja.id);
  }

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

  /**
   * La journee d'une vente, et son heure.
   *
   * Une vente encaissee hors ligne arrive au serveur bien apres avoir
   * ete faite. Sans son heure reelle, elle porterait celle du retour du
   * reseau : la cuisine verrait un ticket « a l'instant » pour un
   * sandwich prepare il y a vingt minutes, et le journal du gerant
   * entasserait tout le creux de la coupure sur une seule minute.
   *
   * Le poste envoie donc ce qu'il a note. On ne lui fait pas une
   * confiance aveugle : une heure dans le futur, ou vieille de plus
   * d'une journee, ne vient pas d'une coupure mais d'une horloge
   * deregle — on garde alors l'heure d'arrivee, qui est au moins vraie.
   */
  const { orderDate, priseA } = momentDeLaVente(opts.priseA);

  // Deux commandes prises dans la meme seconde peuvent viser le meme
  // numero. L'index unique les departage et on retente, plutot que de
  // laisser deux tickets « 12 » circuler en salle.
  const reserve = await numeroReserve(opts.orderNumber, orderDate);

  let order = null;
  for (let attempt = 1; attempt <= 5 && !order; attempt++) {
    try {
      order = await Order.create({
        orderNumber: reserve ?? (await getNextOrderNumber(orderDate)),
        orderDate,
        createdAt: priseA,
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
        clientRef,
      });
    } catch (err) {
      if (err.name !== 'SequelizeUniqueConstraintError' || attempt === 5) throw err;
      /**
       * Deux contraintes uniques peuvent sauter ici, et elles
       * n'appellent pas la meme reponse.
       *
       * Le numero du jour : deux ventes prises dans la meme seconde
       * ont vise le meme. On retente, et la seconde prend le suivant.
       *
       * La reference de l'envoi : la vente vient d'etre enregistree
       * par une tentative parallele. Retenter ne ferait que rejouer
       * le meme echec — on rend celle qui existe, ce que le poste
       * attendait depuis le debut.
       */
      if (clientRef) {
        const concurrente = await Order.findOne({ where: { clientRef } });
        if (concurrente) return getFullOrder(concurrente.id);
      }
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
 * Bornee a la fenetre du service : une commande prise a la borne puis
 * abandonnee par le client reste « en attente de paiement » pour
 * toujours. Sans borne, la file grossit de jour en jour et le caissier
 * finit par chercher la commande du moment au milieu de celles de la
 * semaine.
 *
 * Voir `fenetreDuService` pour le detail — et pour les deux versions
 * qui s'y sont cassees avant celle-ci.
 */
router.get('/pending-payment', requireAuth, requireRole('cashier', 'manager', 'admin', 'super_admin'), async (req, res) => {
  const orders = await Order.findAll({
    where: {
      status: 'awaiting_payment',
      ...fenetreDuService(),
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

  res.json(await encaisser(order, methode, req.user.id));
});

/**
 * Ce qui se passe quand une commande est payee.
 *
 * Extrait de la route pour que la vente encaissee hors ligne suive
 * exactement le meme chemin a son retour : meme destination, meme
 * deduction de stock, memes annonces aux ecrans. Deux chemins
 * d'encaissement qui divergent, c'est un stock juste d'un cote et faux
 * de l'autre, et personne ne sait lequel croire.
 *
 * `quand` permet de garder l'heure reelle du paiement : un encaissement
 * fait pendant la coupure ne doit pas apparaitre a l'heure du retour du
 * reseau dans le journal du gerant.
 */
async function encaisser(order, methode, cashierId, quand = null) {
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
  order.paidAt = quand ?? new Date();
  order.cashierId = cashierId;
  order.isParked = false;
  await order.save();

  // Deduction du stock au moment ou la commande part reellement en preparation
  await deductStockForOrderItems(order.items, order.id);

  socket.emitOrderStatusChanged(order);
  socket.emitNewKitchenTicket(order);
  socket.emitBoard(order);

  return order;
}

/**
 * Mettre des numeros de cote, pour tenir sans reseau.
 *
 * Une caisse ne choisit pas le moment ou l'ADSL tombe. Tant qu'elle est
 * connectee, elle se fait donc reserver une tranche d'avance — « les
 * numeros 51 a 80 sont a toi » — et elle y pioche le jour ou la
 * connexion lache. Le serveur, lui, ne les attribue plus a personne.
 *
 * **Une tranche courte, renouvelee souvent.** Chaque tranche non
 * consommee laisse un trou dans la numerotation du jour : reserver cent
 * numeros pour en servir trois ferait sauter le compteur de 1 a 101 au
 * premier service. Trente couvrent largement une coupure d'ADSL, et la
 * caisse en redemande des qu'elle en a brule la moitie.
 *
 * Le poste est un identifiant d'appareil, pas de personne : c'est la
 * tablette qui travaille hors ligne, et elle garde ses numeros si le
 * caissier change en cours de service.
 */
const TRANCHE_MAX = 60;
const TRANCHE_DEFAUT = 30;

router.post(
  '/reserver-numeros',
  requireAuth,
  requireRole('cashier', 'manager', 'admin', 'super_admin'),
  async (req, res) => {
    const poste = String(req.body.poste ?? '').trim().slice(0, 80);
    if (!poste) {
      return res.status(400).json({ error: 'Poste non identifie.' });
    }
    const combien = Math.min(
      TRANCHE_MAX,
      Math.max(1, Number(req.body.combien) || TRANCHE_DEFAUT),
    );

    const orderDate = businessDay();

    /**
     * Deux caisses qui demandent leur tranche en meme temps doivent
     * recevoir des tranches disjointes. L'index unique sur le numero
     * ne protege que les ventes, pas les reservations : on serialise
     * donc la lecture et l'ecriture dans une transaction, en verrouillant
     * la table des reservations du jour.
     */
    const tranche = await sequelize.transaction(async (t) => {
      await sequelize.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        { bind: [`numeros:${restaurantCourant() ?? 'global'}:${orderDate}`], transaction: t },
      );
      // En hauteur : une tranche posee au plus bas ferait commencer la
      // journee a 31, tous les jours, sans explication visible.
      const depuis = Math.max(await plusGrandNumeroPris(orderDate), DEPART_RESERVE - 1) + 1;
      return NumberReservation.create(
        { orderDate, depuis, jusqua: depuis + combien - 1, poste },
        { transaction: t },
      );
    });

    res.status(201).json({
      orderDate,
      depuis: tranche.depuis,
      jusqua: tranche.jusqua,
      poste: tranche.poste,
    });
  },
);

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
    where: {
      status: ['in_kitchen', 'preparing', 'ready'],
      ...fenetreDuService(),
    },
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
        ...fenetreDuService(),
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
    where: {
      status: ['in_kitchen', 'preparing', 'ready'],
      ...fenetreDuService(),
    },
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
/**
 * Une commande, pour qui en detient l'adresse.
 *
 * Avec un compte, rien ne change. Sans compte, le suivi doit pourtant
 * rester accessible : quelqu'un qui scanne le code pose sur sa table
 * commande sans s'inscrire, et c'est precisement lui qui a besoin de
 * voir ou en est sa commande.
 *
 * L'ouverture est donc limitee aux commandes qui n'appartiennent a
 * aucun compte. Celles d'un client inscrit restent derriere sa session.
 * L'identifiant est un UUID tire au sort : il ne se devine pas, et
 * c'est le meme principe que le lien de suivi de n'importe quelle
 * livraison. Ce qu'il revele est ce que son destinataire a lui-meme
 * saisi, et rien d'autre : aucune autre commande n'est atteignable.
 */
router.get('/:id', authFacultative, async (req, res) => {
  const order = await getFullOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

  if (!req.user && order.customerId) {
    return res.status(401).json({
      error: 'Connectez-vous pour consulter cette commande.',
    });
  }

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
