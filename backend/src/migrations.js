const sequelize = require('./config/database');

/**
 * Evolutions du schema sur une base qui contient deja des donnees.
 *
 * `sequelize.sync()` cree les tables manquantes mais ne touche jamais a une
 * table existante : une colonne ajoutee dans un modele n'apparaitrait jamais
 * en production. Et `sync({ alter: true })` compare le modele a la base et
 * reecrit ce qui differe, ce qui peut supprimer une colonne ou perdre des
 * donnees sans avertir : exclu sur une base de restaurant.
 *
 * D'ou cette liste. Chaque instruction est ecrite pour pouvoir etre rejouee
 * sans dommage (`IF NOT EXISTS`, ou un changement de type qui aboutit au meme
 * etat), donc l'ensemble tourne a chaque demarrage sans table de suivi.
 *
 * Regle pour la suite : on ajoute a la fin, on ne modifie jamais une
 * instruction deja deployee, et on n'ecrit ici que des changements
 * additifs. Supprimer une colonne ou renommer se fait a la main, en
 * connaissance de cause.
 */
const STATEMENTS = [
  // Retire de la carte, sans effacer l'historique des ventes.
  `ALTER TABLE products
     ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false`,

  // Place du plat dans sa categorie sur la borne et le site.
  `ALTER TABLE products
     ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0`,

  // La photo est stockee en data URL : 255 caracteres n'y suffisent pas.
  `ALTER TABLE products
     ALTER COLUMN "imageUrl" TYPE TEXT`,

  // Epuise decide par le gerant ou la cuisine, par opposition au stock vide.
  `ALTER TABLE products
     ADD COLUMN IF NOT EXISTS "manuallyUnavailable" BOOLEAN NOT NULL DEFAULT false`,

  // Journee commerciale : le numero affiche repart a 1 chaque matin.
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "orderDate" DATE`,
  // Les commandes deja en base n'ont pas de journee : on la deduit de leur
  // date de creation, sinon l'index unique ci-dessous les rejetterait en bloc.
  `UPDATE orders
      SET "orderDate" = ("createdAt" AT TIME ZONE 'UTC')::date
    WHERE "orderDate" IS NULL`,
  // L'historique a ete cree avec un compteur modulo 999 : des doublons y
  // existent. On n'indexe donc que les commandes a partir d'aujourd'hui,
  // sans toucher au passe, qui n'a pas a etre reecrit.
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_daily_number
     ON orders ("orderDate", "orderNumber")
     WHERE "orderDate" >= DATE '2026-10-19'`,

  // Annulation d'une commande : motif, auteur, horodatage.
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "cancelReason" VARCHAR(255)`,
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "cancelledById" UUID`,
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP WITH TIME ZONE`,

  // Contact du client et zone de livraison retenue.
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "customerName" VARCHAR(255)`,
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "customerPhone" VARCHAR(255)`,
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "deliveryZoneId" UUID`,

  // Remise accordee au client, avec son motif et son auteur.
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "discountReason" VARCHAR(255)`,
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "discountById" UUID`,

  // Commande garee, et addition partagee.
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "isParked" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "splitCount" INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "splitPaidCount" INTEGER NOT NULL DEFAULT 0`,

  `ALTER TABLE orders
     ADD COLUMN IF NOT EXISTS "splitPayments" JSONB`,

  // Detail du comptage des especes a la cloture.
  `ALTER TABLE cash_sessions
     ADD COLUMN IF NOT EXISTS "countBreakdown" JSONB`,

  // Temps de preparation annonce par plat.
  `ALTER TABLE products
     ADD COLUMN IF NOT EXISTS "prepMinutes" INTEGER NOT NULL DEFAULT 0`,

  `ALTER TABLE order_items
     ADD COLUMN IF NOT EXISTS "prepMinutes" INTEGER NOT NULL DEFAULT 0`,

  // Remise au stock apres annulation. Un type a part, et non un simple
  // ajustement : le calcul du benefice net doit pouvoir deduire ce qui n'a
  // finalement pas ete consomme, sans confondre avec une correction a la main.
  `ALTER TYPE "enum_stock_movements_type"
     ADD VALUE IF NOT EXISTS 'cancellation'`,
];

async function runMigrations() {
  for (const [index, sql] of STATEMENTS.entries()) {
    try {
      await sequelize.query(sql);
    } catch (err) {
      // Une migration ratee laisse le schema a moitie a jour : mieux vaut
      // refuser de demarrer que servir des requetes sur une base bancale.
      console.error(`Migration ${index + 1} echouee :\n${sql}\n`, err.message);
      throw err;
    }
  }
  console.log(`Schema a jour (${STATEMENTS.length} verifications).`);
}

module.exports = { runMigrations };
