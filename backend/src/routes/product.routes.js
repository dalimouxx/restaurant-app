const express = require('express');
const { filtreEtablissement } = require('../tenant');
const {
  Product,
  Category,
  Ingredient,
  ProductIngredient,
  ProductOption,
  OrderItem,
} = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recomputeAvailability } = require('./stock.routes');
const audit = require('../audit');

const router = express.Router();

const MANAGER = ['manager', 'admin', 'super_admin'];

/** Erreur de saisie : le message doit remonter au gerant, pas un 500 muet. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  throw err;
}

/**
 * Une photo arrive en data URL, reduite par le navigateur. On plafonne
 * quand meme cote serveur : la carte est relue a chaque ouverture de la
 * borne, et des images lourdes la rendraient inutilisable.
 */
const MAX_IMAGE_CHARS = 400_000; // ~300 ko binaires

function normalizeImage(value) {
  if (value === undefined) return undefined; // champ absent : on n'y touche pas
  if (value === null || value === '') return null; // photo retiree

  const image = String(value);
  if (/^https?:\/\//i.test(image)) {
    return image.slice(0, 2000);
  }
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(image)) {
    throw new HttpError(400, 'Format de photo non reconnu.');
  }
  if (image.length > MAX_IMAGE_CHARS) {
    throw new HttpError(413, 'Photo trop lourde. Choisissez une image plus petite.');
  }
  return image;
}

function cleanName(value, what) {
  const name = String(value ?? '').trim();
  if (name.length < 2) throw new HttpError(400, `${what} requis.`);
  return name.slice(0, 120);
}

function cleanPrice(value) {
  const price = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(price) || price < 0) {
    throw new HttpError(400, 'Prix invalide.');
  }
  return Math.round(price * 1000) / 1000; // le millime est la plus petite unite
}

/** Recettes de plusieurs produits, a plat : [{ ingredientId, quantityNeeded }]. */
async function recipesFor(productIds) {
  if (productIds.length === 0) return {};
  const links = await ProductIngredient.findAll({ where: { productId: productIds } });
  const byProduct = {};
  for (const link of links) {
    (byProduct[link.productId] ||= []).push({
      ingredientId: link.ingredientId,
      quantityNeeded: link.quantityNeeded,
    });
  }
  return byProduct;
}

/* ─────────── Lecture ─────────── */

/**
 * Menu public : borne, site, caisse. Les plats retires de la carte n'y
 * figurent pas. Les plats epuises y restent, afficher « epuise » valant
 * mieux que faire disparaitre un plat que le client cherche.
 */
router.get('/', async (req, res) => {
  const products = await Product.findAll({
    where: { isArchived: false },
    include: [
      { model: Category },
      {
        model: ProductOption,
        as: 'options',
        where: { isActive: true },
        required: false,
        attributes: ['id', 'kind', 'label', 'extraPrice', 'displayOrder'],
      },
    ],
    order: [
      ['displayOrder', 'ASC'],
      ['name', 'ASC'],
      [{ model: ProductOption, as: 'options' }, 'displayOrder', 'ASC'],
    ],
  });
  res.json(products);
});

router.get('/categories', async (req, res) => {
  const categories = await Category.findAll({ order: [['displayOrder', 'ASC']] });
  res.json(categories);
});

/**
 * Vue du gerant : tout, y compris les plats retires de la carte, avec la
 * recette de chacun. Un seul appel pour alimenter l'ecran Carte.
 */
router.get('/all', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const products = await Product.findAll({
    include: [
      {
        model: ProductOption,
        as: 'options',
        where: { isActive: true },
        required: false,
        attributes: ['id', 'kind', 'label', 'extraPrice', 'ingredientId', 'quantityDelta', 'displayOrder'],
      },
    ],
    order: [
      ['displayOrder', 'ASC'],
      ['name', 'ASC'],
      [{ model: ProductOption, as: 'options' }, 'displayOrder', 'ASC'],
    ],
  });

  const recipes = await recipesFor(products.map((p) => p.id));
  res.json(
    products.map((p) => ({ ...p.toJSON(), recipe: recipes[p.id] ?? [] }))
  );
});

