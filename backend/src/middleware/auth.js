const jwt = require('jsonwebtoken');

// Verifie que la requete contient un token JWT valide (Authorization: Bearer xxx)
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expire.' });
  }
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
