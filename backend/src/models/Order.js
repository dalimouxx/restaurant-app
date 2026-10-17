const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Order = sequelize.define('Order', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orderNumber: { type: DataTypes.INTEGER, allowNull: false }, // numero court affiche (#042)

  source: {
    // d'ou vient la commande
    type: DataTypes.ENUM('kiosk', 'counter', 'online'),
    allowNull: false,
    defaultValue: 'kiosk',
  },
  fulfillmentType: {
    // sur place / a emporter / livraison
    type: DataTypes.ENUM('dine_in', 'pickup', 'delivery'),
    allowNull: false,
    defaultValue: 'pickup',
  },

  status: {
    type: DataTypes.ENUM(
      'awaiting_payment',   // cree depuis la borne, en attente de passage caisse
      'paid',               // paye, pas encore transmis (transitoire)
      'in_kitchen',         // envoye en cuisine
      'preparing',
      'ready',
      'awaiting_driver',    // pret, en attente qu'un livreur accepte
      'out_for_delivery',
      'delivered',
      'completed',
      'cancelled'
    ),
    allowNull: false,
    defaultValue: 'awaiting_payment',
  },

  customerId: { type: DataTypes.UUID, allowNull: true }, // null si client au comptoir sans compte
  cashierId: { type: DataTypes.UUID, allowNull: true },
  driverId: { type: DataTypes.UUID, allowNull: true },

  subtotal: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  deliveryFee: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  tipAmount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  totalAmount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  paymentMethod: {
    type: DataTypes.ENUM('cash', 'card', 'cash_on_delivery'),
    allowNull: true,
  },
  paidAt: { type: DataTypes.DATE, allowNull: true },

  deliveryAddress: { type: DataTypes.STRING },
  deliveryLat: { type: DataTypes.FLOAT },
  deliveryLng: { type: DataTypes.FLOAT },

  qrToken: { type: DataTypes.STRING }, // QR scanne par le livreur pour confirmer la remise
}, {
  tableName: 'orders',
  timestamps: true,
});

module.exports = Order;
