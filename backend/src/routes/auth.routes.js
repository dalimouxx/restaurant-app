const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

const router = express.Router();

function generateToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, fullName: user.fullName },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

// --- Connexion classique (manager, admin) : email + mot de passe ---
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email } });
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects.' });
  if (!user.isActive) return res.status(403).json({ error: 'Compte desactive.' });

  res.json({ token: generateToken(user), user: sanitize(user) });
});

// --- Connexion caissier via code personnel court ---
router.post('/login-code', async (req, res) => {
  const { loginCode } = req.body;
  const user = await User.findOne({ where: { loginCode, role: 'cashier' } });
  if (!user) return res.status(401).json({ error: 'Code invalide.' });
  if (!user.isActive) return res.status(403).json({ error: 'Compte desactive.' });

  res.json({ token: generateToken(user), user: sanitize(user) });
});

// --- Connexion via scan du QR code du badge (caissier ou livreur) ---
router.post('/login-qr', async (req, res) => {
  const { qrToken } = req.body;
  const user = await User.findOne({ where: { qrToken } });
  if (!user) return res.status(401).json({ error: 'QR code invalide.' });
  if (!user.isActive) return res.status(403).json({ error: 'Compte desactive.' });

  res.json({ token: generateToken(user), user: sanitize(user) });
});

// --- Inscription client (app mobile) ---
router.post('/register-customer', async (req, res) => {
  const { fullName, phone, email, password } = req.body;
  if (!fullName || !phone) {
    return res.status(400).json({ error: 'Nom et telephone requis.' });
  }
  const existing = await User.findOne({ where: { phone } });
  if (existing) return res.status(409).json({ error: 'Ce numero est deja utilise.' });

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
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
