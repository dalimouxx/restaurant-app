const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Des numeros mis de cote pour un poste, d'avance.
 *
 * Une caisse hors ligne doit pouvoir numeroter ses ventes. Elle ne peut
 * pas demander au serveur, et elle ne peut pas deviner : deux caisses
 * qui comptent chacune dans leur coin finiraient par servir deux tickets
 * « 42 » le meme midi, et c'est precisement la confusion qu'on passe son
 * temps a eviter.
 *
 * Tant qu'elle est connectee, la caisse se fait donc reserver une tranche
 * — « les numeros 51 a 80 sont a toi ». Hors ligne, elle y pioche. Le
 * serveur, lui, n'attribue plus jamais ces numeros a personne d'autre :
 * `getNextOrderNumber` regarde les ventes **et** les reservations.
 *
 * Une tranche non consommee laisse un trou dans la numerotation du jour.
 * C'est le prix a payer, et il est assume : un trou se voit et s'explique
 * (« la caisse 2 avait reserve jusqu'a 80 »), alors qu'un doublon se
 * decouvre au comptoir, devant le client. On garde donc les tranches en
 * base : elles sont la trace qui rend le trou lisible en cas de controle.
 */
const NumberReservation = sequelize.define('NumberReservation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

  /** La journee commerciale : les numeros repartent a 1 chaque jour. */
  orderDate: { type: DataTypes.DATEONLY, allowNull: false },

  /** Premier et dernier numero de la tranche, bornes comprises. */
  depuis: { type: DataTypes.INTEGER, allowNull: false },
  jusqua: { type: DataTypes.INTEGER, allowNull: false },

  /**
   * Qui a demande la tranche. Un identifiant d'appareil, pas de
   * personne : c'est la tablette qui travaille hors ligne, et c'est
   * elle qui garde ses numeros si le caissier change au cours du
   * service.
   */
  poste: { type: DataTypes.STRING, allowNull: false },
}, {
  tableName: 'number_reservations',
  timestamps: true,
});

module.exports = NumberReservation;
