const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Order = sequelize.define('Order', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  orderNumber: { type: DataTypes.INTEGER, allowNull: false }, // numero court affiche (#042)

  /** Journee commerciale au fuseau du restaurant, figee a la creation.
   *  Porte la numerotation : le numero repart a 1 chaque matin, et le
   *  couple (journee, numero) est unique. */
  orderDate: { type: DataTypes.DATEONLY, allowNull: true },

  source: {
    // d'ou vient la commande
    type: DataTypes.ENUM('kiosk', 'counter', 'online'),
    allowNull: false,
    defaultValue: 'kiosk',
  },
  fulfillmentType: {
    // sur place / a emporter / livraison
    type: DataTypes.ENUM('dine_in', 'pickup', 'delivery'),
    allowNull: false,
    defaultValue: 'pickup',
  },

  status: {
    type: DataTypes.ENUM(
      'awaiting_payment',   // cree depuis la borne, en attente de passage caisse
      'paid',               // paye, pas encore transmis (transitoire)
      'in_kitchen',         // envoye en cuisine
      'preparing',
      'ready',
      'awaiting_driver',    // pret, en attente qu'un livreur accepte
      'out_for_delivery',
      'delivered',
      'completed',
      'cancelled'
    ),
    allowNull: false,
    defaultValue: 'awaiting_payment',
  },

  customerId: { type: DataTypes.UUID, allowNull: true }, // null si client au comptoir sans compte
  cashierId: { type: DataTypes.UUID, allowNull: true },
  driverId: { type: DataTypes.UUID, allowNull: true },

  subtotal: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  /** Remise accordee, en dinars. Le motif est choisi dans une liste fermee. */
  discountAmount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  discountReason: { type: DataTypes.STRING, allowNull: true },
  discountById: { type: DataTypes.UUID, allowNull: true },

  /** Garee : le client est parti chercher de l'argent. Elle quitte la file
   *  active sans etre annulee, et y revient d'un geste. */
  isParked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

  /** Addition partagee : nombre de parts, et combien sont deja reglees. */
  splitCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  splitPaidCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  /** Chaque part reglee, avec son moyen : une addition peut se partager
   *  entre une carte et des especes, et le tiroir ne doit compter que ce
   *  qui y est reellement entre. */
  splitPayments: { type: DataTypes.JSONB, allowNull: true },
  deliveryFee: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  tipAmount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  totalAmount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  paymentMethod: {
    type: DataTypes.ENUM('cash', 'card', 'cash_on_delivery'),
    allowNull: true,
  },
  paidAt: { type: DataTypes.DATE, allowNull: true },

  /** Contact, pour appeler quand c'est pret. Facultatif sur place,
   *  utile a emporter, indispensable en livraison. */
  customerName: { type: DataTypes.STRING, allowNull: true },
  customerPhone: { type: DataTypes.STRING, allowNull: true },

  /** Zone retenue : c'est elle qui a fixe les frais de livraison. */
  deliveryZoneId: { type: DataTypes.UUID, allowNull: true },

  deliveryAddress: { type: DataTypes.STRING },
  deliveryLat: { type: DataTypes.FLOAT },
  deliveryLng: { type: DataTypes.FLOAT },

  qrToken: { type: DataTypes.STRING }, // QR scanne par le livreur pour confirmer la remise

  /**
   * La reference que le poste a donnee a cette vente avant de l'envoyer.
   *
   * C'est ce qui rend un envoi rejouable sans danger. Une caisse qui
   * encaisse puis perd la reponse — reseau coupe, serveur qui redemarre
   * — n'a aujourd'hui aucun moyen de savoir si la vente est passee. Le
   * caissier retente, et vend deux fois. Avec cette reference, le
   * serveur reconnait la vente deja enregistree et renvoie la meme,
   * au lieu d'en creer une seconde.
   *
   * Elle devient indispensable des que la caisse travaille hors ligne :
   * une file de ventes a rejouer n'a de sens que si chacune ne peut
   * aboutir qu'une fois.
   */
  clientRef: { type: DataTypes.UUID, allowNull: true },

  /**
   * Annulation. Une commande ne se supprime jamais : elle garde son numero
   * et sa place dans la suite, et porte la trace de qui l'a annulee et
   * pourquoi. Un trou dans la numerotation serait le premier signe qu'on
   * cherche en cas de controle.
   */
  cancelReason: { type: DataTypes.STRING, allowNull: true },
  cancelledById: { type: DataTypes.UUID, allowNull: true },
  cancelledAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'orders',
  timestamps: true,
});

module.exports = Order;