/** Choix predefinis d'un produit (retraits et ajouts). */
router.get('/:id/options', async (req, res) => {
  const options = await ProductOption.findAll({
    where: { productId: req.params.id, isActive: true },
    order: [['kind', 'ASC'], ['displayOrder', 'ASC']],
  });
  res.json(options);
});

/* ─────────── Categories ─────────── */

router.post('/categories', requireAuth, requireRole(...MANAGER), async (req, res) => {
  try {
    const name = cleanName(req.body.name, 'Nom de la categorie');
    // Agregation : le cloisonnement ne s'y applique pas tout seul.
    const last = await Category.max('displayOrder', { where: filtreEtablissement() });
    const category = await Category.create({
      name,
      displayOrder: Number.isFinite(last) ? last + 1 : 0,
    });
    res.status(201).json(category);
  } catch (err) {
    fail(res, err);
  }
});

/** Remet les categories dans l'ordre recu. */
router.put('/categories/reorder', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  for (const [index, id] of ids.entries()) {
    await Category.update({ displayOrder: index }, { where: { id } });
  }
  const categories = await Category.findAll({ order: [['displayOrder', 'ASC']] });
  res.json(categories);
});

router.put('/categories/:id', requireAuth, requireRole(...MANAGER), async (req, res) => {
  try {
    const category = await Category.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: 'Categorie introuvable.' });
    await category.update({ name: cleanName(req.body.name, 'Nom de la categorie') });
    res.json(category);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Suppression refusee des qu'un plat s'y rattache.
 *
 * Le refus n'est pas une precaution de principe : la contrainte de cle
 * etrangere supprimerait en cascade les plats de la categorie, et avec eux
 * les lignes de commande qui les citent. On prefere expliquer au gerant ce
 * qu'il doit faire d'abord.
 */
router.delete('/categories/:id', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return res.status(404).json({ error: 'Categorie introuvable.' });

  const active = await Product.count({
    where: { categoryId: category.id, isArchived: false },
  });
  if (active > 0) {
    return res.status(409).json({
      error:
        `${active} plat${active > 1 ? 's' : ''} encore dans cette categorie. ` +
        `Deplacez-${active > 1 ? 'les' : 'le'} ailleurs ou retirez-${active > 1 ? 'les' : 'le'} de la carte d'abord.`,
    });
  }

  const archived = await Product.count({ where: { categoryId: category.id } });
  if (archived > 0) {
    return res.status(409).json({
      error:
        'Cette categorie contient des plats retires de la carte, gardes pour que ' +
        'les tickets et les statistiques passes restent justes. Renommez-la ' +
        'plutot que de la supprimer : elle n\'apparait plus nulle part.',
    });
  }

  await category.destroy();
  res.json({ ok: true });
});

/* ─────────── Produits ─────────── */

router.post('/', requireAuth, requireRole(...MANAGER), async (req, res) => {
  try {
    const { description, imageUrl, categoryId, recipe, options } = req.body;

    const category = await Category.findByPk(categoryId);
    if (!category) return res.status(400).json({ error: 'Categorie inconnue.' });

    const last = await Product.max('displayOrder', {
      where: { categoryId, ...filtreEtablissement() },
    });
    const product = await Product.create({
      name: cleanName(req.body.name, 'Nom du plat'),
      price: cleanPrice(req.body.price),
      description: description ? String(description).slice(0, 500) : null,
      imageUrl: normalizeImage(imageUrl) ?? null,
      prepMinutes: Math.max(0, Math.min(180, Number(req.body.prepMinutes) || 0)),
      categoryId,
      displayOrder: Number.isFinite(last) ? last + 1 : 0,
    });

    if (Array.isArray(recipe)) await replaceRecipe(product.id, recipe);
    if (Array.isArray(options)) {
      for (const [index, option] of options.entries()) {
        await createOption(product.id, { ...option, displayOrder: index });
      }
    }

    res.status(201).json(product);
  } catch (err) {
    fail(res, err);
  }
});

