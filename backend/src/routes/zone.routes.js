const express = require('express');
const { filtreEtablissement } = require('../tenant');
const { DeliveryZone } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError } = require('../errors');
const audit = require('../audit');

const router = express.Router();
const MANAGER = ['manager', 'admin', 'super_admin'];

function fail(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  throw err;
}

function cleanZone(body, existing = {}) {
  const name = String(body.name ?? existing.name ?? '').trim();
  if (name.length < 2) throw new HttpError(400, 'Nom de la zone requis.');

  const number = (value, fallback) => {
    if (value === undefined) return fallback;
    const n = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Montant invalide.');
    return Math.round(n * 1000) / 1000;
  };

  return {
    name: name.slice(0, 80),
    fee: number(body.fee, existing.fee ?? 0),
    minimumOrder: number(body.minimumOrder, existing.minimumOrder ?? 0),
    estimatedMinutes: Math.max(
      0,
      Math.min(240, Number(body.estimatedMinutes ?? existing.estimatedMinutes ?? 30) || 0)
    ),
  };
}

/** Zones proposees au client : lecture publique, le site en a besoin. */
router.get('/', async (req, res) => {
  const zones = await DeliveryZone.findAll({
    where: { isActive: true },
    order: [['displayOrder', 'ASC'], ['fee', 'ASC']],
  });
  res.json(zones);
});

/** Vue du gerant : y compris les zones desactivees. */
router.get('/all', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const zones = await DeliveryZone.findAll({
    order: [['displayOrder', 'ASC'], ['fee', 'ASC']],
  });
  res.json(zones);
});

router.post('/', requireAuth, requireRole(...MANAGER), async (req, res) => {
  try {
    // Agregation : le cloisonnement ne s'y applique pas tout seul.
    const last = await DeliveryZone.max('displayOrder', { where: filtreEtablissement() });
    const zone = await DeliveryZone.create({
      ...cleanZone(req.body),
      displayOrder: Number.isFinite(last) ? last + 1 : 0,
    });
    await audit.record(req, {
      action: 'zone.created',
      entityType: 'delivery_zone',
      entityId: zone.id,
      summary: `Zone « ${zone.name} » créée à ${zone.fee.toFixed(3)} DT`,
      details: { name: zone.name, fee: zone.fee },
    });
    res.status(201).json(zone);
  } catch (err) {
    fail(res, err);
  }
});

router.put('/:id', requireAuth, requireRole(...MANAGER), async (req, res) => {
  try {
    const zone = await DeliveryZone.findByPk(req.params.id);
    if (!zone) return res.status(404).json({ error: 'Zone introuvable.' });

    const before = zone.fee;
    const patch = cleanZone(req.body, zone.toJSON());
    if (req.body.isActive !== undefined) patch.isActive = Boolean(req.body.isActive);
    await zone.update(patch);

    // Les frais de livraison sont un prix : un changement se consigne.
    if (patch.fee !== undefined && patch.fee !== before) {
      await audit.record(req, {
        action: 'zone.fee_changed',
        entityType: 'delivery_zone',
        entityId: zone.id,
        summary: `${zone.name} : ${before.toFixed(3)} → ${patch.fee.toFixed(3)} DT`,
        details: { name: zone.name, from: before, to: patch.fee },
      });
    }
    res.json(zone);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Une zone se desactive, elle ne se supprime pas : des commandes passees
 * s'y rattachent, et le rapport de livraison doit rester lisible.
 */
router.delete('/:id', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const zone = await DeliveryZone.findByPk(req.params.id);
  if (!zone) return res.status(404).json({ error: 'Zone introuvable.' });
  zone.isActive = false;
  await zone.save();
  await audit.record(req, {
    action: 'zone.disabled',
    entityType: 'delivery_zone',
    entityId: zone.id,
    summary: `Zone « ${zone.name} » retirée de la livraison`,
  });
  res.json({ ok: true });
});

router.put('/reorder/all', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  for (const [index, id] of ids.entries()) {
    await DeliveryZone.update({ displayOrder: index }, { where: { id } });
  }
  res.json({ ok: true });
});

module.exports = router;
