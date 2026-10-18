const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Choix predefini attache a un produit, pour que personne n'ait a ecrire
 * une note libre : le caissier et le client ne font que toucher des
 * boutons, et la cuisine lit toujours le meme vocabulaire.
 *
 * Deux natures :
 *  - 'remove' : un retrait, toujours gratuit (sans oignon, sans salade)
 *  - 'add'    : un ajout, gratuit ou payant (extra fromage, sauce piquante)
 *
 * Un ajout peut etre rattache a un ingredient : la quantite indiquee est
 * alors deduite du stock en plus de la recette, sinon le benefice net
 * serait fausse. Un retrait rattache a un ingredient le rend au stock.
 */
const ProductOption = sequelize.define('ProductOption', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  productId: { type: DataTypes.UUID, allowNull: false },

  kind: {
    type: DataTypes.ENUM('remove', 'add'),
    allowNull: false,
  },

  /** Ce que lit la cuisine : « Oignon », « Fromage ». Le prefixe sans/extra
   *  est ajoute a l'affichage, pour garder un vocabulaire homogene. */
  label: { type: DataTypes.STRING, allowNull: false },

  /** Supplement facture, en dinars. Zero pour un choix gratuit. */
  extraPrice: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  /** Ingredient concerne, si le choix doit bouger le stock. */
  ingredientId: { type: DataTypes.UUID, allowNull: true },

  /** Quantite d'ingredient ajoutee (kind='add') ou rendue (kind='remove'). */
  quantityDelta: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  displayOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'product_options',
  timestamps: true,
});

module.exports = ProductOption;
