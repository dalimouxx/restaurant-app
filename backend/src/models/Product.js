const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Product = sequelize.define('Product', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },

  /**
   * Le nom et la description en arabe, facultatifs.
   *
   * Facultatifs, et c'est le point : personne ne ressaisira
   * soixante-dix-huit plats avant d'ouvrir. Vide, la carte arabe affiche
   * le nom d'origine — « Makloub » en lettres latines se reconnait mieux
   * qu'une case vide. Rempli, le client lit sa carte dans sa langue.
   */
  nameAr: { type: DataTypes.STRING },
  descriptionAr: { type: DataTypes.TEXT },

  price: { type: DataTypes.FLOAT, allowNull: false },

  /**
   * Photo du plat, stockee en base sous forme de data URL. Le navigateur
   * la reduit avant l'envoi (cote long 640 px, JPEG), ce qui donne des
   * fichiers de quelques dizaines de kilo-octets. C'est le seul moyen de
   * garder les photos sans louer un stockage d'objets a cote, et elles
   * survivent a un redeploiement, contrairement au disque du serveur.
   */
  imageUrl: { type: DataTypes.TEXT },

  /** Epuise pour aujourd'hui : bascule auto si un ingredient manque,
   *  ou d'un geste depuis la carte et la cuisine. Reversible. */
  isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true },

  /** Epuise parce qu'on l'a decide, et non parce que le stock manque.
   *  Sans cette distinction, la vente suivante remettrait en carte un plat
   *  que la cuisine vient de declarer epuise. */
  manuallyUnavailable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

  /** Retire de la carte, definitivement. On archive plutot que supprimer :
   *  les commandes passees et les statistiques y font reference. */
  isArchived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

  /** Place du plat dans sa categorie, sur la borne et le site. Ce qui
   *  rapporte le plus se met en premier. */
  displayOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  /** Temps de preparation annonce, en minutes. Sert au minuteur de la
   *  cuisine et au delai donne au client. */
  prepMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  categoryId: { type: DataTypes.UUID, allowNull: false },
}, {
  tableName: 'products',
  timestamps: true,
});

module.exports = Product;
