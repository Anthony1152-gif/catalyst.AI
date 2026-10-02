// Offline extractor: turns pasted emails/receipts into leak items with plain
// pattern matching, so the app works with no API key and nothing leaves the
// device. The AI extractor (server/extract.js) returns the same item shape.
//
// Item shape:
//   kind           'subscription' | 'trial' | 'order'
//   merchant       display name
//   amount         subscription: recurring price; trial: price after the
//                  trial; order: refundable total
//   currency       'USD' | 'EUR' | 'GBP'
//   cadence        'weekly' | 'monthly' | 'quarterly' | 'yearly' | null
//   previousAmount set when a price increase was announced
//   deadline       ISO date: trial end, return-by date, renewal date or the
//                  date a price change takes effect
//   itemName       plan or product name
//   orderNumber    for orders
//   emailDate      ISO date the email was sent, when known
//   snippet        the sentence the deadline/amount came from

import { findMerchant } from './merchants.js';
import { addDays, fromISO, parseDate, parseRelativeDays, toISO } from './dates.js';

const MONEY = /(US\$|\$|€|£|USD\s?|EUR\s?|GBP\s?)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
const CURRENCY = { '$': 'USD', 'US$': 'USD', USD: 'USD', '€': 'EUR', EUR: 'EUR', '£': 'GBP', GBP: 'GBP' };

