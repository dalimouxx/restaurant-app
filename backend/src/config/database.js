const { Sequelize } = require('sequelize');
require('dotenv').config();

/**
 * Deux modes de connexion :
 *
 * 1. DATABASE_URL — fournie automatiquement par Render (et la plupart des
 *    hébergeurs). Elle a priorité : en production on ne touche à rien.
 * 2. Variables séparées (DB_HOST, DB_USER…) — pour le développement local.
 *
 * Render impose TLS sur ses bases managées, mais signe avec une autorité
 * interne : `rejectUnauthorized: false` est la configuration documentée par
 * Render. La connexion reste chiffrée.
 */

const common = {
  dialect: 'postgres',
  logging: false,
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
};

let sequelize;

if (process.env.DATABASE_URL) {
  // Une base locale ne parle pas TLS : on ne l'exige que pour un hôte distant.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);
  const useSsl = process.env.DB_SSL === 'false' ? false : !isLocal;

  sequelize = new Sequelize(process.env.DATABASE_URL, {
    ...common,
    ...(useSsl
      ? {
          dialectOptions: {
            ssl: { require: true, rejectUnauthorized: false },
          },
        }
      : {}),
  });
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME || 'restaurant_db',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'postgres',
    {
      ...common,
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      // En local, SSL seulement si explicitement demandé.
      ...(process.env.DB_SSL === 'true'
        ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } }
        : {}),
    }
  );
}

module.exports = sequelize;
