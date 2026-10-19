const jwt = require('jsonwebtoken');

/**
 * Temps reel.
 *
 * Salles utilisees :
 * - "kitchen"      -> ecran cuisine
 * - "cashier"      -> postes caissiers
 * - "manager"      -> tableau de bord gerant
 * - "drivers"      -> livreurs disponibles
 * - "order_<id>"   -> suivi d'une commande precise, cote client
 * - "driver_<id>"  -> un livreur precis
 *
 * Chaque salle est protegee. Sans cela, n'importe qui pouvait ouvrir une
 * connexion sur l'adresse publique, demander la salle « cuisine » et
 * recevoir en direct toutes les commandes du restaurant : contenu,
 * montants, et pour les livraisons l'adresse du client. Un navigateur et
 * trois lignes suffisaient.
 */

let ioInstance = null;

const STAFF = ['manager', 'admin', 'super_admin'];

/** Qui a le droit d'entrer dans quelle salle. */
const ROOMS = [
  { pattern: /^kitchen$/, roles: ['cook', ...STAFF] },
  { pattern: /^cashier$/, roles: ['cashier', ...STAFF] },
  { pattern: /^manager$/, roles: STAFF },
  { pattern: /^drivers$/, roles: ['driver', ...STAFF] },
  // Salle personnelle d'un livreur : la sienne, pas celle d'un collegue.
  { pattern: /^driver_(.+)$/, roles: ['driver', ...STAFF], ownId: true },
  // Suivi d'une commande : le personnel, ou le client qui l'a passee.
  { pattern: /^order_(.+)$/, order: true },
];

function identify(socket) {
  const token = socket.handshake?.auth?.token;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null; // jeton expire ou falsifie : traite comme un anonyme
  }
}

async function mayJoin(user, room) {
  const rule = ROOMS.find((r) => r.pattern.test(room));
  if (!rule) return false; // salle inconnue : on n'ouvre rien par defaut
  if (!user) return false;

  const id = room.match(rule.pattern)?.[1];

  if (rule.order) {
    const { Order } = require('../models');
    if ([...STAFF, 'cook', 'cashier', 'driver'].includes(user.role)) return true;
    const order = await Order.findByPk(id);
    return Boolean(order) && order.customerId === user.id;
  }

  if (!rule.roles.includes(user.role)) return false;
  // Un livreur n'entre que dans sa propre salle ; un gerant peut suivre.
  if (rule.ownId && user.role === 'driver' && id !== user.id) return false;

  return true;
}

function init(server) {
  const { Server } = require('socket.io');
  // En production le client est servi par ce meme serveur (meme origine) ;
  // ALLOWED_ORIGINS permet d'autoriser explicitement d'autres domaines.
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  ioInstance = new Server(server, {
    cors: {
      origin:
        process.env.NODE_ENV === 'production'
          ? allowed.length > 0
            ? allowed
            : true // meme origine uniquement
          : '*',
    },
  });

  // La connexion reste ouverte a tous : la borne et la carte publique en
  // ont besoin. C'est l'entree dans une salle qui est controlee.
  ioInstance.use((socket, next) => {
    socket.user = identify(socket);
    next();
  });

  ioInstance.on('connection', (socket) => {
    socket.on('join', async (room) => {
      if (typeof room !== 'string' || room.length > 80) return;
      if (await mayJoin(socket.user, room)) {
        socket.join(room);
      } else {
        socket.emit('room:refused', { room });
      }
    });

    socket.on('leave', (room) => {
      if (typeof room === 'string') socket.leave(room);
    });

    /**
     * Position du livreur pendant une course.
     *
     * Verifie cote serveur : sinon n'importe qui pouvait envoyer une
     * fausse position sur le suivi d'une commande et promener le client.
     */
    socket.on('driver:location', async ({ orderId, lat, lng }) => {
      if (socket.user?.role !== 'driver') return;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      const { Order } = require('../models');
      const order = await Order.findByPk(orderId);
      if (!order || order.driverId !== socket.user.id) return;

      ioInstance.to(`order_${orderId}`).emit('delivery:location_update', { lat, lng });
    });
  });

  return ioInstance;
}

function getIo() {
  if (!ioInstance) throw new Error('Socket.io non initialise.');
  return ioInstance;
}

// --- Evenements metier ---

function emitNewKitchenTicket(order) {
  getIo().to('cashier').to('manager').emit('order:new', order);
  if (order.status !== 'awaiting_payment') {
    getIo().to('kitchen').emit('kitchen:new_ticket', order);
  }
}

function emitOrderStatusChanged(order) {
  getIo().to(`order_${order.id}`).emit('order:status_changed', { orderId: order.id, status: order.status });
  getIo().to('kitchen').to('cashier').to('manager').emit('order:updated', order);
}

function emitDeliveryAvailable(order) {
  getIo().to('drivers').emit('delivery:new_available', order);
}

function emitDeliveryTaken(orderId, driverId) {
  getIo().to('drivers').emit('delivery:taken', { orderId, driverId });
}

function emitStockAlert(ingredient) {
  getIo().to('manager').emit('stock:low_alert', ingredient);
}

module.exports = {
  init,
  getIo,
  emitNewKitchenTicket,
  emitOrderStatusChanged,
  emitDeliveryAvailable,
  emitDeliveryTaken,
  emitStockAlert,
};
