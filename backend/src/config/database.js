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

/**
 * Retire les parametres TLS de la chaine de connexion.
 *
 * Les hebergeurs ajoutent `?sslmode=require&channel_binding=require` a
 * l'URL qu'ils affichent. Or le pilote `pg` interprete `sslmode=require`
 * comme `verify-full` (verification complete du certificat), ce qui entre
 * en conflit avec la configuration TLS passee a cote et rend le
 * comportement dependant de la version du pilote.
 *
 * On enleve donc ces parametres et on impose une seule configuration,
 * explicite : la connexion se comporte pareil quelle que soit l'URL collee.
 */
function stripTlsParams(rawUrl) {
  try {
    const u = new URL(rawUrl);
    ['sslmode', 'channel_binding', 'ssl'].forEach((p) =>
      u.searchParams.delete(p)
    );
    return u.toString();
  } catch {
    // URL non analysable : on la transmet telle quelle, l'erreur de
    // connexion sera plus parlante qu'une erreur de parsing ici.
    return rawUrl;
  }
}

let sequelize;

if (process.env.DATABASE_URL) {
  const url = stripTlsParams(process.env.DATABASE_URL);

  // Une base locale ne parle pas TLS : on ne l'exige que pour un hote distant.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const useSsl = process.env.DB_SSL === 'false' ? false : !isLocal;

  /**
   * Verification du certificat. Desactivee par defaut car Render signe ses
   * bases avec une autorite interne. Neon utilise des certificats publics :
   * avec lui, DB_SSL_STRICT=true ajoute la verification complete.
   * Dans les deux cas la connexion est chiffree.
   */
  const strict = process.env.DB_SSL_STRICT === 'true';

  sequelize = new Sequelize(url, {
    ...common,
    dialectOptions: {
      ...common.dialectOptions,
      ...(useSsl
        ? { ssl: { require: true, rejectUnauthorized: strict } }
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
