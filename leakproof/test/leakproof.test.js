import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyze, monthlyCost, savingsFor } from '../src/lib/analyze.js';
import { parseDate, toISO } from '../src/lib/dates.js';
import { draftFor, mailtoLink } from '../src/lib/drafts.js';
import { detectCadence, parseEmail, parseEmails, splitEmails } from '../src/lib/parser.js';
import { demoInbox } from '../src/lib/sample.js';
import { itemKey, load, mergeItems, resolveItem, save } from '../src/lib/store.js';

const TODAY = new Date(2026, 9, 2); // Oct 2, 2026

test('parseDate handles common formats and rolls the year forward', () => {
  assert.equal(toISO(parseDate('Return by October 14, 2026', TODAY)), '2026-10-14');
  assert.equal(toISO(parseDate('ends Oct. 9', TODAY)), '2026-10-09');
  assert.equal(toISO(parseDate('on 3 November 2026', TODAY)), '2026-11-03');
  assert.equal(toISO(parseDate('2026-12-01', TODAY)), '2026-12-01');
  assert.equal(toISO(parseDate('renews 1/15', TODAY)), '2027-01-15');
  assert.equal(parseDate('no date here', TODAY), null);
  assert.equal(parseDate('February 30, 2026', TODAY), null);
});

test('detectCadence', () => {
  assert.equal(detectCadence('$9.99/mo'), 'monthly');
  assert.equal(detectCadence('$99 per year'), 'yearly');
  assert.equal(detectCadence('billed annually'), 'yearly');
  assert.equal(detectCadence('$5 a week'), 'weekly');
  assert.equal(detectCadence('Order total $20'), null);
});

test('splitEmails splits on separators or From: headers', () => {
  assert.equal(splitEmails('a\n---\nb\n---\nc').length, 3);
  assert.equal(splitEmails('From: A <a@a.com>\nhi\nFrom: B <b@b.com>\nyo').length, 2);
  assert.equal(splitEmails('   ').length, 0);
});

test('price increase becomes a subscription with the old price kept', () => {
  const item = parseEmail(
    `From: Spotify <no-reply@spotify.com>
Subject: An update to your Premium price
Date: September 20, 2026

Your Premium price is changing from $11.99/month to $12.99/month, starting on your next billing date, October 15, 2026.`,
    TODAY,
  );
  assert.equal(item.kind, 'subscription');
  assert.equal(item.merchant, 'Spotify');
  assert.equal(item.previousAmount, 11.99);
  assert.equal(item.amount, 12.99);
  assert.equal(item.cadence, 'monthly');
  assert.equal(item.deadline, '2026-10-15');
  assert.equal(item.emailDate, '2026-09-20');
});

test('trial end date is not confused with the email date', () => {
  const item = parseEmail(
    `From: Adobe <mail@adobe.com>
Subject: Your trial ends soon
Date: September 28, 2026

Your free trial ends on October 5, 2026. After your trial, you'll be charged US$69.99/mo.`,
    TODAY,
  );
  assert.equal(item.kind, 'trial');
  assert.equal(item.amount, 69.99);
  assert.equal(item.deadline, '2026-10-05');
});

test('relative trial lengths resolve against the email date', () => {
  const item = parseEmail(
    `From: Calm <hello@calm.com>
Date: October 1, 2026

Your free trial ends in 7 days. Then $69.99/year will be billed automatically.`,
    TODAY,
  );
  assert.equal(item.deadline, '2026-10-08');
  assert.equal(item.cadence, 'yearly');
});

test('orders need a return window; relative windows count from delivery', () => {
  const noWindow = parseEmail('From: Shop <a@shop.com>\nThanks for your order! Order #12345 Total: $40.00', TODAY);
  assert.equal(noWindow, null);

  const item = parseEmail(
    `From: Zara <noreply@zara.com>
Date: September 25, 2026
Subject: Your order has been delivered

Order number: ZR-99812
Item: Wool overcoat
Order total: $1,149.00
Delivered on September 27, 2026. You can return items within 30 days of delivery.`,
    TODAY,
  );
  assert.equal(item.kind, 'order');
  assert.equal(item.amount, 1149);
  assert.equal(item.orderNumber, 'ZR-99812');
  assert.equal(item.itemName, 'Wool overcoat');
  assert.equal(item.deadline, '2026-10-27');
});

