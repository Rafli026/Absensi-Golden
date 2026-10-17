// Time helpers. Timezone is fixed to Asia/Jakarta (UTC+7, no DST).

const TZ = process.env.APP_TIMEZONE || 'Asia/Jakarta';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** 'YYYY-MM-DD' in Jakarta. */
export function jakartaDate(d = new Date()) {
  return dateFmt.format(d);
}

/** 'HH:mm:ss' in Jakarta. */
export function jakartaTime(d = new Date()) {
  return timeFmt.format(d);
}

/** 'HH:mm' in Jakarta. */
export function jakartaHHmm(d = new Date()) {
  return jakartaTime(d).slice(0, 5);
}

/** Integer minutes of day from an 'HH:mm' or 'HH:mm:ss' string. */
export function minutesOfDay(hhmm) {
  const [h, m] = String(hhmm).split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** ISO UTC string. */
export function isoUtc(d = new Date()) {
  return d.toISOString();
}

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY'. Returns '' on bad input. */
export function formatDateDDMMYYYY(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = String(dateKey).split('-');
  if (!y || !m || !d) return String(dateKey);
  return `${d}-${m}-${y}`;
}

/** ISO weekday number Mon=1..Sun=7 for a 'YYYY-MM-DD' key. */
export function isoWeekday(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

/**
 * Whether a date is a workday per schedule.
 * schedule = { work_days: number[] (ISO 1..7), holidays: string[] ('YYYY-MM-DD') }
 */
export function isWorkday(dateKey, schedule) {
  const days = Array.isArray(schedule?.work_days) ? schedule.work_days : [1, 2, 3, 4, 5, 6];
  const holidays = Array.isArray(schedule?.holidays) ? schedule.holidays : [];
  if (holidays.includes(dateKey)) return false;
  return days.includes(isoWeekday(dateKey));
}

/** Current Jakarta period 'YYYY-MM'. */
export function currentPeriod(d = new Date()) {
  return jakartaDate(d).slice(0, 7);
}

/** Validate a 'YYYY-MM' period string. */
export function isValidPeriod(p) {
  return typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

/** Shift a 'YYYY-MM' period by N months (can be negative). */
export function shiftPeriod(period, deltaMonths) {
  const [y, m] = period.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export { TZ };