export function splitEmails(raw) {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  // Explicit separators win: a line of ---, ===, or ***.
  let parts = text.split(/\n\s*(?:-{3,}|={3,}|\*{3,})\s*\n/);
  if (parts.length === 1) {
    // Otherwise start a new email at every "From:" header after the first.
    parts = text.split(/\n(?=\s*From:\s)/i);
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function parseEmails(raw, today = new Date()) {
  return splitEmails(raw)
    .map((email) => parseEmail(email, today))
    .filter(Boolean);
}

export function parseEmail(email, today = new Date()) {
  const header = (name) => {
    const m = email.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'im'));
    return m ? m[1].trim() : '';
  };
  const from = header('From');
  const subject = header('Subject');
  const sentRaw = header('Date');
  const sent = parseDate(sentRaw, today) || today;
  // Scan the body only, so the sent date in the headers is never mistaken
  // for a deadline. The subject stays in as context ("trial ending").
  const body = email.replace(/^\s*(?:From|To|Cc|Subject|Date|Reply-To|Sent):.*$/gim, '').trim();
  const flat = `${subject}. ${body}`.replace(/\s+/g, ' ');
  const sentences = `${subject}.\n${body}`
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const merchant = detectMerchant(from, subject, body);
  const money = findMoney(flat);
  const cadence = detectCadence(flat);

  const base = {
    merchant,
    currency: money[0]?.currency || 'USD',
    emailDate: sentRaw ? toISO(sent) : null,
  };

  // Price increase on a subscription.
  if (/price\s+(?:is\s+)?(?:changing|change|increase|increasing|going up|update)|new (?:monthly |annual )?price|(?:rate|price) will (?:increase|change|go up)|raising (?:our|the|your) price/i.test(flat)) {
    const fromTo = flat.match(/from\s+(US\$|\$|€|£)\s?(\d+(?:\.\d{1,2})?)\s*(?:\/\s?\w+|\s+(?:a|per)\s+\w+)?\s+to\s+(US\$|\$|€|£)\s?(\d+(?:\.\d{1,2})?)/i);
    let previousAmount = null;
    let amount = null;
    if (fromTo) {
      previousAmount = Number(fromTo[2]);
      amount = Number(fromTo[4]);
    } else if (money.length >= 2) {
      [previousAmount, amount] = [money[0].value, money[1].value].sort((a, b) => a - b);
    } else if (money.length === 1) {
      amount = money[0].value;
    }
    const effective = findDateNear(sentences, /effective|starting|beginning|from your|on your next|billing (?:date|cycle)|takes effect/i, sent);
    return {
      ...base,
      kind: 'subscription',
      amount,
      previousAmount: previousAmount && amount && previousAmount < amount ? previousAmount : null,
      cadence: cadence || 'monthly',
      deadline: effective ? effective.iso : null,
      itemName: planName(flat),
      snippet: effective?.sentence || firstMatchingSentence(sentences, /price/i),
    };
  }

  // Free trial about to convert.
  if (/free trial|trial (?:period )?(?:ends|will end|expires|is ending|ending)|your trial|trial membership/i.test(flat)) {
    let deadline = findDateNear(sentences, /trial|end|expire|until|through|charged|billed|starts? on/i, sent);
    if (!deadline) {
      const s = sentences.find((x) => /trial/i.test(x) && parseRelativeDays(x) != null);
      if (s) deadline = { iso: toISO(addDays(sent, parseRelativeDays(s))), sentence: s };
    }
    const after = flat.match(/(?:then|after(?: that| your trial)?|you(?:'ll| will) be (?:charged|billed)|renews? at|will (?:cost|be))\D{0,40}?(US\$|\$|€|£)\s?(\d+(?:\.\d{1,2})?)/i);
    const amount = after ? Number(after[2]) : pickRecurringAmount(money, flat);
    return {
      ...base,
      kind: 'trial',
      amount,
      cadence: cadence || 'monthly',
      deadline: deadline ? deadline.iso : null,
      itemName: planName(flat),
      snippet: deadline?.sentence || firstMatchingSentence(sentences, /trial/i),
    };
  }

  // Order with a return window.
  const isOrder = /order (?:confirmation|confirmed|#|no\.?|number|placed|has shipped|delivered)|thanks? (?:you )?for (?:your )?(?:order|purchase)|your order|receipt for your purchase/i.test(flat);
  if (isOrder && !cadence) {
    let returnBy = findDateNear(sentences, /return|refund|exchange/i, sent);
    if (!returnBy) {
      const s = sentences.find((x) => /return|refund/i.test(x) && parseRelativeDays(x) != null);
      if (s) {
        // A window counts from delivery when the email says so; otherwise from the email date.
        const delivered = findDateNear(sentences, /deliver/i, sent);
        const start = delivered ? fromISO(delivered.iso) : sent;
        returnBy = { iso: toISO(addDays(start, parseRelativeDays(s))), sentence: s };
      }
    }
    if (!returnBy) return null; // an order with no return window is not a leak
    const total = flat.match(/(?:order total|total|grand total|amount charged|you paid)\D{0,20}?(US\$|\$|€|£)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/i);
    const orderNo = flat.match(/order\s*(?:#|no\.?|number)\s*:?\s*([A-Z0-9-]{4,})/i);
    const item = body.match(/^\s*(?:items?|product|you (?:ordered|bought)):\s*(.+)$/im);
    return {
      ...base,
      kind: 'order',
      amount: total ? Number(total[2].replace(/,/g, '')) : money.length ? Math.max(...money.map((m) => m.value)) : null,
      cadence: null,
      deadline: returnBy.iso,
      itemName: item ? item[1].trim().slice(0, 80) : null,
      orderNumber: orderNo ? orderNo[1] : null,
      snippet: returnBy.sentence,
    };
  }

  // Recurring charge / renewal receipt.
  const recurring = cadence || /subscription|membership|renew|recurring|auto-?pay|your plan|billing period|next (?:billing|payment|charge)/i.test(flat);
  if (recurring && money.length) {
    const renewal = findDateNear(sentences, /renew|next (?:billing|payment|charge)|will be (?:charged|billed)|billing date/i, sent);
    return {
      ...base,
      kind: 'subscription',
      amount: pickRecurringAmount(money, flat),
      cadence: cadence || 'monthly',
      deadline: renewal ? renewal.iso : null,
      itemName: planName(flat),
      snippet: renewal?.sentence || firstMatchingSentence(sentences, /subscription|membership|renew|plan/i),
    };
  }

  return null;
}

function detectMerchant(from, subject, body) {
  const known = findMerchant(`${from} ${subject}`) || findMerchant(body.slice(0, 400));
  if (known) return known.name;
  const display = from.match(/^"?([^"<@]+?)"?\s*</);
  if (display) return display[1].trim();
  const domain = from.match(/@(?:[\w-]+\.)*?([\w-]+)\.[a-z]{2,}/i);
  if (domain) return domain[1].charAt(0).toUpperCase() + domain[1].slice(1);
  return 'Unknown merchant';
}

function findMoney(text) {
  const out = [];
  for (const m of text.matchAll(MONEY)) {
    const symbol = m[1].trim();
    out.push({ value: Number(m[2].replace(/,/g, '')), currency: CURRENCY[symbol] || 'USD', index: m.index });
  }
  return out.filter((m) => m.value > 0);
}

export function detectCadence(text) {
  if (/\/\s?(?:wk|week)\b|per week|weekly|a week\b|every week/i.test(text)) return 'weekly';
  if (/quarterly|every 3 months|per quarter|\/\s?qtr/i.test(text)) return 'quarterly';
  if (/\/\s?(?:yr|year)\b|per year|annual(?:ly)?|yearly|a year\b|every year|12[- ]month plan/i.test(text)) return 'yearly';
  if (/\/\s?(?:mo|month)\b|per month|monthly|a month\b|every month/i.test(text)) return 'monthly';
  return null;
}

// Prefer the amount written next to a cadence ("$15.49/month"); otherwise the
// amount labelled as a total or charge; otherwise the first one.
function pickRecurringAmount(money, text) {
  if (!money.length) return null;
  for (const m of money) {
    const after = text.slice(m.index, m.index + 30);
    if (/\/\s?(?:mo|month|yr|year|wk|week)|per (?:month|year|week)|a (?:month|year)|monthly|annual|yearly/i.test(after)) return m.value;
  }
  for (const m of money) {
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (/total|charged|amount|billed|paid/i.test(before)) return m.value;
  }
  return money[0].value;
}

function findDateNear(sentences, keyword, ref) {
  for (const s of sentences) {
    if (!keyword.test(s)) continue;
    const date = parseDate(s, ref);
    if (date) return { iso: toISO(date), sentence: s.trim().slice(0, 200) };
  }
  return null;
}

function firstMatchingSentence(sentences, re) {
  const s = sentences.find((x) => re.test(x));
  return s ? s.trim().slice(0, 200) : null;
}

function planName(text) {
  const m = text.match(/\b(?:plan|membership|subscription|tier)\s*:\s*([^.\n$]{2,40})/i)
    || text.match(/\b(?:your|the)\s+([A-Z][\w+ ]{1,30}?)\s+(?:plan|membership|subscription)\b/);
  return m ? m[1].trim() : null;
}