test('unknown merchants fall back to the sender name', () => {
  const item = parseEmail('From: "Acme Cloud" <billing@acme.io>\nYour subscription renewed: $8.00 per month.', TODAY);
  assert.equal(item.merchant, 'Acme Cloud');
  assert.equal(item.amount, 8);
});

test('demo inbox produces the expected leak report', () => {
  const { items, added } = mergeItems([], parseEmails(demoInbox(TODAY), TODAY));
  assert.equal(added, 9); // two Netflix emails merge into one
  const netflix = items.find((i) => i.merchant === 'Netflix');
  assert.equal(netflix.amount, 20.99);
  assert.equal(netflix.previousAmount, 17.99);
  assert.equal(netflix.itemName, 'Standard');

  const report = analyze(items, TODAY);
  assert.deepEqual(
    report.alerts.map((l) => l.item.merchant),
    ['Adobe', 'Best Buy', 'Calm', 'Planet Fitness'],
  );
  const netflixLeak = report.leaks.find((l) => l.item.merchant === 'Netflix');
  assert.equal(netflixLeak.action, 'negotiate');
  assert.ok(netflixLeak.reasons.some((r) => r.includes('Overlaps with Hulu, Max')));
  assert.ok(report.totals.monthly > 60 && report.totals.monthly < 70, `monthly ${report.totals.monthly}`);
  assert.equal(report.totals.atRisk, 69.99 + 329.99 + 69.99 + 49);
});

test('expired trials count as charges and expired returns disappear', () => {
  const items = [
    { id: 'a', status: 'active', kind: 'trial', merchant: 'X', amount: 10, cadence: 'monthly', deadline: '2026-09-01' },
    { id: 'b', status: 'active', kind: 'order', merchant: 'Y', amount: 50, deadline: '2026-09-30' },
  ];
  const report = analyze(items, TODAY);
  assert.equal(report.leaks.length, 1);
  assert.equal(report.leaks[0].converted, true);
  assert.equal(report.totals.monthly, 10);
});

test('mergeItems: a receipt after a trial converts it; resolved items are not reopened', () => {
  const trial = { kind: 'trial', merchant: 'Adobe', amount: 69.99, cadence: 'monthly', deadline: '2026-10-05', emailDate: '2026-09-28' };
  const receipt = { kind: 'subscription', merchant: 'adobe', amount: 69.99, cadence: 'monthly', deadline: null, emailDate: '2026-10-06' };
  let { items } = mergeItems([], [trial]);
  ({ items } = mergeItems(items, [receipt]));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'subscription');
  assert.equal(itemKey(items[0]), 'recurring|adobe');

  items = resolveItem(items, items[0].id, 'resolved');
  assert.equal(items[0].savedAmount, savingsFor(items[0]));
  const again = mergeItems(items, [receipt]);
  assert.equal(again.updated, 0);
  assert.equal(again.items[0].status, 'resolved');
});

test('savings and monthly maths', () => {
  assert.equal(monthlyCost(120, 'yearly'), 10);
  assert.equal(Math.round(monthlyCost(10, 'weekly') * 100) / 100, 43.33);
  assert.equal(savingsFor({ kind: 'subscription', amount: 9.99, cadence: 'monthly' }), 119.88);
  assert.equal(savingsFor({ kind: 'order', amount: 329.99 }), 329.99);
});

test('drafts include the specifics and encode safely for mailto', () => {
  const item = { kind: 'order', merchant: 'Best Buy', amount: 329.99, currency: 'USD', itemName: 'Headphones', orderNumber: 'BBY-1', deadline: '2026-10-06' };
  const draft = draftFor(item, 'return', 'Sam');
  assert.match(draft.subject, /BBY-1/);
  assert.match(draft.body, /\$329\.99/);
  assert.match(draft.body, /Oct 6, 2026/);
  assert.match(draft.body, /Sam$/);
  assert.ok(mailtoLink(draft).startsWith('mailto:?subject=Return%20and%20refund'));
});

test('store survives broken storage', () => {
  const broken = { getItem: () => '{nope', setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(load(broken), { items: [], name: '' });
  assert.doesNotThrow(() => save({ items: [] }, broken));
});
