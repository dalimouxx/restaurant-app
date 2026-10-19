const { AuditLog } = require('./models');

/**
 * Ecrit une ligne au registre.
 *
 * Volontairement tolerant aux pannes : si l'ecriture du journal echoue, le
 * caissier ne doit pas se retrouver avec une annulation refusee et un
 * client qui attend. L'echec part dans les journaux du serveur, l'operation
 * metier continue.
 */
async function record(req, entry) {
  try {
    await AuditLog.create({
      userId: req.user?.id ?? null,
      userName: req.user?.fullName ?? 'Inconnu',
      userRole: req.user?.role ?? 'inconnu',
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 255),
      details: entry.details ?? null,
      ipAddress: req.ip ?? null,
    });
  } catch (err) {
    console.error('Journal non ecrit:', entry.action, err.message);
  }
}

module.exports = { record };
