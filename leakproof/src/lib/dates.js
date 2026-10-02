// Date helpers. All dates are handled as local-midnight Date objects and
// stored as ISO "YYYY-MM-DD" strings so they survive JSON round-trips.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

export const DAY_MS = 86_400_000;

export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function daysBetween(fromIso, toIso) {
  return Math.round((fromISO(toIso) - fromISO(fromIso)) / DAY_MS);
}

// Matches "October 14, 2026", "Oct 14 2026", "Oct. 14", "14 October 2026",
// "2026-10-14", "10/14/2026" and "10/14". The year falls back to `ref`'s
// year, rolled forward if that would put the date more than ~2 months back.
const DATE_PATTERNS = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i,
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/i,
  /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
];

export function parseDate(text, ref = new Date()) {
  if (!text) return null;
  let m;
  if ((m = text.match(DATE_PATTERNS[0]))) {
    return build(+m[1], +m[2] - 1, +m[3]);
  }
  if ((m = text.match(DATE_PATTERNS[1]))) {
    return withYear(MONTHS[m[1].toLowerCase()], +m[2], m[3], ref);
  }
  if ((m = text.match(DATE_PATTERNS[2]))) {
    return withYear(MONTHS[m[2].toLowerCase()], +m[1], m[3], ref);
  }
  if ((m = text.match(DATE_PATTERNS[3]))) {
    let year = m[3];
    if (year && year.length === 2) year = `20${year}`;
    return withYear(+m[1] - 1, +m[2], year, ref);
  }
  return null;
}

function build(y, mo, d) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const date = new Date(y, mo, d);
  return date.getMonth() === mo ? date : null;
}

function withYear(month, day, year, ref) {
  if (year) return build(+year, month, day);
  const guess = build(ref.getFullYear(), month, day);
  if (guess && ref - guess > 60 * DAY_MS) return build(ref.getFullYear() + 1, month, day);
  return guess;
}

// "in 3 days", "within 30 days", "7 days from now"
export function parseRelativeDays(text) {
  const m = text.match(/\b(?:in|within)\s+(\d{1,3})\s+days?\b|\b(\d{1,3})\s+days?\s+(?:from|after)\b/i);
  if (!m) return null;
  return Number(m[1] || m[2]);
}
