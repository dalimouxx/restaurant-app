const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CashSession = sequelize.define('CashSession', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  cashierId: { type: DataTypes.UUID, allowNull: false },
  openingFloat: { type: DataTypes.FLOAT, allowNull: false }, // fond de caisse au debut
  closingAmount: { type: DataTypes.FLOAT, allowNull: true }, // montant compte a la fermeture
  expectedAmount: { type: DataTypes.FLOAT, allowNull: true }, // fond + ventes cash attendues
  discrepancy: { type: DataTypes.FLOAT, allowNull: true }, // ecart
  openedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  closedAt: { type: DataTypes.DATE, allowNull: true },
  /** Detail du comptage de cloture : combien de chaque coupure. Garde pour
   *  qu'un ecart puisse etre reconstitue le lendemain. */
  countBreakdown: { type: DataTypes.JSONB, allowNull: true },

  isOpen: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'cash_sessions',
  timestamps: true,
});

module.exports = CashSession;
