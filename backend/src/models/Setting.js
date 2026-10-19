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

const { DEFAULT_HOURS, normalizeHours, openingState } = require('../openingHours');

/** Valeurs de depart, utilisees tant que rien n'a ete saisi. */
const DEFAULTS = {
  restaurantName: 'Mon restaurant',
  address: '',
  phone: '',
  taxId: '',
  ticketFooter: 'Merci de votre visite',
  currency: 'DT',
};

/** Les horaires sont un objet, pas une ligne de texte : ils ont leur place a part. */
const JSON_KEYS = { openingHours: { fallback: DEFAULT_HOURS, maxLength: 2000 } };

const MAX_TEXT = 500;

/**
 * Reglages complets : les valeurs enregistrees, completees par les defauts,
 * plus l'etat d'ouverture calcule — la borne, le site et l'ecran mural en
 * ont besoin, et aucun ne doit refaire le calcul de son cote.
 */
async function getSettings(now = new Date()) {
  const rows = await Setting.findAll();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const openingHours = normalizeHours(stored.openingHours);
  const text = Object.fromEntries(
    Object.keys(DEFAULTS).map((k) => [k, stored[k] ?? DEFAULTS[k]])
  );

  return { ...text, openingHours, opening: openingState(openingHours, now) };
}

/** N'ecrit que les cles connues : une cle inventee est ignoree. */
async function saveSettings(patch) {
  const allowed = Object.keys(DEFAULTS);

  for (const [key, value] of Object.entries(patch || {})) {
    if (key in JSON_KEYS) {
      const serialized = JSON.stringify(normalizeHours(value));
      await Setting.upsert({ key, value: serialized.slice(0, JSON_KEYS[key].maxLength) });
      continue;
    }
    if (!allowed.includes(key)) continue;
    await Setting.upsert({ key, value: String(value ?? '').slice(0, MAX_TEXT) });
  }
  return getSettings();
}

module.exports = { Setting, getSettings, saveSettings, DEFAULTS };
