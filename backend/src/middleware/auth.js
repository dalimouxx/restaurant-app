const jwt = require('jsonwebtoken');
const { avecRestaurant, surToutelInstallation } = require('../tenant');
const { etablissementUnique, parRepere } = require('./restaurantPublic');

/**
 * Verifie le jeton, puis place la suite de la requete au nom du
 * restaurant de l'utilisateur.
 *
 * C'est ici que le cloisonnement prend effet : tout ce qui s'execute
 * apres `next()` ne verra que les donnees de cet etablissement, sans
 * qu'aucune route n'ait a y penser.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  const token = header.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expire.' });
  }

  req.user = payload; // { id, role, restaurantId }
  req.restaurantId = payload.restaurantId || null;

  /**
   * Le super admin peut demander a travailler dans un etablissement
   * precis, en le nommant dans l'en-tete. Sans cette precision il voit
   * l'installation entiere — c'est la seule facon de lister les
   * restaurants ou de comparer leurs chiffres.
   *
   * Personne d'autre ne peut changer d'etablissement, meme en envoyant
   * l'en-tete : le restaurant vient alors du jeton, signe a la
   * connexion, et rien dans la requete ne peut le deplacer.
   */
  if (payload.role === 'super_admin') {
    const demande = req.headers['x-restaurant'];
    if (demande) {
      // L'en-tete porte souvent le repere lisible plutot que
      // l'identifiant : le prendre pour un UUID faisait echouer la
      // requete sur une erreur de type, loin de la cause.
      return parRepere(demande)
        .then((etablissement) => {
          if (!etablissement) {
            return res.status(404).json({ error: 'Etablissement inconnu.' });
          }
          req.restaurantId = etablissement.id;
          return avecRestaurant(etablissement.id, next);
        })
        .catch(next);
    }

    /**
     * Sans precision, deux cas tres differents.
     *
     * Un seul etablissement dans l'installation : il n'y a rien a
     * choisir, et exiger un choix rendrait le super admin incapable de
     * regler le seul restaurant qu'il administre. C'est aussi ce qui
     * permet a toutes les installations existantes de continuer sans
     * rien changer.
     *
     * Plusieurs : on reste sur l'installation entiere, ce qu'il faut
     * pour lister les etablissements et comparer leurs chiffres. Les
     * operations propres a un restaurant refuseront alors de deviner.
     */
    return etablissementUnique()
      .then((seul) => {
        if (!seul) return surToutelInstallation(next);
        req.restaurantId = seul.id;
        return avecRestaurant(seul.id, next);
      })
      .catch(next);
  }

  if (req.restaurantId) {
    return avecRestaurant(req.restaurantId, next);
  }

  /**
   * Un compte sans etablissement, c'est un client.
   *
   * Dans une chaine, la meme personne commande chez plusieurs fastfoods :
   * son compte ne peut pas etre rattache a l'un d'eux. L'etablissement
   * vient alors de la requete — resolu plus haut a partir du repere de
   * l'adresse ou de l'unique etablissement de l'installation — et c'est
   * sa commande, pas son compte, qui portera le restaurant.
   */
  if (req.user.role === 'customer') {
    // La resolution publique a deja pose le contexte si elle a trouve.
    return next();
  }

  return res.status(403).json({
    error: 'Ce compte n\'est rattache a aucun etablissement.',
  });
}

// Restreint l'acces a certains roles seulement.
// Usage: requireRole('manager', 'super_admin')
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Vous n'avez pas les droits pour cette action." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
