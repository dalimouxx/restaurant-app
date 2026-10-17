let ioInstance = null;

// Salles (rooms) utilisees :
// - "kitchen"        -> ecran cuisine
// - "cashier"        -> postes caissiers
// - "manager"        -> tableau de bord gerant
// - "drivers"        -> tous les livreurs disponibles
// - "order_<id>"      -> suivi d'une commande precise (client)
// - "driver_<id>"     -> un livreur precis

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

  ioInstance.on('connection', (socket) => {
    socket.on('join', (room) => socket.join(room));
    socket.on('leave', (room) => socket.leave(room));

    // Le livreur envoie sa position en continu pendant une livraison en cours
    socket.on('driver:location', ({ driverId, orderId, lat, lng }) => {
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
  if (order.status === 'in_kitchen') {
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
