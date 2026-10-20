const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OrderItem = sequelize.define('OrderItem', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orderId: { type: DataTypes.UUID, allowNull: false },
  productId: { type: DataTypes.UUID, allowNull: false },
  productNameSnapshot: { type: DataTypes.STRING, allowNull: false }, // au cas ou le produit change de nom plus tard
  unitPrice: { type: DataTypes.FLOAT, allowNull: false },
  /** Temps de preparation du plat au moment de la commande. Fige, comme
   *  le nom et le prix : la recette peut changer, le ticket non. */
  prepMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  customization: { type: DataTypes.JSONB, defaultValue: {} }, // ex: { "sans": ["oignon"], "extra": ["fromage"] }
}, {
  tableName: 'order_items',
  timestamps: false,
});

module.exports = OrderItem;
