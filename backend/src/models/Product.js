const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Product = sequelize.define('Product', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  price: { type: DataTypes.FLOAT, allowNull: false },
  imageUrl: { type: DataTypes.STRING },
  isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true }, // bascule auto si un ingredient manque
  categoryId: { type: DataTypes.UUID, allowNull: false },
}, {
  tableName: 'products',
  timestamps: true,
});

module.exports = Product;
