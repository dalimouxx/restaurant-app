const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { User } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function sanitize(user) {
  const { passwordHash, ...safe } = user.toJSON();
  return safe;
}

// --- Liste des employes ---
router.get('/', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const users = await User.findAll({
    where: { role: ['manager', 'cashier', 'cook', 'driver'] },
    order: [['fullName', 'ASC']],
  });
  res.json(users.map(sanitize));
});

// --- Creation d'un employe ---
router.post('/', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const { fullName, role, phone, email, password, loginCode } = req.body;

  const allowedRoles = ['manager', 'cashier', 'cook', 'driver'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Role invalide.' });
  }
  // Seul un super_admin peut creer un autre manager.
  if (role === 'manager' && req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Seul un administrateur peut creer un gerant." });
  }

  if (loginCode) {
    const code = String(loginCode).trim();
    if (!/^\d{4,8}$/.test(code)) {
      return res.status(400).json({ error: 'Le code doit comporter de 4 a 8 chiffres.' });
    }
    /**
     * Deux employes partageant un code, c'est la connexion qui en choisit
     * un au hasard : les ventes seraient attribuees a la mauvaise personne,
     * et une cloture de caisse deviendrait indefendable.
     */
    const taken = await User.findOne({ where: { loginCode: code } });
    if (taken) {
      return res.status(409).json({ error: 'Ce code est deja attribue a un autre employe.' });
    }
    // Un code court protege un acces a l'argent : on le dit, sans l'imposer.
    if (code.length === 4 && ['manager', 'cashier'].includes(role)) {
      console.warn(`Code a 4 chiffres pour un compte ${role} : 6 chiffres seraient plus surs.`);
    }
  }

  const user = await User.create({
    fullName,
    role,
    phone: phone || null,
    email: email || null,
    passwordHash: password ? await bcrypt.hash(password, 10) : null,
    loginCode: loginCode || null,
    qrToken: uuidv4(), // sert de badge scannable
  });

  res.status(201).json(sanitize(user));
});

// --- Recupere le badge QR d'un employe (image PNG en base64) ---
router.get('/:id/badge', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Employe introuvable.' });
  if (!user.qrToken) return res.status(400).json({ error: 'Cet employe n\'a pas de badge.' });

  const dataUrl = await QRCode.toDataURL(user.qrToken);
  res.json({ fullName: user.fullName, role: user.role, qrImage: dataUrl });
});

// --- Activer / desactiver un compte ---
router.post('/:id/toggle-active', requireAuth, requireRole('manager', 'admin', 'super_admin'), async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ error: 'Employe introuvable.' });

  user.isActive = !user.isActive;
  await user.save();
  res.json(sanitize(user));
});

module.exports = router;
