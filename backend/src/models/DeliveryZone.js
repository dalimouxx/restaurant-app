const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Zone de livraison : un quartier, un tarif.
 *
 * Le tarif unique ecrit en dur dans le code faisait perdre de l'argent sur
 * les courses lointaines et en faisait gagner trop sur celles d'en face.
 * Le client choisit sa zone au moment de commander ; c'est elle qui fixe
 * les frais et, s'il y en a un, le minimum de commande.
 */
const DeliveryZone = sequelize.define('DeliveryZone', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

  name: { type: DataTypes.STRING, allowNull: false }, // « Centre-ville », « Chenini »

  fee: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  /** Montant minimum du panier pour livrer dans cette zone. Zero = aucun. */
  minimumOrder: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  /** Duree annoncee au client, en minutes. Indicative. */
  estimatedMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },

  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  displayOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  tableName: 'delivery_zones',
  timestamps: true,
});

module.exports = DeliveryZone;
