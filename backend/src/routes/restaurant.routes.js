const express = require('express');
const { Restaurant, slugifier } = require('../models/Restaurant');
const { User, Order } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { surToutelInstallation, avecRestaurant } = require('../tenant');
const { oublierCache } = require('../middleware/restaurantPublic');
const { badRequest } = require('../errors');
const { record } = require('../audit');

const router = express.Router();

/**
 * Les etablissements de l'installation.
 *
 * Reserve au super admin : c'est le seul role qui voit au-dessus des
 * cloisons. Un gerant administre son restaurant et ignore jusqu'a
 * l'existence des autres.
 */
const seulSuperAdmin = [requireAuth, requireRole('super_admin', 'admin')];

/** Liste, avec de quoi se reperer quand il y en aura trente. */
router.get('/', ...seulSuperAdmin, async (req, res) => {
  const etablissements = await surToutelInstallation(() =>
    Restaurant.findAll({ order: [['createdAt', 'ASC']] })
  );

  // Un chiffre par etablissement, pour savoir lesquels travaillent.
  const avecActivite = await Promise.all(
    etablissements.map(async (r) => {
      const [employes, commandes] = await avecRestaurant(r.id, async () => [
        await User.count({ where: { role: ['manager', 'cashier', 'cook', 'driver'] } }),
        await Order.count({ where: { status: ['in_kitchen', 'preparing', 'ready'] } }),
      ]);
      return { ...r.toJSON(), employes, commandesEnCours: commandes };
    })
  );

  res.json(avecActivite);
});

router.post('/', ...seulSuperAdmin, async (req, res) => {
  const { name, slug, notes, logoUrl } = req.body;
  if (!name || String(name).trim().length < 2) {
    throw badRequest("Donnez un nom a l'etablissement.");
  }

  const repere = slugifier(slug || name);

  const etablissement = await surToutelInstallation(async () => {
    const pris = await Restaurant.findOne({ where: { slug: repere } });
    if (pris) {
      throw badRequest(
        `Le repere « ${repere} » est deja utilise par ${pris.name}. Choisissez-en un autre.`
      );
    }
    return Restaurant.create({
      name: String(name).trim(),
      slug: repere,
      notes: notes || null,
      logoUrl: logoUrl || null,
      isActive: true,
    });
  });

  // La resolution publique retient l'etablissement unique : elle doit
  // oublier ce qu'elle sait, maintenant qu'il y en a un de plus.
  oublierCache();

  // Le journal appartient a l'etablissement concerne : c'est la qu'un
  // gerant ira chercher pourquoi son service a ete suspendu.
  await avecRestaurant(etablissement.id, () =>
    record(req, {
      action: 'restaurant.create',
      details: { id: etablissement.id, name: etablissement.name },
    })
  );

  res.status(201).json(etablissement);
});

/**
 * Modification, suspension, reprise.
 *
 * Suspendre coupe tout : plus de commande acceptee, plus de connexion
 * pour ses equipes. Ses donnees restent intactes — on suspend un client
 * qui ne paie pas, on ne lui efface pas sa comptabilite, et il doit
 * pouvoir reprendre son service la ou il l'a laisse.
 */
router.patch('/:id', ...seulSuperAdmin, async (req, res) => {
  const { name, notes, logoUrl, isActive } = req.body;

  const etablissement = await surToutelInstallation(() =>
    Restaurant.findByPk(req.params.id)
  );
  if (!etablissement) return res.status(404).json({ error: 'Etablissement introuvable.' });

  // On ne suspend pas un restaurant qui a des commandes en cours : le
  // client qui attend son sandwich ne comprendrait pas, et la cuisine
  // perdrait ses tickets au milieu du service.
  if (isActive === false && etablissement.isActive) {
    const enCours = await avecRestaurant(etablissement.id, () =>
      Order.count({ where: { status: ['in_kitchen', 'preparing', 'ready', 'out_for_delivery'] } })
    );
    if (enCours > 0) {
      throw badRequest(
        `${enCours} commande(s) en cours chez ${etablissement.name}. ` +
        'Attendez la fin du service avant de suspendre.'
      );
    }
  }

  if (name !== undefined) etablissement.name = String(name).trim();
  if (notes !== undefined) etablissement.notes = notes || null;
  if (logoUrl !== undefined) etablissement.logoUrl = logoUrl || null;
  if (isActive !== undefined) etablissement.isActive = Boolean(isActive);

  await surToutelInstallation(() => etablissement.save());
  oublierCache();

  await avecRestaurant(etablissement.id, () =>
    record(req, {
      action: 'restaurant.update',
      details: {
        id: etablissement.id,
        name: etablissement.name,
        isActive: etablissement.isActive,
      },
    })
  );

  res.json(etablissement);
});

module.exports = router;
