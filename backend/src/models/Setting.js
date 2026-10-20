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
const { badRequest } = require('../errors');

/** Valeurs de depart, utilisees tant que rien n'a ete saisi. */
const DEFAULTS = {
  restaurantName: 'Mon restaurant',
  address: '',
  phone: '',
  taxId: '',
  ticketFooter: 'Merci de votre visite',
  currency: 'DT',

  // Fond de carte du suivi de livraison.
  //
  // Le serveur public d'OpenStreetMap est tenu par des benevoles : sa
  // politique d'usage le reserve a un trafic modeste et il renvoie des
  // tuiles « Access blocked » des qu'une application en demande trop.
  // Il convient pour essayer le logiciel ; une installation qui tourne
  // vraiment doit renseigner ici l'adresse de son propre fournisseur,
  // cle comprise, sans quoi les livreurs se retrouvent devant un carre
  // gris. C'est pour cela que l'adresse est un reglage et non une
  // constante dans le code : le gerant la change sans redeploiement.
  mapTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapAttribution: '© OpenStreetMap',

  // --- Deroule du service ---
  //
  // Tous les etablissements ne travaillent pas de la meme facon, et le
  // meme etablissement ne travaille pas pareil a midi et a 22 h. Un
  // fastfood qui sort un sandwich en deux minutes n'a que faire de
  // « en preparation » puis « pret » : c'est deux gestes de plus a
  // chaque commande, pour une information que personne ne lit. Et
  // certains soirs il n'y a ni caissier ni livreur.
  //
  // Imposer un deroule unique obligerait chaque client a s'y plier ou a
  // laisser trainer des commandes dans un etat que plus personne ne fait
  // avancer. Ces trois reglages se changent en plein service.

  // 'deux'   : en preparation, puis pret — pour une cuisine qui mijote
  // 'une'    : un seul bouton « Termine » — le rythme d'un fastfood
  // 'aucune' : pas d'ecran cuisine, la commande est prete des l'encaissement
  etapesCuisine: 'deux',

  // 'non' : la livraison disparait de la borne et du site, et les
  // commandes deja en cours restent livrables — on ne laisse pas un
  // client en plan parce qu'un reglage a change pendant sa commande.
  livraisonActive: 'oui',

  // 'oui' : un seul geste encaisse, sans ouvrir de session ni choisir un
  // moyen de paiement. Pour les services sans caissier, ou le gerant
  // confirme lui-meme entre deux clients.
  caisseSimplifiee: 'non',
};

/** Reglages a choix ferme : une valeur inventee est refusee, pas enregistree. */
const CHOIX = {
  etapesCuisine: ['deux', 'une', 'aucune'],
  livraisonActive: ['oui', 'non'],
  caisseSimplifiee: ['oui', 'non'],
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

    // Un choix ferme mal orthographie laisserait le service dans un etat
    // qu'aucun ecran ne sait afficher : mieux vaut refuser tout de suite.
    if (CHOIX[key] && !CHOIX[key].includes(String(value))) {
      throw badRequest(
        `Valeur refusee pour ${key} : attendu ${CHOIX[key].join(', ')}.`
      );
    }

    await Setting.upsert({ key, value: String(value ?? '').slice(0, MAX_TEXT) });
  }
  return getSettings();
}

module.exports = { Setting, getSettings, saveSettings, DEFAULTS, CHOIX };
