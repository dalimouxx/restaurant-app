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