/** Remet les plats d'une categorie dans l'ordre recu. */
router.put('/reorder', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  for (const [index, id] of ids.entries()) {
    await Product.update({ displayOrder: index }, { where: { id } });
  }
  res.json({ ok: true });
});

router.put('/:id', requireAuth, requireRole(...MANAGER), async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Plat introuvable.' });

    const patch = {};
    if (req.body.name !== undefined) patch.name = cleanName(req.body.name, 'Nom du plat');
    if (req.body.price !== undefined) patch.price = cleanPrice(req.body.price);
    if (req.body.description !== undefined) {
      patch.description = req.body.description
        ? String(req.body.description).slice(0, 500)
        : null;
    }
    if (req.body.imageUrl !== undefined) patch.imageUrl = normalizeImage(req.body.imageUrl);
    if (req.body.isAvailable !== undefined) patch.isAvailable = !!req.body.isAvailable;
    if (req.body.prepMinutes !== undefined) {
      patch.prepMinutes = Math.max(0, Math.min(180, Number(req.body.prepMinutes) || 0));
    }
    if (req.body.categoryId !== undefined) {
      const category = await Category.findByPk(req.body.categoryId);
      if (!category) return res.status(400).json({ error: 'Categorie inconnue.' });
      patch.categoryId = req.body.categoryId;
    }

    const previousPrice = product.price;
    await product.update(patch);
    if (Array.isArray(req.body.recipe)) await replaceRecipe(product.id, req.body.recipe);

    // Un prix qui bouge est l'operation la plus sensible de la carte :
    // elle change ce que paient tous les clients suivants.
    if (patch.price !== undefined && patch.price !== previousPrice) {
      await audit.record(req, {
        action: 'product.price_changed',
        entityType: 'product',
        entityId: product.id,
        summary: `${product.name} : ${previousPrice.toFixed(3)} → ${patch.price.toFixed(3)} DT`,
        details: { name: product.name, from: previousPrice, to: patch.price },
      });
    }

    res.json(product);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Epuise / de nouveau disponible, d'un geste. La cuisine y a acces aussi :
 * c'est elle qui constate la rupture, souvent en pleine affluence.
 *
 * La decision est memorisee a part du stock : remettre un plat en vente ne
 * garantit pas qu'il reparaisse, si les ingredients manquent reellement.
 */
router.post(
  '/:id/toggle-available',
  requireAuth,
  requireRole('cook', ...MANAGER),
  async (req, res) => {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Plat introuvable.' });

    const nowUnavailable = product.isAvailable;
    product.manuallyUnavailable = nowUnavailable;
    await product.save();
    await recomputeAvailability(product);

    await audit.record(req, {
      action: nowUnavailable ? 'product.marked_sold_out' : 'product.back_on_sale',
      entityType: 'product',
      entityId: product.id,
      summary: nowUnavailable
        ? `${product.name} déclaré épuisé`
        : `${product.name} remis en vente`,
    });

    res.json(product);
  }
);

/**
 * Retrait de la carte. Si le plat n'a jamais ete vendu on le supprime pour
 * de bon ; sinon on l'archive, sans quoi les statistiques et les tickets
 * passes perdraient leur reference.
 */
router.delete('/:id', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ error: 'Plat introuvable.' });

  const sold = await OrderItem.count({ where: { productId: product.id } });
  if (sold === 0) {
    await ProductOption.destroy({ where: { productId: product.id } });
    await ProductIngredient.destroy({ where: { productId: product.id } });
    await product.destroy();
    await audit.record(req, {
      action: 'product.deleted',
      entityType: 'product',
      entityId: product.id,
      summary: `${product.name} supprimé (jamais vendu)`,
      details: { name: product.name, price: product.price },
    });
    return res.json({ ok: true, deleted: true });
  }

  product.isArchived = true;
  await product.save();
  await audit.record(req, {
    action: 'product.archived',
    entityType: 'product',
    entityId: product.id,
    summary: `${product.name} retiré de la carte`,
    details: { name: product.name, price: product.price, soldCount: sold },
  });
  res.json({ ok: true, deleted: false, archived: true });
});

