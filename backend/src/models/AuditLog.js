const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Registre des operations sensibles : annulations, changements de prix,
 * retraits de la carte, clotures de caisse avec ecart.
 *
 * Le registre ne s'ecrit qu'en ajout. Aucune route ne le modifie ni ne le
 * supprime, et c'est tout l'interet : une ligne de caisse qu'on peut
 * effacer ne prouve rien. C'est la seule facon de savoir qui a annule la
 * commande de 40 dinars un vendredi soir.
 *
 * Le nom et le role de l'auteur sont figes au moment du fait, pas lus par
 * jointure : un employe peut quitter l'entreprise, le registre doit rester
 * lisible des annees apres.
 */
const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

  userId: { type: DataTypes.UUID, allowNull: true },
  userName: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Inconnu' },
  userRole: { type: DataTypes.STRING, allowNull: false, defaultValue: 'inconnu' },

  /** Cle technique stable : 'order.cancelled', 'product.price_changed'... */
  action: { type: DataTypes.STRING, allowNull: false },

  entityType: { type: DataTypes.STRING, allowNull: true },
  entityId: { type: DataTypes.UUID, allowNull: true },

  /** Phrase lisible, figee a l'ecriture, pour que le journal se lise sans
   *  avoir a reconstituer le contexte d'il y a six mois. */
  summary: { type: DataTypes.STRING, allowNull: false },

  /** Montants, anciennes et nouvelles valeurs. */
  details: { type: DataTypes.JSONB, allowNull: true },

  ipAddress: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: 'audit_logs',
  timestamps: true,
  updatedAt: false, // une ligne de registre ne se modifie pas
});

module.exports = AuditLog;
