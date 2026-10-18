const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Reglages de l'etablissement, en cle/valeur : nom, adresse, telephone,
 * mentions du ticket, taux de TVA affiche.
 *
 * Stockes en base plutot qu'en variables d'environnement pour que le
 * gerant puisse les corriger lui-meme, sans redeploiement.
 */
const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
}, {
  tableName: 'settings',
  timestamps: true,
});

/** Valeurs de depart, utilisees tant que rien n'a ete saisi. */
const DEFAULTS = {
  restaurantName: 'Mon restaurant',
  address: '',
  phone: '',
  taxId: '',
  ticketFooter: 'Merci de votre visite',
  currency: 'DT',
};

/** Reglages complets : les valeurs enregistrees, completees par les defauts. */
async function getSettings() {
  const rows = await Setting.findAll();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored };
}

/** N'ecrit que les cles connues : une cle inventee est ignoree. */
async function saveSettings(patch) {
  const allowed = Object.keys(DEFAULTS);
  for (const [key, value] of Object.entries(patch || {})) {
    if (!allowed.includes(key)) continue;
    await Setting.upsert({ key, value: String(value ?? '').slice(0, 500) });
  }
  return getSettings();
}

module.exports = { Setting, getSettings, saveSettings, DEFAULTS };
