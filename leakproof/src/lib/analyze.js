// Turns stored items into the leak report: what each item costs per year,
// why it is flagged, how urgent it is, and the overall leak meter.

import { daysBetween, toISO } from './dates.js';
import { merchantInfo } from './merchants.js';

const PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

export function monthlyCost(amount, cadence) {
  if (!amount) return 0;
  return amount * (PER_MONTH[cadence] ?? 1);
}

// Categories where paying for two at once is usually redundant.
const OVERLAP_CATEGORIES = new Set(['streaming', 'music', 'cloud storage', 'books']);

const URGENT_DAYS = { trial: 7, order: 7, renewal: 14, hike: 14 };

export function analyze(items, today = new Date()) {
  const todayIso = toISO(today);
  const active = items.filter((i) => i.status === 'active');

  const byCategory = new Map();
  for (const item of active) {
    if (item.kind !== 'subscription') continue;
    const cat = merchantInfo(item.merchant).category;
    if (!OVERLAP_CATEGORIES.has(cat)) continue;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(item.merchant);
  }

  const leaks = [];
  for (const item of active) {
    const leak = describe(item, todayIso, byCategory);
    if (leak) leaks.push(leak);
  }

  // Urgent first (soonest deadline), then the biggest yearly cost.
  leaks.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if (a.urgent && b.urgent) return a.daysLeft - b.daysLeft;
    return b.yearly - a.yearly;
  });

  const monthly = leaks
    .filter((l) => l.item.kind === 'subscription' || (l.item.kind === 'trial' && l.converted))
    .reduce((sum, l) => sum + l.monthly, 0);
  const atRisk = leaks
    .filter((l) => l.urgent && !l.converted)
    .reduce((sum, l) => sum + (l.item.amount || 0), 0);
  const saved = items.reduce((sum, i) => sum + (i.savedAmount || 0), 0);
  const kept = items.filter((i) => i.status === 'kept');

  return {
    leaks,
    alerts: leaks.filter((l) => l.urgent),
    kept,
    resolved: items.filter((i) => i.status === 'resolved'),
    totals: {
      monthly: round(monthly),
      yearly: round(monthly * 12),
      atRisk: round(atRisk),
      saved: round(saved),
      count: leaks.length,
    },
  };
}

function describe(item, todayIso, byCategory) {
  const daysLeft = item.deadline ? daysBetween(todayIso, item.deadline) : null;
  const monthly = monthlyCost(item.amount, item.cadence);
  const reasons = [];
  let urgent = false;
  let converted = false;
  let action = 'cancel';

  if (item.kind === 'trial') {
    if (daysLeft != null && daysLeft < 0) {
      converted = true;
      reasons.push(`Trial ended ${plural(-daysLeft, 'day')} ago. You're probably being charged now.`);
    } else if (daysLeft != null) {
      urgent = daysLeft <= URGENT_DAYS.trial;
      reasons.push(`Free trial converts ${when(daysLeft)} to ${money(item.amount, item.currency)}${per(item.cadence)}.`);
    } else {
      reasons.push(`Free trial that turns into ${money(item.amount, item.currency)}${per(item.cadence)}. Check the end date.`);
    }
    action = 'cancel-trial';
  } else if (item.kind === 'order') {
    if (daysLeft != null && daysLeft < 0) return null; // window closed
    urgent = daysLeft != null && daysLeft <= URGENT_DAYS.order;
    reasons.push(`Return window closes ${when(daysLeft)}. ${money(item.amount, item.currency)} is still refundable.`);
    action = 'return';
  } else {
    if (item.previousAmount && item.amount > item.previousAmount) {
      const delta = monthlyCost(item.amount - item.previousAmount, item.cadence);
      reasons.push(`Price went up ${money(item.amount - item.previousAmount, item.currency)}${per(item.cadence)} (${money(item.previousAmount, item.currency)} → ${money(item.amount, item.currency)}). That's ${money(delta * 12, item.currency)} more a year.`);
      action = 'negotiate';
      if (daysLeft != null && daysLeft >= 0 && daysLeft <= URGENT_DAYS.hike) urgent = true;
    }
    if (item.cadence === 'yearly' && daysLeft != null && daysLeft >= 0 && daysLeft <= URGENT_DAYS.renewal) {
      urgent = true;
      reasons.push(`Auto-renews ${when(daysLeft)} for ${money(item.amount, item.currency)}.`);
    }
    const cat = merchantInfo(item.merchant).category;
    const peers = (byCategory.get(cat) || []).filter((m) => m !== item.merchant);
    if (peers.length) reasons.push(`Overlaps with ${peers.join(', ')} (${cat}).`);
    if (!reasons.length) reasons.push(`Costs ${money(monthly * 12, item.currency)} a year.`);
  }

  return {
    item,
    monthly: round(item.kind === 'order' ? 0 : monthly),
    yearly: round(item.kind === 'order' ? item.amount || 0 : monthly * 12),
    daysLeft,
    urgent,
    converted,
    action,
    reasons,
  };
}

// What resolving an item is worth, credited to the savings counter.
export function savingsFor(item) {
  if (item.kind === 'order') return round(item.amount || 0);
  return round(monthlyCost(item.amount, item.cadence) * 12);
}

export function money(value, currency = 'USD') {
  if (value == null || Number.isNaN(value)) return '?';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    minimumFractionDigits: value >= 1000 || Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function per(cadence) {
  return { weekly: '/wk', monthly: '/mo', quarterly: '/qtr', yearly: '/yr' }[cadence] || '';
}

export function when(days) {
  if (days == null) return 'soon';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function round(n) {
  return Math.round(n * 100) / 100;
}
