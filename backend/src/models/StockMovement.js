const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StockMovement = sequelize.define('StockMovement', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  ingredientId: { type: DataTypes.UUID, allowNull: false },
  type: {
    type: DataTypes.ENUM('sale_deduction', 'restock', 'adjustment', 'waste'),
    allowNull: false,
  },
  quantity: { type: DataTypes.FLOAT, allowNull: false }, // negatif pour deduction, positif pour reappro
  relatedOrderId: { type: DataTypes.UUID, allowNull: true },
  note: { type: DataTypes.STRING },
}, {
  tableName: 'stock_movements',
  timestamps: true,
});

module.exports = StockMovement;
