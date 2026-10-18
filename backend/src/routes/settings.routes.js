const express = require('express');
const { getSettings, saveSettings } = require('../models/Setting');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Lecture publique : la borne et l'ecran client affichent le nom de
 * l'etablissement, et le ticket en a besoin au moment de l'impression.
 * Ces informations figurent de toute facon sur la devanture.
 */
router.get('/', async (req, res) => {
  res.json(await getSettings());
});

// --- Modification, reservee au gerant ---
router.put(
  '/',
  requireAuth,
  requireRole('manager', 'admin', 'super_admin'),
  async (req, res) => {
    res.json(await saveSettings(req.body));
  }
);

module.exports = router;
