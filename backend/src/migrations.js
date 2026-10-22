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

  /* ─────────────── Plusieurs restaurants dans une installation ───────────────
   *
   * Chaque table porte desormais son etablissement. La reprise se fait en
   * trois temps, et dans cet ordre : creer un etablissement pour ce qui
   * existe deja, rattacher toutes les lignes orphelines, puis seulement
   * imposer la colonne. Inverser reviendrait a refuser de demarrer sur
   * une base existante.
   *
   * Les reglages changent de cle primaire : « restaurantName » n'est plus
   * unique dans l'installation, il l'est par restaurant. */

  `CREATE TABLE IF NOT EXISTS restaurants (
     id UUID PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     slug VARCHAR(255) NOT NULL UNIQUE,
     "logoUrl" TEXT,
     "isActive" BOOLEAN NOT NULL DEFAULT true,
     notes VARCHAR(255),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
     "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
   )`,

  // L'etablissement d'origine, celui qui tournait avant la bascule. Son
  // repere est fixe pour que les bornes deja posees continuent de
  // repondre a la meme adresse.
  // Les dates sont posees explicitement : la table peut avoir ete creee
  // par sequelize.sync(), qui ne leur donne pas de valeur par defaut.
  `INSERT INTO restaurants (id, name, slug, "isActive", "createdAt", "updatedAt")
     SELECT '00000000-0000-4000-8000-000000000001', 'Mon restaurant', 'principal',
            true, now(), now()
     WHERE NOT EXISTS (SELECT 1 FROM restaurants)`,

  `ALTER TABLE users ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE users SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS users_restaurant ON users ("restaurantId")`,
  `ALTER TABLE categories ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE categories SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS categories_restaurant ON categories ("restaurantId")`,
  `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE ingredients SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS ingredients_restaurant ON ingredients ("restaurantId")`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE products SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS products_restaurant ON products ("restaurantId")`,
  `ALTER TABLE product_ingredients ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE product_ingredients SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS product_ingredients_restaurant ON product_ingredients ("restaurantId")`,
  `ALTER TABLE product_options ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE product_options SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS product_options_restaurant ON product_options ("restaurantId")`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE orders SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS orders_restaurant ON orders ("restaurantId")`,
  `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE order_items SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS order_items_restaurant ON order_items ("restaurantId")`,
  `ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE cash_sessions SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS cash_sessions_restaurant ON cash_sessions ("restaurantId")`,
  `ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE stock_movements SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS stock_movements_restaurant ON stock_movements ("restaurantId")`,
  `ALTER TABLE driver_locations ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE driver_locations SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS driver_locations_restaurant ON driver_locations ("restaurantId")`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE settings SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS settings_restaurant ON settings ("restaurantId")`,
  `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE audit_logs SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS audit_logs_restaurant ON audit_logs ("restaurantId")`,
  `ALTER TABLE delivery_zones ADD COLUMN IF NOT EXISTS "restaurantId" UUID`,
  `UPDATE delivery_zones SET "restaurantId" = (SELECT id FROM restaurants ORDER BY "createdAt" LIMIT 1)
     WHERE "restaurantId" IS NULL`,
  `CREATE INDEX IF NOT EXISTS delivery_zones_restaurant ON delivery_zones ("restaurantId")`,

  // Les reglages : la cle seule ne suffit plus, deux restaurants ont
  // chacun leur « restaurantName ».
  `ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey`,
  `ALTER TABLE settings ADD PRIMARY KEY ("restaurantId", key)`,

  // Le numero de commande repart a 1 chaque jour, et par etablissement :
  // deux fastfoods servent chacun leur numero 12 le meme midi.
  `DROP INDEX IF EXISTS orders_daily_number`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_daily_number
     ON orders ("restaurantId", "orderDate", "orderNumber")
     WHERE "orderDate" >= DATE '2026-10-19'`,
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
