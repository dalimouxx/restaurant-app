/**
 * Erreur metier : un refus que le client doit pouvoir lire.
 *
 * Tout ce qui n'est pas une HttpError est un defaut du serveur. La
 * distinction compte : le message d'une HttpError est ecrit pour etre lu
 * par la personne devant l'ecran, celui d'une erreur quelconque peut
 * contenir une requete SQL ou un chemin de fichier, et n'a rien a faire
 * dans une reponse.
 */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Raccourci pour le cas courant : la demande est invalide. */
const badRequest = (message) => new HttpError(400, message);

module.exports = { HttpError, badRequest };
