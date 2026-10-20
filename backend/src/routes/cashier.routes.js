const express = require('express');
const { CashSession, Order } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { Op } = require('sequelize');
const audit = require('../audit');

/**
 * Part reellement entree dans le tiroir pour une commande.
 *
 * Une addition partagee porte le detail de chaque part et de son moyen ;
 * une commande simple ne compte que si elle a ete reglee en especes.
 */
function partEnEspeces(order) {
  if (Array.isArray(order.splitPayments) && order.splitPayments.length > 0) {
    return order.splitPayments
      .filter((p) => p.method === 'cash')
      .reduce((somme, p) => somme + (Number(p.amount) || 0), 0);
  }
  return order.paymentMethod === 'cash' ? order.totalAmount : 0;
}

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

  /**
   * Ce qui devrait etre dans le tiroir.
   *
   * Calcule ligne a ligne plutot que par une somme SQL : une addition
   * partagee peut etre reglee moitie carte, moitie especes, et seule la
   * part en especes est entree dans le tiroir. Une commande annulee a ete
   * remboursee : l'y compter ferait apparaitre un manquant au caissier a
   * chaque annulation.
   */
  const encaissees = await Order.findAll({
    where: {
      cashierId: req.user.id,
      paidAt: { [Op.gte]: session.openedAt },
      status: { [Op.ne]: 'cancelled' },
    },
  });

  const cashSales = encaissees.reduce((somme, o) => somme + partEnEspeces(o), 0);
  const expectedAmount = Math.round((session.openingFloat + cashSales) * 1000) / 1000;

  // Le detail du comptage est conserve : un ecart doit pouvoir se
  // reconstituer le lendemain, coupure par coupure.
  if (req.body.breakdown && typeof req.body.breakdown === 'object') {
    session.countBreakdown = req.body.breakdown;
  }
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
