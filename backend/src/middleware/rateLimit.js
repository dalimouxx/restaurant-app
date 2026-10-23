/**
 * Blocage progressif des tentatives de connexion ratees.
 *
 * Un code personnel fait quatre chiffres : dix mille combinaisons. Sans
 * limitation, un script les epuise en quelques minutes et entre avec le
 * compte d'un caissier, voire d'un gerant. C'est la contrepartie d'une
 * connexion sans mot de passe, et elle doit etre payee ici.
 *
 * Le comptage se fait par adresse, pas par code : compter par code
 * permettrait de bloquer volontairement le caissier d'en face en tapant
 * son code de travers, et surtout l'attaquant change de code a chaque
 * essai — c'est son adresse qui reste constante.
 *
 * Le compteur vit en memoire. Un redemarrage le remet a zero, ce qui est
 * acceptable : il faut quand meme recommencer l'attaque. En revanche, le
 * jour ou le serveur tournera en plusieurs processus sur un VPS, chaque
 * processus aura son compteur et le seuil effectif sera multiplie :
 * il faudra alors passer par Redis.
 */

/** Les echecs plus vieux que cette fenetre sont oublies. */
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Paliers. Genereux au debut : derriere une meme connexion Internet, tout
 * le personnel d'un restaurant partage une seule adresse, et un matin
 * difficile ne doit pas fermer la caisse.
 */
const STEPS = [
  { from: 20, lockMs: 60 * 60 * 1000 },
  { from: 16, lockMs: 15 * 60 * 1000 },
  { from: 12, lockMs: 5 * 60 * 1000 },
  { from: 8, lockMs: 60 * 1000 },
];

const buckets = new Map();

function keyFor(name, req) {
  return `${name}:${req.ip || 'inconnu'}`;
}

function currentBucket(key) {
  const bucket = buckets.get(key);
  if (!bucket) return null;
  // Fenetre glissante : au-dela, on repart de zero.
  if (Date.now() - bucket.firstFailureAt > WINDOW_MS && !isLocked(bucket)) {
    buckets.delete(key);
    return null;
  }
  return bucket;
}

function isLocked(bucket) {
  return bucket.lockedUntil > Date.now();
}

function lockMsFor(count) {
  const step = STEPS.find((s) => count >= s.from);
  return step ? step.lockMs : 0;
}

/** Middleware : refuse l'acces tant que le blocage court. */
function guard(name) {
  return (req, res, next) => {
    const bucket = currentBucket(keyFor(name, req));
    if (bucket && isLocked(bucket)) {
      const seconds = Math.ceil((bucket.lockedUntil - Date.now()) / 1000);
      res.set('Retry-After', String(seconds));
      return res.status(429).json({
        error:
          seconds > 90
            ? `Trop de tentatives. Reessayez dans ${Math.ceil(seconds / 60)} minutes.`
            : `Trop de tentatives. Reessayez dans ${seconds} secondes.`,
        retryAfter: seconds,
      });
    }
    next();
  };
}

/** A appeler sur chaque echec d'authentification. */
function recordFailure(name, req) {
  const key = keyFor(name, req);
  const bucket = currentBucket(key) ?? {
    count: 0,
    firstFailureAt: Date.now(),
    lockedUntil: 0,
  };

  bucket.count += 1;
  const lockMs = lockMsFor(bucket.count);
  if (lockMs > 0) bucket.lockedUntil = Date.now() + lockMs;

  buckets.set(key, bucket);
  return bucket;
}

/** Une connexion reussie efface l'ardoise de cette adresse. */
function recordSuccess(name, req) {
  buckets.delete(keyFor(name, req));
}

/** Evite que la table grossisse indefiniment sur un serveur de longue duree. */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.lockedUntil < now && now - bucket.firstFailureAt > WINDOW_MS) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000);
sweep.unref?.(); // ne doit pas empecher le processus de se terminer

/* ─────────── Debit des points d'entree publics ─────────── */

/**
 * Limite simple du nombre d'appels, pour les routes ouvertes a tous.
 *
 * La borne et l'inscription client n'exigent aucun compte : c'est
 * necessaire, mais cela signifie qu'une seule boucle peut remplir la file
 * de la caisse de fausses commandes jusqu'a rendre l'ecran inutilisable,
 * ou creer des milliers de comptes. Le compteur ci-dessus ne sert a rien
 * ici, puisque ces appels reussissent.
 *
 * Les seuils sont larges : une borne en plein coup de feu ne doit jamais
 * les atteindre.
 */
const counters = new Map();

