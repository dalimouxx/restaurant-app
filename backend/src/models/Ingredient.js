const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Represente un element de stock : ingredient, fromage, pain, pate, embalage, boisson brute, etc.
const Ingredient = sequelize.define('Ingredient', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  unit: {
    type: DataTypes.ENUM('g', 'kg', 'ml', 'l', 'piece'),
    allowNull: false,
    defaultValue: 'piece',
  },
  quantityInStock: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  alertThreshold: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 }, // seuil pour alerte stock bas
  costPerUnit: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 }, // cout d'achat, sert au calcul du benefice net
  supplierName: { type: DataTypes.STRING },
}, {
  tableName: 'ingredients',
  timestamps: true,
});

module.exports = Ingredient;
