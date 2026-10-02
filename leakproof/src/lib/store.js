// Items live in localStorage only. Merging dedupes repeat emails about the
// same thing (e.g. three monthly Netflix receipts become one subscription).

import { savingsFor } from './analyze.js';

const KEY = 'leakproof:v1';

export function load(storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage.getItem(KEY));
    if (data && Array.isArray(data.items)) return { items: data.items, name: data.name || '' };
  } catch {
    // Missing, corrupt or blocked storage: start empty.
  }
  return { items: [], name: '' };
}

export function save(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode / full storage: the session still works in memory.
  }
}

export function itemKey(item) {
  const merchant = item.merchant.toLowerCase().trim();
  if (item.kind === 'order') return `order|${merchant}|${(item.orderNumber || item.itemName || item.amount || '').toString().toLowerCase()}`;
  // A trial and the subscription it turns into are the same leak.
  return `recurring|${merchant}`;
}

let counter = 0;
function newId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Returns { items, added, updated }.
export function mergeItems(existing, incoming) {
  const items = existing.map((i) => ({ ...i }));
  const index = new Map(items.map((i, n) => [itemKey(i), n]));
  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    if (!raw || !raw.merchant) continue;
    const key = itemKey(raw);
    if (!index.has(key)) {
      items.push({ ...raw, id: newId(), status: 'active', savedAmount: 0 });
      index.set(key, items.length - 1);
      added += 1;
      continue;
    }
    const current = items[index.get(key)];
    if (current.status !== 'active') continue; // already dealt with
    const newer = !current.emailDate || !raw.emailDate || raw.emailDate >= current.emailDate;
    if (!newer) continue;
    const merged = { ...current };
    for (const [k, v] of Object.entries(raw)) {
      if (v != null && v !== '') merged[k] = v;
    }
    // A receipt after a trial means it already converted; a receipt after a
    // price notice keeps the "was" price so the hike stays visible.
    if (current.kind === 'trial' && raw.kind === 'subscription') merged.kind = 'subscription';
    if (current.kind === 'subscription' && raw.kind === 'trial') merged.kind = 'subscription';
    if (raw.previousAmount == null && current.previousAmount != null && merged.amount > current.previousAmount) {
      merged.previousAmount = current.previousAmount;
    }
    items[index.get(key)] = merged;
    updated += 1;
  }
  return { items, added, updated };
}

export function resolveItem(items, id, status) {
  return items.map((i) => {
    if (i.id !== id) return i;
    if (status === 'resolved') return { ...i, status, savedAmount: savingsFor(i), resolvedAt: new Date().toISOString() };
    if (status === 'active') return { ...i, status, savedAmount: 0, resolvedAt: null };
    return { ...i, status, savedAmount: 0 };
  });
}
