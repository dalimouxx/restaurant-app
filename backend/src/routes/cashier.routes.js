const express = require('express');
const { CashSession, Order } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Op } = require('sequelize');
const audit = require('../audit');

const router = express.Router();

// --- Ouverture de caisse : le caissier entre le montant du fond ---
router.post('/open', requireAuth, requireRole('cashier'), async (req, res) => {
  const { openingFloat } = req.body;

  const alreadyOpen = await CashSession.findOne({ where: { cashierId: req.user.id, isOpen: true } });
  if (alreadyOpen) return res.status(400).json({ error: 'Une session de caisse est deja ouverte.' });

  const session = await CashSession.create({
    cashierId: req.user.id,
    openingFloat,
  });
  res.status(201).json(session);
});

// --- Fermeture de caisse : calcul automatique de l'ecart ---
router.post('/close', requireAuth, requireRole('cashier'), async (req, res) => {
  const { closingAmount } = req.body;

  const session = await CashSession.findOne({ where: { cashierId: req.user.id, isOpen: true } });
  if (!session) return res.status(400).json({ error: 'Aucune session ouverte.' });

  const cashSales = await Order.sum('totalAmount', {
    where: {
      cashierId: req.user.id,
      paymentMethod: 'cash',
      paidAt: { [Op.gte]: session.openedAt },
      // Une commande annulee a ete remboursee en especes : l'argent n'est
      // plus dans le tiroir. L'y compter ferait apparaitre un manquant au
      // caissier a chaque annulation.
      status: { [Op.ne]: 'cancelled' },
    },
  });

  const expectedAmount = session.openingFloat + (cashSales || 0);

  session.closingAmount = closingAmount;
  session.expectedAmount = expectedAmount;
  session.discrepancy = closingAmount - expectedAmount;
  session.isOpen = false;
  session.closedAt = new Date();
  await session.save();

  // Un ecart de caisse se consigne toujours, dans les deux sens : un
  // excedent repete en dit autant qu'un manquant.
  if (Math.abs(session.discrepancy) >= 0.001) {
    await audit.record(req, {
      action: 'cash.closed_with_discrepancy',
      entityType: 'cash_session',
      entityId: session.id,
      summary:
        `Clôture avec ${session.discrepancy > 0 ? 'excédent' : 'manquant'} de ` +
        `${Math.abs(session.discrepancy).toFixed(3)} DT`,
      details: {
        openingFloat: session.openingFloat,
        expectedAmount: session.expectedAmount,
        closingAmount: session.closingAmount,
        discrepancy: session.discrepancy,
      },
    });
  }

  res.json(session);
});

// --- Etat courant de la session active ---
router.get('/current', requireAuth, requireRole('cashier'), async (req, res) => {
  const session = await CashSession.findOne({ where: { cashierId: req.user.id, isOpen: true } });
  res.json(session);
});

module.exports = router;
