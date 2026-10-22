const { AsyncLocalStorage } = require('node:async_hooks');
const { DataTypes, Op } = require('sequelize');

/**
 * Cloisonnement entre restaurants.
 *
 * Une seule installation heberge plusieurs fastfoods. Chaque donnee
 * porte donc son restaurant, et chaque requete doit etre filtree.
 *
 * Le filtre n'est pas ecrit dans les cent une requetes du serveur, mais
 * pose ici, dans l'ORM. C'est deliberé : une requete ou le filtre aurait
 * ete oublie ne renverrait pas une erreur, elle renverrait les ventes du
 * restaurant d'a cote. Personne ne s'en apercevrait avant qu'un gerant
 * ne lise le chiffre d'affaires d'un concurrent dans son propre
 * tableau de bord. Avec un filtre automatique, l'oubli n'existe plus :
 * il faut au contraire demander explicitement a en sortir.
 *
 * Le restaurant courant voyage dans un stockage lie a la requete HTTP,
 * et non dans une variable partagee : deux commandes traitees en meme
 * temps pour deux restaurants differents ne doivent jamais se croiser.
 */
const stockage = new AsyncLocalStorage();

/** Execute `fn` au nom d'un restaurant : tout ce qui s'y passe est cloisonne. */
function avecRestaurant(restaurantId, fn) {
  return stockage.run({ restaurantId, global: false }, fn);
}

/**
 * Execute `fn` sans cloisonnement, pour les rares traitements qui
 * regardent l'installation entiere : la liste des restaurants du super
 * admin, les migrations, les sauvegardes. A n'employer qu'a bon escient.
 */
function surToutelInstallation(fn) {
  return stockage.run({ restaurantId: null, global: true }, fn);
}

function restaurantCourant() {
  return stockage.getStore()?.restaurantId ?? null;
}

function estGlobal() {
  return stockage.getStore()?.global === true;
}

/**
 * Pose le cloisonnement sur un modele.
 *
 * `beforeFind` ajoute le filtre a toute lecture, y compris celles qui
 * passent par findByPk ou par une association. `beforeCreate` inscrit le
 * restaurant sur toute ecriture. Les modifications et suppressions en
 * masse sont filtrees de la meme facon, sans quoi un « tout supprimer »
 * emporterait les donnees des autres.
 */
function cloisonner(model, { clePrimaire = false, partage = false } = {}) {
  /**
   * La colonne est ajoutee ici, et non dans les quatorze fichiers de
   * modeles. Un modele cloisonne sans sa colonne, ou l'inverse, serait
   * une incoherence silencieuse : ici les deux viennent ensemble, et
   * ajouter un modele a la liste suffit.
   */
  model.rawAttributes.restaurantId = {
    type: DataTypes.UUID,
    allowNull: true, // le temps de la reprise des donnees existantes
    field: 'restaurantId',
    // Pour les reglages, l'etablissement fait partie de la cle : deux
    // restaurants ont chacun leur « restaurantName ». Sans cela,
    // l'enregistrement par upsert ne sait pas sur quoi arbitrer, et
    // PostgreSQL refuse la requete.
    primaryKey: clePrimaire,
  };
  model.refreshAttributes();

  const appliquer = (options) => {
    if (estGlobal()) return;
    const id = restaurantCourant();

    /**
     * Pas de restaurant, et pas de demande explicite de travailler sur
     * l'installation entiere : c'est un oubli, et il doit s'entendre.
     *
     * Laisser passer renverrait les donnees de tous les etablissements
     * melangees — une fuite silencieuse qui ne se verrait qu'au jour ou
     * un gerant lirait le chiffre d'affaires d'un concurrent. Mieux vaut
     * une erreur franche au premier essai.
     */
    if (!id) {
      throw new Error(
        `Lecture de ${model.name} hors de tout etablissement. ` +
        'Passez par une session, par la resolution publique, ou declarez ' +
        'explicitement surToutelInstallation().'
      );
    }

    options.where = options.where || {};
    // Une requete qui vise explicitement un restaurant garde sa cible :
    // c'est le cas du super admin qui inspecte un etablissement precis.
    if (Object.prototype.hasOwnProperty.call(options.where, 'restaurantId')) return;

    /**
     * Modele partage : les lignes sans etablissement appartiennent a
     * tout le monde. C'est le cas des comptes clients — dans une chaine,
     * la meme personne commande chez plusieurs fastfoods, son compte est
     * commun et seules ses commandes portent l'etablissement. Les
     * employes, eux, ont toujours un restaurant : aucun risque qu'une
     * equipe apparaisse chez le voisin.
     */
    options.where.restaurantId = partage
      ? { [Op.or]: [id, null] }
      : id;
  };

  model.addHook('beforeFind', (options) => {
    appliquer(options);
    // Les tables liees doivent l'etre aussi : une commande filtree dont
    // on joint les lignes sans filtre ramenerait des lignes etrangeres.
    for (const inclusion of options.include || []) {
      if (inclusion && inclusion.model && inclusion.model.cloisonne) {
        appliquer(inclusion);
      }
    }
  });

  model.addHook('beforeCount', appliquer);
  model.addHook('beforeBulkUpdate', appliquer);
  model.addHook('beforeBulkDestroy', appliquer);

  const inscrire = (instance) => {
    if (estGlobal()) return;
    const id = restaurantCourant();
    if (id && !instance.restaurantId) instance.restaurantId = id;
  };
  model.addHook('beforeCreate', inscrire);
  model.addHook('beforeBulkCreate', (instances) => instances.forEach(inscrire));

  // Note : `upsert` ne peut pas etre rattrape par un crochet — Sequelize
  // construit sa requete avant de l'appeler, et modifier les valeurs n'y
  // change rien. Le seul endroit qui l'utilise, les reglages, inscrit
  // donc l'etablissement explicitement. Voir models/Setting.js.

  model.cloisonne = true;
  return model;
}

/**
 * Middleware Express : tout ce qui suit s'execute au nom du restaurant
 * de la requete. Sans restaurant identifie, on laisse passer sans
 * cloisonnement — les routes concernees sont celles d'avant la
 * connexion, qui ne lisent aucune donnee d'etablissement.
 */
function cloisonnementParRequete(req, res, next) {
  const id = req.restaurantId || null;
  if (!id) return next();
  avecRestaurant(id, next);
}

/**
 * Filtre a ajouter a la main aux agregations.
 *
 * `max`, `min`, `sum` et `count` d'agregat ne passent pas par les
 * crochets de lecture de Sequelize : le cloisonnement automatique ne
 * s'y applique pas. C'est un piege discret — la requete fonctionne,
 * elle donne simplement un resultat calcule sur tous les restaurants.
 * Partout ou l'une d'elles apparait, ce filtre doit figurer, et son nom
 * est la pour qu'on ne le prenne pas pour une redondance a supprimer.
 */
function filtreEtablissement() {
  if (estGlobal()) return {};
  const id = restaurantCourant();
  if (!id) {
    throw new Error('Agregation hors de tout etablissement.');
  }
  return { restaurantId: id };
}

module.exports = {
  filtreEtablissement,
  avecRestaurant,
  surToutelInstallation,
  restaurantCourant,
  estGlobal,
  cloisonner,
  cloisonnementParRequete,
};
