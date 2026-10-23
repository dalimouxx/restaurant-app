const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { surToutelInstallation } = require('../tenant');
const { User } = require('../models');
const {
  guard,
  recordFailure,
  recordSuccess,
  throttle,
  ralentir,
  recordSlowFailure,
  recordSlowSuccess,
} = require('../middleware/rateLimit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * L'authentification precede l'etablissement : au moment ou quelqu'un
 * saisit son code, on ne sait pas encore ou il travaille. Ces routes
 * cherchent donc dans toute l'installation — c'est le seul endroit du
 * serveur ou c'est legitime, et c'est ecrit noir sur blanc.
 */
router.use((req, res, next) => surToutelInstallation(next));

/**
 * Toutes les voies d'entree partagent un meme compteur d'echecs : sans
 * cela, un attaquant bloque sur les codes passerait simplement aux
 * badges. C'est l'acces au systeme qui est limite, pas une methode.
 */
const LOGIN = 'connexion';

/**
 * Le jeton porte l'etablissement.
 *
 * C'est lui, et non un en-tete envoye par le navigateur, qui decide
 * quelles donnees la session verra : il est signe a la connexion, et
 * rien du cote client ne peut le deplacer vers un autre restaurant.
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      restaurantId: user.restaurantId || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

// --- Connexion classique (manager, admin) : email + mot de passe ---
router.post('/login', guard(LOGIN), async (req, res) => {
  const email = String(req.body.email ?? '').trim();
  const password = String(req.body.password ?? '');
  // Sans cette garde, un champ vide atteint bcrypt, qui leve : la personne
  // recoit une erreur serveur la ou un refus clair est attendu. Une saisie
  // incomplete n'est pas une tentative : elle ne compte pas comme un echec.
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  const user = await User.findOne({ where: { email } });
  const valid =
    user && user.passwordHash && (await bcrypt.compare(password, user.passwordHash));

  if (!valid) {
    recordFailure(LOGIN, req);
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  if (!user.isActive) return res.status(403).json({ error: 'Compte desactive.' });

  recordSuccess(LOGIN, req);
  res.json({ token: generateToken(user), user: sanitize(user) });
});

/**
 * Les deux connexions sans mot de passe — code court et badge QR — sont
 * reservees au personnel. Un client se connecte par telephone et mot de
 * passe : lui ouvrir ces portes reviendrait a donner un acces employe a
 * qui devine un code a quatre chiffres.
 */
const STAFF_ROLES = ['manager', 'cashier', 'cook', 'driver'];

// --- Connexion du personnel via code personnel court ---
router.post('/login-code', guard(LOGIN), async (req, res) => {
  const loginCode = String(req.body.loginCode ?? '').trim();
  if (!loginCode) return res.status(400).json({ error: 'Code requis.' });

  const user = await User.findOne({ where: { loginCode, role: STAFF_ROLES } });
  if (!user) {
    recordFailure(LOGIN, req);
    return res.status(401).json({ error: 'Code invalide.' });
  }
  if (!user.isActive) return res.status(403).json({ error: 'Compte desactive.' });

  recordSuccess(LOGIN, req);
  res.json({ token: generateToken(user), user: sanitize(user) });
});

/* ─────────── Lever le voile d'un poste verrouille ─────────── */

/**
 * Qui peut tenir quel poste. Le meme partage que cote ecran, mais c'est
 * ici qu'il est applique : l'ecran se contente de cacher les liens.
 */
const ENCADREMENT = ['manager', 'admin', 'super_admin'];
const TENANTS = {
  caisse: ['cashier', ...ENCADREMENT],
  cuisine: ['cook', ...ENCADREMENT],
  gestion: ENCADREMENT,
  livreur: ['driver', ...ENCADREMENT],
  borne: ['cashier', ...ENCADREMENT],
  espace: ['cashier', 'cook', 'driver', ...ENCADREMENT],
};

const DEVERROU = 'deverrouillage';

/**
 * Ce n'est pas une connexion, et c'est tout le point.
 *
 * La session du poste est deja ouverte — la caisse du jour, la commande
 * a moitie saisie. On verifie seulement que celui qui reprend la
 * tablette est de la maison. Trois consequences, chacune voulue :
 *
 * 1. `requireAuth` : il faut deja une session valide. La route n'est
 *    donc pas une seconde porte d'entree au systeme ; sans token, elle
 *    repond 401 avant meme de regarder le code.
 * 2. Son propre compteur, qui ralentit au lieu de bloquer (voir
 *    `ralentir`). Les ratés d'un ecran de verrouillage ne doivent pas
 *    remplir le compteur de la page de connexion, que tout le
 *    restaurant partage derriere une seule adresse.
 * 3. Un code valide dont le role ne tient pas ce poste est refuse sans
 *    toucher a la session en cours : un cuisinier qui tape son code sur
 *    la tablette de gestion n'en prend pas la main et ne chasse pas le
 *    gerant de la sienne. Il ne gagnait rien — l'ecran de gestion lui
 *    aurait ferme la porte — mais il faisait perdre sa session au
 *    gerant, et le journal aurait porte son nom.
 */
router.post('/deverrouiller', requireAuth, ralentir(DEVERROU), async (req, res) => {
  const loginCode = String(req.body.loginCode ?? '').trim();
  const poste = String(req.body.poste ?? '').trim();
  if (!loginCode) return res.status(400).json({ error: 'Code requis.' });

  const user = await User.findOne({ where: { loginCode, role: STAFF_ROLES } });
  if (!user || !user.isActive) {
    recordSlowFailure(DEVERROU, req);
    return res.status(401).json({ error: 'Code incorrect.' });
  }

  const admis = TENANTS[poste];
  if (admis && !admis.includes(user.role)) {
    /* Un code juste, mais pas pour ce poste : on ne compte pas d'echec
       — ce n'est pas une tentative d'intrusion, c'est une erreur de
       tablette, et la punir ralentirait celui qui a le droit d'entrer. */
    return res.status(403).json({ error: 'Ce poste n\'est pas le vôtre.' });
  }

  recordSlowSuccess(DEVERROU, req);
  res.json({ token: generateToken(user), user: sanitize(user) });
});

// --- Connexion via scan du badge QR (caissier, cuisinier, livreur) ---
router.post('/login-qr', guard(LOGIN), async (req, res) => {
  const qrToken = String(req.body.qrToken ?? '').trim();
  if (!qrToken) return res.status(400).json({ error: 'Badge requis.' });

  const user = await User.findOne({ where: { qrToken, role: STAFF_ROLES } });
  if (!user) {
    recordFailure(LOGIN, req);
    return res.status(401).json({ error: 'QR code invalide.' });
  }
  if (!user.isActive) return res.status(403).json({ error: 'Compte desactive.' });

  recordSuccess(LOGIN, req);
  res.json({ token: generateToken(user), user: sanitize(user) });
});

// --- Inscription client (app mobile) ---
// Dix comptes par heure et par adresse : au-dela, c'est un script.
router.post(
  '/register-customer',
  throttle('inscription', { max: 10, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
  const { fullName, phone, email, password } = req.body;
  if (!fullName || !phone) {
    return res.status(400).json({ error: 'Nom et telephone requis.' });
  }
  const existing = await User.findOne({ where: { phone } });
  if (existing) return res.status(409).json({ error: 'Ce numero est deja utilise.' });

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  const user = await User.create({
    fullName, phone, email, passwordHash, role: 'customer',
  });
  res.status(201).json({ token: generateToken(user), user: sanitize(user) });
});

function sanitize(user) {
  const { passwordHash, loginCode, qrToken, ...safe } = user.toJSON();
  return safe;
}

module.exports = router;