router.post('/:id/restore', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ error: 'Plat introuvable.' });
  product.isArchived = false;
  await product.save();
  res.json(product);
});

/* ─────────── Recette ─────────── */

async function replaceRecipe(productId, recipe) {
  const rows = [];
  for (const line of recipe) {
    const quantity = Number(String(line.quantityNeeded ?? '').replace(',', '.'));
    if (!line.ingredientId || !Number.isFinite(quantity) || quantity <= 0) continue;
    const ingredient = await Ingredient.findByPk(line.ingredientId);
    if (!ingredient) continue;
    rows.push({ productId, ingredientId: line.ingredientId, quantityNeeded: quantity });
  }
  // Remplacement complet : l'ecran envoie toujours la recette entiere.
  await ProductIngredient.destroy({ where: { productId } });
  for (const row of rows) await ProductIngredient.create(row);
  return rows;
}

router.get('/:id/recipe', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const links = await ProductIngredient.findAll({ where: { productId: req.params.id } });
  res.json(
    links.map((l) => ({ ingredientId: l.ingredientId, quantityNeeded: l.quantityNeeded }))
  );
});

router.put('/:id/recipe', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const product = await Product.findByPk(req.params.id);
  if (!product) return res.status(404).json({ error: 'Plat introuvable.' });
  const recipe = Array.isArray(req.body.recipe) ? req.body.recipe : [];
  res.json(await replaceRecipe(product.id, recipe));
});

/* ─────────── Choix predefinis ─────────── */

async function createOption(productId, body) {
  const { kind, label, extraPrice, ingredientId, quantityDelta, displayOrder } = body;

  if (!['remove', 'add'].includes(kind)) {
    throw new HttpError(400, 'Type de choix invalide.');
  }

  return ProductOption.create({
    productId,
    kind,
    label: cleanName(label, 'Intitule du choix'),
    // Un retrait ne se facture pas : c'est ce que le client ne prend pas.
    extraPrice: kind === 'remove' ? 0 : cleanPrice(extraPrice ?? 0),
    ingredientId: ingredientId || null,
    quantityDelta: Number(String(quantityDelta ?? 0).replace(',', '.')) || 0,
    displayOrder: Number(displayOrder) || 0,
  });
}

router.post('/:id/options', requireAuth, requireRole(...MANAGER), async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Plat introuvable.' });
    res.status(201).json(await createOption(product.id, req.body));
  } catch (err) {
    fail(res, err);
  }
});

router.put('/options/:optionId', requireAuth, requireRole(...MANAGER), async (req, res) => {
  try {
    const option = await ProductOption.findByPk(req.params.optionId);
    if (!option) return res.status(404).json({ error: 'Choix introuvable.' });

    const patch = {};
    if (req.body.label !== undefined) {
      patch.label = cleanName(req.body.label, 'Intitule du choix');
    }
    if (req.body.extraPrice !== undefined) {
      patch.extraPrice = option.kind === 'remove' ? 0 : cleanPrice(req.body.extraPrice);
    }
    if (req.body.ingredientId !== undefined) {
      patch.ingredientId = req.body.ingredientId || null;
    }
    if (req.body.quantityDelta !== undefined) {
      patch.quantityDelta =
        Number(String(req.body.quantityDelta).replace(',', '.')) || 0;
    }
    if (req.body.displayOrder !== undefined) {
      patch.displayOrder = Number(req.body.displayOrder) || 0;
    }

    await option.update(patch);
    res.json(option);
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/options/:optionId', requireAuth, requireRole(...MANAGER), async (req, res) => {
  const option = await ProductOption.findByPk(req.params.optionId);
  if (!option) return res.status(404).json({ error: 'Choix introuvable.' });
  // Desactive plutot que supprime : les commandes passees y font reference.
  option.isActive = false;
  await option.save();
  res.json({ ok: true });
});

// La verification de disponibilite selon le stock vit desormais dans
// stock.routes.js (`stockAllows`), au plus pres des mouvements de stock.

module.exports = { router };
