/**
 * Horaires d'ouverture.
 *
 * Sans eux, le site accepte une commande a 3 h du matin : le client paie,
 * personne ne prepare, et c'est le restaurant qui s'excuse. Les horaires
 * ne ferment que la commande en ligne. Le personnel encaisse quand il
 * veut — une caisse qui refuse de servir parce qu'il est 23 h 05 serait
 * absurde.
 */

const TIMEZONE = process.env.RESTAURANT_TIMEZONE || 'Africa/Tunis';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DAY_LABELS = {
  mon: 'lundi',
  tue: 'mardi',
  wed: 'mercredi',
  thu: 'jeudi',
  fri: 'vendredi',
  sat: 'samedi',
  sun: 'dimanche',
};

/** Ouvert tous les jours de 11 h a 23 h, tant que rien n'est saisi. */
const DEFAULT_HOURS = Object.fromEntries(
  DAYS.map((d) => [d, { open: '11:00', close: '23:00', closed: false }])
);

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hhmm) {
  const m = TIME.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Garde la forme attendue et jette ce qui ne l'est pas. */
function normalizeHours(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_HOURS };

  const clean = {};
  for (const day of DAYS) {
    const entry = parsed[day] || {};
    const open = TIME.test(entry.open) ? entry.open : DEFAULT_HOURS[day].open;
    const close = TIME.test(entry.close) ? entry.close : DEFAULT_HOURS[day].close;
    clean[day] = { open, close, closed: Boolean(entry.closed) };
  }
  return clean;
}

/** Jour et heure locale du restaurant, quelle que soit l'heure du serveur. */
function localNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday').toLowerCase().slice(0, 3);
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));

  return {
    dayIndex: Math.max(0, DAYS.indexOf(weekday)),
    minutes: (hour % 24) * 60 + minute,
  };
}

/**
 * Le restaurant est-il ouvert maintenant, et sinon quand rouvre-t-il ?
 *
 * Une fermeture plus tot que l'ouverture decrit un service qui passe
 * minuit (18 h – 02 h) : la plage se poursuit le lendemain matin.
 */
function openingState(rawHours, date = new Date()) {
  const hours = normalizeHours(rawHours);
  const { dayIndex, minutes } = localNow(date);

  const inRange = (day, nowMinutes) => {
    const entry = hours[DAYS[day]];
    if (!entry || entry.closed) return false;
    const open = minutesOf(entry.open);
    const close = minutesOf(entry.close);
    if (open === null || close === null) return false;
    if (close > open) return nowMinutes >= open && nowMinutes < close;
    if (close < open) return nowMinutes >= open; // la plage part vers minuit
    return false; // ouverture et fermeture identiques : journee vide
  };

  // Service de la veille qui mord sur ce matin (18 h – 02 h, il est 1 h).
  const yesterday = (dayIndex + 6) % 7;
  const prev = hours[DAYS[yesterday]];
  if (prev && !prev.closed) {
    const open = minutesOf(prev.open);
    const close = minutesOf(prev.close);
    if (open !== null && close !== null && close < open && minutes < close) {
      return { open: true, opensAt: null, dayLabel: DAY_LABELS[DAYS[yesterday]] };
    }
  }

  if (inRange(dayIndex, minutes)) {
    return { open: true, opensAt: null, dayLabel: DAY_LABELS[DAYS[dayIndex]] };
  }

  // Prochaine ouverture : aujourd'hui s'il reste du temps, sinon les jours suivants.
  for (let step = 0; step < 8; step++) {
    const day = (dayIndex + step) % 7;
    const entry = hours[DAYS[day]];
    if (!entry || entry.closed) continue;
    const open = minutesOf(entry.open);
    if (open === null) continue;
    if (step === 0 && minutes >= open) continue;
    return {
      open: false,
      opensAt: entry.open,
      opensDay: step === 0 ? "aujourd'hui" : step === 1 ? 'demain' : DAY_LABELS[DAYS[day]],
      dayLabel: DAY_LABELS[DAYS[dayIndex]],
    };
  }

  // Aucun jour ouvre : le gerant a tout ferme.
  return { open: false, opensAt: null, opensDay: null, dayLabel: DAY_LABELS[DAYS[dayIndex]] };
}

module.exports = { DAYS, DAY_LABELS, DEFAULT_HOURS, normalizeHours, openingState };