function throttle(name, { max, windowMs }) {
  return (req, res, next) => {
    const key = `${name}:${req.ip || 'inconnu'}`;
    const now = Date.now();
    const entry = counters.get(key);

    if (!entry || now - entry.startedAt > windowMs) {
      counters.set(key, { count: 1, startedAt: now });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const seconds = Math.ceil((entry.startedAt + windowMs - now) / 1000);
      res.set('Retry-After', String(seconds));
      return res.status(429).json({
        error: 'Trop de demandes. Patientez un instant.',
        retryAfter: seconds,
      });
    }
    next();
  };
}

/* ─────────── Ralentir sans jamais fermer la porte ─────────── */

/**
 * Le compteur de l'ecran de verrouillage.
 *
 * Les paliers ci-dessus bloquent : au bout de huit echecs, plus personne
 * ne se connecte pendant une minute, puis cinq, puis une heure. C'est
 * exactement ce qu'il faut pour une page de connexion, et exactement ce
 * qu'il ne faut pas pour lever le voile d'un poste deja ouvert.
 *
 * Un ecran de verrouillage se fait taper de travers tous les jours :
 * quelqu'un passe devant la tablette et essaie, le caissier se trompe
 * d'un chiffre, un enfant appuie sur le pave. Avec un blocage dur, la
 * caisse finit couverte et inouvrable au milieu du service — pire que
 * pas de verrou du tout, parce que le gerant debranchera le verrou.
 *
 * Alors on ralentit au lieu de bloquer. Apres quelques ratés, il faut
 * attendre quelques secondes entre deux essais, et jamais plus que
 * PLAFOND_MS. Dix secondes d'attente suffisent largement : epuiser dix
 * mille codes en demandant dix secondes a chacun prend plus d'un jour,
 * sous les yeux de l'equipe, sur une tablette posee sur le comptoir. Et
 * celui qui revient des toilettes et tape juste n'attend rien.
 */
const APRES = 4;
const PAS_MS = 2500;
const PLAFOND_MS = 10 * 1000;

const lenteurs = new Map();

/** Middleware : impose un intervalle croissant apres quelques echecs. */
function ralentir(name) {
  return (req, res, next) => {
    const entry = lenteurs.get(keyFor(name, req));
    if (!entry || entry.count <= APRES) return next();

    const attente = Math.min(PLAFOND_MS, (entry.count - APRES) * PAS_MS);
    const reste = entry.lastAt + attente - Date.now();
    if (reste <= 0) return next();

    /**
     * L'essai refuse compte lui aussi.
     *
     * Sans cela l'escalade ne demarre jamais : les essais bloques
     * n'incrementant rien, le compteur reste a cinq et l'attente a deux
     * secondes et demie — un script epuise alors les dix mille codes en
     * une poignee d'heures. En comptant, il se retrouve au plafond en
     * quelques secondes et chaque code lui coute dix secondes, sur une
     * tablette posee sur un comptoir, sous les yeux de l'equipe.
     *
     * Le prix : celui qui arrive juste apres quelqu'un qui a martele
     * l'ecran attend lui aussi, jusqu'a dix secondes. C'est le plafond
     * qui rend ce prix acceptable — dix secondes d'agacement contre une
     * caisse morte pendant une heure.
     */
    entry.count += 1;
    entry.lastAt = Date.now();

    const seconds = Math.ceil(reste / 1000);
    res.set('Retry-After', String(seconds));
    return res.status(429).json({
      error: `Patientez ${seconds} seconde${seconds > 1 ? 's' : ''}.`,
      retryAfter: seconds,
    });
  };
}

function recordSlowFailure(name, req) {
  const key = keyFor(name, req);
  const entry = lenteurs.get(key) ?? { count: 0, lastAt: 0 };
  entry.count += 1;
  entry.lastAt = Date.now();
  lenteurs.set(key, entry);
}

function recordSlowSuccess(name, req) {
  lenteurs.delete(keyFor(name, req));
}

/** Pour les tests : repart d'une table vide. */
function reset() {
  buckets.clear();
  counters.clear();
  lenteurs.clear();
}

const sweepCounters = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of counters) {
    if (now - entry.startedAt > WINDOW_MS) counters.delete(key);
  }
  for (const [key, entry] of lenteurs) {
    if (now - entry.lastAt > WINDOW_MS) lenteurs.delete(key);
  }
}, 5 * 60 * 1000);
sweepCounters.unref?.();

module.exports = {
  guard,
  recordFailure,
  recordSuccess,
  throttle,
  ralentir,
  recordSlowFailure,
  recordSlowSuccess,
  reset,
  WINDOW_MS,
  STEPS,
};
