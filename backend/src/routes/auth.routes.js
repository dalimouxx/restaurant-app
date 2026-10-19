const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { guard, recordFailure, recordSuccess, throttle } = require('../middleware/rateLimit');

const router = express.Router();

/**
 * Toutes les voies d'entree partagent un meme compteur d'echecs : sans
 * cela, un attaquant bloque sur les codes passerait simplement aux
 * badges. C'est l'acces au systeme qui est limite, pas une methode.
 */
const LOGIN = 'connexion';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, fullName: user.fullName },
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
