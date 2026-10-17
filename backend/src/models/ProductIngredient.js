const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// La "recette" : combien de chaque ingredient est necessaire pour 1 unite du produit.
// Permet la deduction automatique du stock a chaque vente.
const ProductIngredient = sequelize.define('ProductIngredient', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  productId: { type: DataTypes.UUID, allowNull: false },
  ingredientId: { type: DataTypes.UUID, allowNull: false },
  quantityNeeded: { type: DataTypes.FLOAT, allowNull: false }, // ex: 0.15 (kg de fromage) pour 1 pizza
}, {
  tableName: 'product_ingredients',
  timestamps: false,
});

module.exports = ProductIngredient;
