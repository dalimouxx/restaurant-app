const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { User } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { restaurantCourant, avecRestaurant, surToutelInstallation } = require('../tenant');

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

  /**
   * Un employe appartient toujours a un etablissement.
   *
   * C'est ce rattachement qui decide des ventes qu'il voit, de la caisse
   * qu'il cloture et de la cuisine qui lui repond. Un compte cree sans
   * lui n'est pas un compte incomplet, c'est un compte qui ne peut rien
   * faire — et le refus serait incomprehensible pour l'interesse au
   * moment de sa premiere connexion.
   *
   * Un gerant cree dans le sien. Un super admin, qui travaille sur
   * l'installation entiere, doit dire lequel.
   */
  const etablissement = restaurantCourant() || req.body.restaurantId || null;
  if (!etablissement) {
    return res.status(400).json({
      error: 'Indiquez l\'etablissement auquel rattacher cet employe.',
    });
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
     *
     * **Sur toute l'installation, et pas seulement dans cet
     * etablissement.** La colonne porte une contrainte d'unicite globale
     * — elle date de l'epoque ou il n'y avait qu'un restaurant, et elle
     * a bien fait de rester. Cherche sous cloisonnement, la verification
     * ne voyait que les employes de la maison : un code deja pris chez le
     * voisin passait le controle, puis se heurtait a l'index au moment de
     * l'insertion. Le gerant recevait une erreur de base de donnees a la
     * place d'une phrase, et n'avait aucun moyen de deviner quoi faire.
     */
    const taken = await surToutelInstallation(() =>
      User.findOne({ where: { loginCode: code } })
    );
    if (taken) {
      return res.status(409).json({ error: 'Ce code est deja attribue a un autre employe.' });
    }
    // Un code court protege un acces a l'argent : on le dit, sans l'imposer.
    if (code.length === 4 && ['manager', 'cashier'].includes(role)) {
      console.warn(`Code a 4 chiffres pour un compte ${role} : 6 chiffres seraient plus surs.`);
    }
  }

  // Inscrit explicitement : un super admin travaille hors cloisonnement,
  // ou le rattachement automatique ne s'applique pas.
  const user = await User.create({
    fullName,
    role,
    restaurantId: etablissement,
    phone: phone || null,
    email: email || null,
    passwordHash: password ? await bcrypt.hash(password, 12) : null,
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
