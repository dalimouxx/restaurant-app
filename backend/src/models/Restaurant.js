const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Un etablissement.
 *
 * Plusieurs fastfoods vivent dans la meme installation : chaque donnee
 * porte le sien, et ce modele est le seul a ne pas etre cloisonne —
 * c'est lui qui definit les cloisons.
 *
 * Le `slug` est ce qui permet a une borne ou a un ecran de salle de dire
 * de quel etablissement ils dependent. Ces deux ecrans n'ont pas de
 * session : sans repere dans l'adresse, une borne posee a Gabes
 * afficherait la carte du restaurant de Sfax.
 *
 * `isActive` a une consequence immediate : un etablissement desactive
 * n'accepte plus de commande et ses equipes ne peuvent plus se
 * connecter. Ses donnees restent — on suspend un client qui ne paie
 * pas, on ne lui efface pas sa comptabilite.
 */
const Restaurant = sequelize.define('Restaurant', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

  name: { type: DataTypes.STRING, allowNull: false },

  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      is: {
        args: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
        msg: 'Le repere doit etre en minuscules, chiffres et tirets.',
      },
    },
  },

  // Image reduite cote navigateur puis stockee en base, comme les photos
  // de plats : pas d'hebergement de fichiers a administrer chez le
  // client, et la sauvegarde emporte les logos avec le reste.
  logoUrl: { type: DataTypes.TEXT, allowNull: true },

  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

  // Pour s'y retrouver quand il y en aura trente.
  notes: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: 'restaurants',
  timestamps: true,
});

/** Repere d'adresse propre, a partir d'un nom saisi librement. */
function slugifier(nom) {
  return String(nom || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'restaurant';
}

module.exports = { Restaurant, slugifier };
