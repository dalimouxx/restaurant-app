require('dotenv').config();

/**
 * Doit etre charge AVANT les routes. Express 4 n'attrape pas les erreurs
 * levees dans un gestionnaire `async` : elles deviennent des rejets non
 * geres et tuent le processus Node. Or une base serverless (Neon) suspend
 * son calcul apres quelques minutes : la requete qui la reveille peut
 * echouer. Sans ce relais, le service tomberait plusieurs fois par jour.
 */
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');

const { sequelize } = require('./models');
const socket = require('./sockets/socketHandler');
const { bootstrapAdmin, bootstrapDemoMenu } = require('./bootstrap');

const authRoutes = require('./routes/auth.routes');
const { router: productRoutes } = require('./routes/product.routes');
const { router: stockRoutes } = require('./routes/stock.routes');
const orderRoutes = require('./routes/order.routes');
const cashierRoutes = require('./routes/cashier.routes');
const deliveryRoutes = require('./routes/delivery.routes');
const reportRoutes = require('./routes/report.routes');
const userRoutes = require('./routes/user.routes');

const app = express();

// Render place le service derriere un proxy : sans cela, req.protocol et
// l'adresse IP du client sont faux.
app.set('trust proxy', 1);

/**
 * CORS. En production l'application web est servie par ce meme serveur,
 * donc aucune origine externe n'est necessaire. ALLOWED_ORIGINS (liste
 * separee par des virgules) permet d'en autoriser explicitement.
 * En developpement, tout est autorise pour le serveur Vite du port 5173.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      // Requete same-origin ou outil sans en-tete Origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origine non autorisee'));
    },
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cashier', cashierRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);

/**
 * Application web (build Vite).
 * Si le dossier web/dist existe, le backend la sert directement : un seul
 * serveur a demarrer, pas de CORS a regler, pas d'hebergement separe.
 * En developpement, on utilise plutot `npm run dev` cote web (port 5173).
 */
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  // Les fichiers compiles portent un hash dans leur nom : cache long.
  app.use(
    '/assets',
    express.static(path.join(WEB_DIST, 'assets'), {
      immutable: true,
      maxAge: '1y',
    })
  );
  app.use(express.static(WEB_DIST, { index: false }));

  // Routage cote client : toute URL inconnue renvoie index.html, sinon
  // un rechargement sur /caisse ou /gestion/stock donnerait un 404.
  app.get(/^\/(?!api\/|health$|socket\.io\/).*/, (req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });

  console.log('Application web servie depuis web/dist');
} else {
  console.log(
    "Application web non compilee (web/dist absent) : seule l'API est servie."
  );
}

/** Erreurs de connexion a la base : transitoires, pas la faute du client. */
const DB_CONNECTION_ERRORS = [
  'SequelizeConnectionError',
  'SequelizeConnectionRefusedError',
  'SequelizeHostNotFoundError',
  'SequelizeConnectionTimedOutError',
  'SequelizeAccessDeniedError',
];

// Gestion centralisee des erreurs
app.use((err, req, res, next) => {
  if (err && err.message === 'Origine non autorisee') {
    return res.status(403).json({ error: "Origine non autorisee." });
  }

  // La base dormait ou le reseau a coupe : 503 et non 500, pour que
  // l'interface propose de reessayer au lieu d'annoncer une panne.
  if (err && DB_CONNECTION_ERRORS.includes(err.name)) {
    console.warn(`Base momentanement injoignable : ${err.message}`);
    return res.status(503).json({
      error: 'Base de donnees momentanement indisponible. Reessayez.',
    });
  }

  console.error(err);
  res.status(500).json({ error: err.message || 'Erreur serveur.' });
});

const server = http.createServer(app);
socket.init(server);

// Render fournit PORT : ne jamais le forcer en production.
const PORT = process.env.PORT || 4000;

// Sans secret, les jetons seraient invalides ou previsibles : on arrete net
// plutot que de demarrer un service non securise.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error(
    'JWT_SECRET manquant ou trop court (16 caracteres minimum). ' +
      'Definissez-le dans les variables d environnement.'
  );
  process.exit(1);
}

/**
 * Premiere connexion, avec plusieurs tentatives.
 * Une base serverless (Neon) est suspendue apres quelques minutes sans
 * trafic : au demarrage elle peut mettre un instant a repondre. Abandonner
 * des la premiere erreur ferait echouer le deploiement sans raison.
 */
async function connectWithRetry(attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await sequelize.authenticate();
      return;
    } catch (err) {
      if (i === attempts) throw err;
      const waitMs = Math.min(1000 * 2 ** (i - 1), 8000);
      console.warn(
        `Base injoignable (tentative ${i}/${attempts}) : ${err.message}. ` +
          `Nouvel essai dans ${waitMs / 1000} s.`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function start() {
  try {
    await connectWithRetry();
    console.log('Connexion a la base de donnees reussie.');

    // Cree les tables manquantes. A remplacer par des migrations quand le
    // schema evoluera sur une base contenant de vraies donnees.
    await sequelize.sync();

    // Premier demarrage : cree le compte administrateur si la base est vide.
    const boot = await bootstrapAdmin();
    if (boot.created) {
      console.log(`Compte administrateur cree : ${boot.email}`);
    } else if (boot.reason !== 'des comptes existent déjà') {
      // Toute autre raison est un echec de configuration : il doit se voir
      // dans les journaux, sinon la connexion echoue sans explication.
      console.error(
        '==================================================\n' +
          `AUCUN COMPTE ADMINISTRATEUR CREE : ${boot.reason}.\n` +
          'Corrigez la variable concernee, puis redeployez.\n' +
          '=================================================='
      );
    }

    // Carte de démonstration, si demandée et si la carte est vide.
    const demo = await bootstrapDemoMenu();
    if (demo.created) {
      console.log(
        `Carte de demonstration creee : ${demo.products} produits, ` +
          `${demo.ingredients} ingredients.`
      );
    }

    // 0.0.0.0 est requis par Render pour que le service soit joignable.
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Serveur demarre sur le port ${PORT}`);
    });
  } catch (err) {
    console.error('Impossible de demarrer le serveur:', err.message);
    process.exit(1);
  }
}

/**
 * Dernier filet. Un service de restaurant tourne pendant le coup de feu :
 * une erreur imprevue doit etre consignee, jamais couper les ecrans en
 * pleine commande. Les cas rattrapables sont deja traites plus haut.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Rejet non gere (service maintenu) :', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Exception non geree (service maintenu) :', err);
});

start();
