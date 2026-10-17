const { Sequelize } = require('sequelize');
require('dotenv').config();

/**
 * Deux modes de connexion :
 *
 * 1. DATABASE_URL — Neon, Render, Supabase… Elle a priorité.
 * 2. Variables séparées (DB_HOST, DB_USER…) — développement local.
 *
 * Particularité des bases « serverless » comme Neon : le calcul est suspendu
 * après quelques minutes sans requête. La première requête qui suit réveille
 * l'instance, et peut échouer le temps du réveil. D'où la politique de
 * nouvelle tentative ci-dessous : sans elle, un écran affiche une erreur
 * simplement parce que la base dormait.
 */

/** Erreurs transitoires d'un réveil ou d'une coupure réseau. */
const RETRYABLE = [
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /EHOSTUNREACH/,
  /ENETUNREACH/,
  /EPIPE/,
  /Connection terminated/i,
  /Connection terminated unexpectedly/i,
  /terminating connection due to administrator command/i,
  /SequelizeConnectionError/,
  /SequelizeConnectionRefusedError/,
  /SequelizeHostNotFoundError/,
  /SequelizeConnectionTimedOutError/,
];

const common = {
  dialect: 'postgres',
  logging: false,
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: 0,
    // Laisse le temps à une base suspendue de se réveiller.
    acquire: 60000,
    // Neon coupe les connexions inactives : on les libère avant lui.
    idle: 10000,
    evict: 5000,
  },
  retry: {
    max: 3,
    match: RETRYABLE,
    backoffBase: 300,
    backoffExponent: 1.6,
  },
  dialectOptions: {
    // Abandonne une connexion qui n'aboutit pas, plutôt que de rester bloqué.
    connectTimeout: 30000,
    keepAlive: true,
  },
};

let sequelize;

if (process.env.DATABASE_URL) {
  // Une base locale ne parle pas TLS : on ne l'exige que pour un hôte distant.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);
  const useSsl = process.env.DB_SSL === 'false' ? false : !isLocal;

  sequelize = new Sequelize(process.env.DATABASE_URL, {
    ...common,
    dialectOptions: {
      ...common.dialectOptions,
      ...(useSsl
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : {}),
    },
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
      dialectOptions: {
        ...common.dialectOptions,
        ...(process.env.DB_SSL === 'true'
          ? { ssl: { require: true, rejectUnauthorized: false } }
          : {}),
      },
    }
  );
}

module.exports = sequelize;
