const jwt = require('jsonwebtoken');
const { Restaurant } = require('../models/Restaurant');
const { avecRestaurant } = require('../tenant');

/**
 * De quel etablissement depend une requete sans session.
 *
 * La borne, l'ecran de salle et la carte en ligne n'ont personne de
 * connecte : rien dans la requete ne dit, a priori, dans quel fastfood
 * on se trouve. Sans cette resolution, une borne posee a Gabes
 * afficherait la carte de celui de Sfax — ou, pire, les deux melangees.
 *
 * Trois sources, dans cet ordre :
 *   1. l'en-tete « X-Restaurant », pose par l'application quand elle
 *      sait ou elle est ;
 *   2. le parametre « restaurant » de l'adresse, qui permet de
 *      configurer une borne par un simple signet ;
 *   3. a defaut, l'unique etablissement — une installation qui n'en
 *      heberge qu'un seul continue de fonctionner sans rien changer,
 *      et c'est ce qui permet aux installations existantes de basculer
 *      sans toucher a leurs bornes.
 *
 * Quand il y en a plusieurs et qu'aucun n'est designe, on refuse
 * franchement plutot que d'en choisir un au hasard : servir la carte du
 * mauvais restaurant est pire qu'un message d'erreur.
 */

// Le repere d'une borne ne change pas d'une commande a l'autre.
let cacheUnique = null;
let cacheExpire = 0;

async function etablissementUnique() {
  if (cacheUnique && Date.now() < cacheExpire) return cacheUnique;
  const tous = await Restaurant.findAll({ attributes: ['id', 'isActive'], limit: 2 });
  cacheUnique = tous.length === 1 ? tous[0] : null;
  cacheExpire = Date.now() + 30_000;
  return cacheUnique;
}

function oublierCache() {
  cacheUnique = null;
  cacheExpire = 0;
}

/** Un etablissement designe par son identifiant ou par son repere lisible. */
function parRepere(valeur) {
  const v = String(valeur);
  return Restaurant.findOne({
    where: v.includes('-') && v.length === 36 ? { id: v } : { slug: v },
  });
}

async function trouver(req) {
  /**
   * Un jeton valide fait foi avant tout repere d'adresse.
   *
   * Certaines routes sont publiques parce que la borne en a besoin — la
   * carte, l'ecran de salle — mais elles sont aussi appelees par des
   * gens connectes : le gerant qui consulte sa carte passe par la meme
   * adresse que la borne de sa salle. Sans lire son jeton, il faudrait
   * qu'il precise son propre restaurant a chaque requete.
   */
  const entete = req.headers.authorization;
  if (entete && entete.startsWith('Bearer ')) {
    try {
      const charge = jwt.verify(entete.slice(7), process.env.JWT_SECRET);
      if (charge.restaurantId) {
        return Restaurant.findByPk(charge.restaurantId);
      }
    } catch {
      // Jeton expire ou invalide : on ignore, la route decidera.
    }
  }

  const repere = req.headers['x-restaurant'] || req.query.restaurant;
  if (repere) {
    // Un identifiant ou un repere d'adresse : la borne peut etre
    // configuree avec l'un ou l'autre.
    return parRepere(repere);
  }
  return etablissementUnique();
}

function resoudreRestaurantPublic({ exiger = true } = {}) {
  return async (req, res, next) => {
    // Une session en cours fait foi : inutile de deviner.
    if (req.restaurantId) return next();

    let etablissement;
    try {
      etablissement = await trouver(req);
    } catch (err) {
      return next(err);
    }

    if (!etablissement) {
      if (!exiger) return next();
      return res.status(400).json({
        error:
          'Cette installation heberge plusieurs etablissements : indiquez lequel.',
      });
    }

    if (!etablissement.isActive) {
      return res.status(403).json({ error: 'Cet etablissement est ferme.' });
    }

    req.restaurantId = etablissement.id;
    req.restaurant = etablissement;
    return avecRestaurant(etablissement.id, next);
  };
}

module.exports = { resoudreRestaurantPublic, oublierCache, etablissementUnique, parRepere };
