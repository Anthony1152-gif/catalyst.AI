import { analyze, money, per, savingsFor } from './lib/analyze.js';
import { toISO } from './lib/dates.js';
import { actionLabel, draftFor, formatDate, mailtoLink, manageUrl } from './lib/drafts.js';
import { parseEmails } from './lib/parser.js';
import { demoInbox } from './lib/sample.js';
import { load, mergeItems, resolveItem, save } from './lib/store.js';

const $ = (sel) => document.querySelector(sel);
const state = load();
let aiAvailable = false;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function commit() {
  save(state);
  render();
}

// ---------- Rendering ----------

function render() {
  const report = analyze(state.items);
  renderMeter(report);
  renderAlerts(report);
  renderLeaks(report);
  renderSaved(report);
  const badge = $('#badge');
  badge.hidden = report.alerts.length === 0;
  badge.textContent = report.alerts.length;
}

function renderMeter({ totals, leaks }) {
  if (!state.items.length) {
    $('#meter').innerHTML = `
      <div class="empty">
        <svg class="drop" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c5 6.5 9 11.6 9 16a9 9 0 0 1-18 0c0-4.4 4-9.5 9-16Z" fill="currentColor"/></svg>
        <h2>Where is your money leaking?</h2>
        <p>Paste your receipts and account emails. Leakproof finds forgotten subscriptions, free trials about to charge you, sneaky price hikes and return windows about to close, then writes the email that fixes each one.</p>
        <div class="row">
          <button class="btn primary" data-go="scan">Scan my emails</button>
          <button class="btn" data-demo>Try the demo inbox</button>
        </div>
      </div>`;
    return;
  }
  const hasLeaks = leaks.length > 0;
  $('#meter').innerHTML = `
    <div class="meter">
      <div class="meter-label">${hasLeaks ? 'You’re leaking' : 'No open leaks'}</div>
      <div class="meter-value"><strong>${money(totals.monthly)}</strong><span>a month</span></div>
      <div class="meter-sub">That’s <b>${money(totals.yearly)}</b> a year on ${count(leaks.filter((l) => l.item.kind !== 'order').length, 'recurring charge')}.</div>
      <div class="stats">
        <div class="stat risk"><b>${whole(totals.atRisk)}</b><small>at stake this week</small></div>
        <div class="stat"><b>${totals.count}</b><small>open leaks</small></div>
        <div class="stat saved"><b>${whole(totals.saved)}</b><small>saved so far</small></div>
      </div>
    </div>`;
}

function renderAlerts({ alerts }) {
  $('#alerts').innerHTML = alerts.length
    ? `<div class="section-head"><h2>Act now</h2><small>${count(alerts.length, 'deadline')} coming up</small></div>
       ${alerts.map(card).join('')}`
    : '';
}

function renderLeaks({ leaks }) {
  const rest = leaks.filter((l) => !l.urgent);
  $('#leak-list').innerHTML = rest.length
    ? `<div class="section-head"><h2>All leaks</h2><small>biggest first</small></div>${rest.map(card).join('')}`
    : '';
}

function card(leak) {
  const { item } = leak;
  const chip = leak.urgent
    ? `<span class="chip">${leak.daysLeft === 0 ? 'today' : leak.daysLeft === 1 ? '1 day' : `${leak.daysLeft} days`}</span>`
    : leak.item.previousAmount
      ? '<span class="chip soft">price hike</span>'
      : '';
  const kindLabel = { subscription: 'Subscription', trial: 'Free trial', order: 'Return window' }[item.kind];
  const price = item.kind === 'order'
    ? `${money(item.amount, item.currency)}`
    : `${money(leak.yearly, item.currency)}<small>/yr</small>`;
  const sub = [kindLabel, item.itemName, item.kind !== 'order' && item.amount ? `${money(item.amount, item.currency)}${per(item.cadence)}` : null]
    .filter(Boolean).map(esc).join(' · ');
  return `
    <article class="card${leak.urgent ? ' urgent' : ''}">
      <div class="card-top">
        <div class="avatar" style="background:${hue(item.merchant)}" aria-hidden="true">${esc(item.merchant.charAt(0).toUpperCase())}</div>
        <div class="card-main">
          <div class="card-title"><h3>${esc(item.merchant)}${chip}</h3><span class="cost">${price}</span></div>
          <div class="meta">${sub}</div>
          <ul class="reasons">${leak.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="actions">
        <button class="btn small ${leak.urgent ? 'urgent' : 'primary'}" data-act="${esc(leak.action)}" data-id="${esc(item.id)}">${esc(actionLabel(leak.action))}</button>
        ${leak.action === 'negotiate' ? `<button class="btn small" data-act="cancel" data-id="${esc(item.id)}">Cancel it</button>` : ''}
        <button class="btn small quiet" data-keep="${esc(item.id)}">${item.kind === 'order' ? 'Keeping it' : 'I use this'}</button>
      </div>
    </article>`;
}

function renderSaved({ resolved, kept, totals }) {
  const resolvedRows = resolved
    .map((i) => `
      <div class="line-item">
        <div><b>${esc(i.merchant)}</b><span class="meta">${i.kind === 'order' ? 'Returned' : 'Cancelled'}${i.resolvedAt ? ` · ${esc(formatDate(i.resolvedAt.slice(0, 10)))}` : ''}</span></div>
        <div class="row"><b>+${money(i.savedAmount, i.currency)}${i.kind === 'order' ? '' : '/yr'}</b><button class="btn small quiet" data-undo="${esc(i.id)}">Undo</button></div>
      </div>`)
    .join('');
  const keptRows = kept
    .map((i) => `
      <div class="line-item">
        <div><b>${esc(i.merchant)}</b><span class="meta">${i.amount ? `${money(i.amount, i.currency)}${per(i.cadence)}` : ''}</span></div>
        <button class="btn small quiet" data-undo="${esc(i.id)}">Track again</button>
      </div>`)
    .join('');
  $('#saved').innerHTML = `
    <div class="saved-hero"><strong>${money(totals.saved)}</strong><span>${resolved.length ? `saved by plugging ${count(resolved.length, 'leak')}` : 'Fix a leak and your savings show up here.'}</span></div>
    ${resolved.length ? `<h2>Fixed</h2>${resolvedRows}` : ''}
    ${kept.length ? `<h2>Keeping on purpose</h2><p class="muted">These won’t count as leaks.</p>${keptRows}` : ''}`;
  $('#settings-form').name.value = state.name || '';
}

// ---------- Action sheet ----------

function openSheet(id, action) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  const draft = draftFor(item, action, state.name);
  const url = manageUrl(item);
  const worth = savingsFor(item);
  const steps = {
    'cancel-trial': ['Cancel on their site, or send the email below.', 'Keep the confirmation email in case you’re charged anyway.'],
    cancel: ['Cancel on their site, or send the email below.', 'Keep the confirmation. If you’re charged again, dispute it with your bank.'],
    negotiate: ['Send this before the new price starts. Retention teams often keep the old rate.', 'If they say no, cancel. You can always come back.'],
    return: ['Send the request, or start the return in your account.', 'Pack it up and drop it off before the window closes.'],
  }[action] || [];
  const form = $('#sheet-form');
  form.innerHTML = `
    <button class="btn small quiet sheet-close" value="close" aria-label="Close">✕</button>
    <h2 id="sheet-title">${esc(actionLabel(action))}: ${esc(item.merchant)}</h2>
    <div class="meta">${action === 'return' ? `Get ${money(worth, item.currency)} back` : `Worth ${money(worth, item.currency)} a year`}${item.deadline ? ` · deadline ${esc(formatDate(item.deadline))}` : ''}</div>
    <ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <label class="subject">Subject <input id="draft-subject" value="${esc(draft.subject)}" /></label>
    <label>Message <textarea id="draft-body">${esc(draft.body)}</textarea></label>
    <div class="actions">
      <button type="button" class="btn primary" id="copy-btn">Copy message</button>
      <a class="btn" id="mail-btn" href="#">Open in email</a>
      ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ${esc(item.merchant)} account ↗</a>` : ''}
    </div>
    <div class="done-row row">
      <button type="button" class="btn primary" id="done-btn">${action === 'return' ? 'Done, I returned it' : action === 'negotiate' ? 'Done, it’s sorted' : 'Done, I cancelled it'}</button>
      <button class="btn quiet" value="close">Later</button>
    </div>`;

  const current = () => ({ subject: $('#draft-subject').value, body: $('#draft-body').value });
  $('#mail-btn').addEventListener('click', (e) => {
    e.currentTarget.href = mailtoLink(current());
  });
  $('#copy-btn').addEventListener('click', async () => {
    const { subject, body } = current();
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      toast('Copied. Paste it into their support form or email.');
    } catch {
      $('#draft-body').select();
      toast('Select-all done. Press Ctrl/Cmd+C to copy.');
    }
  });
  $('#done-btn').addEventListener('click', () => {
    state.items = resolveItem(state.items, id, 'resolved');
    $('#sheet').close();
    commit();
    toast(item.kind === 'order' ? `+${money(worth, item.currency)} back in your pocket` : `+${money(worth, item.currency)}/yr saved`);
  });
  $('#sheet').showModal();
}

// ---------- Scanning ----------

async function scan(text) {
  const result = $('#scan-result');
  result.className = 'result';
  if (!text.trim()) {
    result.textContent = 'Paste at least one email first.';
    result.classList.add('error');
    return;
  }
  const useAi = aiAvailable && $('#ai-toggle').checked;
  const btn = $('#scan-btn');
  btn.disabled = true;
  btn.textContent = useAi ? 'Reading with AI…' : 'Scanning…';
  let found;
  let note = '';
  try {
    if (useAi) {
      try {
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, today: toISO(new Date()) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `AI scan failed (${res.status})`);
        found = data.items;
      } catch (error) {
        note = ` AI scan unavailable (${error.message}), so the on-device scanner was used.`;
      }
    }
    found ??= parseEmails(text);
    const { items, added, updated } = mergeItems(state.items, found);
    state.items = items;
    commit();
    if (!found.length) {
      result.textContent = `No subscriptions, trials or returnable orders found.${note}`;
      result.classList.add('error');
      return;
    }
    result.textContent = `Found ${count(found.length, 'item')}: ${added} new, ${updated} updated.${note}`;
    $('#scan-text').value = '';
    setTimeout(() => show('leaks'), 700);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find my leaks';
  }
}

function loadDemo() {
  $('#scan-text').value = demoInbox();
  show('scan');
  scan($('#scan-text').value);
}

// ---------- Navigation & misc ----------

function show(view) {
  for (const v of ['leaks', 'scan', 'saved']) $(`#view-${v}`).hidden = v !== view;
  for (const b of document.querySelectorAll('.tabs button')) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

// Stat tiles are narrow on phones: round to whole currency units.
function whole(n) {
  return money(Math.round(n));
}

function count(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function hue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.dataset.view) show(t.dataset.view);
  else if (t.dataset.go) show(t.dataset.go);
  else if ('demo' in t.dataset) loadDemo();
  else if (t.dataset.act) openSheet(t.dataset.id, t.dataset.act);
  else if (t.dataset.keep) {
    state.items = resolveItem(state.items, t.dataset.keep, 'kept');
    commit();
    toast('Got it. Moved to “Keeping on purpose”.');
  } else if (t.dataset.undo) {
    state.items = resolveItem(state.items, t.dataset.undo, 'active');
    commit();
  }
});

$('#scan-form').addEventListener('submit', (e) => {
  e.preventDefault();
  scan($('#scan-text').value);
});
$('#demo-btn').addEventListener('click', loadDemo);

$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const kind = f.get('kind');
  const item = {
    kind,
    merchant: String(f.get('merchant')).trim(),
    amount: Number(f.get('amount')),
    currency: 'USD',
    cadence: kind === 'order' ? null : f.get('cadence') || 'monthly',
    deadline: f.get('deadline') || null,
    emailDate: toISO(new Date()),
  };
  if (kind === 'order' && !item.deadline) {
    toast('Add the return-by date so we can warn you in time.');
    return;
  }
  state.items = mergeItems(state.items, [item]).items;
  e.currentTarget.reset();
  commit();
  toast(`${item.merchant} added`);
});

$('#settings-form').addEventListener('input', (e) => {
  state.name = e.target.value;
  save(state);
});

$('#reset-btn').addEventListener('click', () => {
  if (!confirm('Erase every tracked item and your savings history from this device?')) return;
  state.items = [];
  commit();
  toast('All data erased.');
});

fetch('/api/status')
  .then((r) => (r.ok ? r.json() : { ai: false }))
  .catch(() => ({ ai: false }))
  .then(({ ai }) => {
    aiAvailable = ai;
    const toggle = $('#ai-toggle');
    toggle.disabled = !ai;
    toggle.checked = ai;
    if (!ai) {
      $('#ai-toggle-wrap').classList.add('off');
      $('#ai-note').textContent = 'is off: the server has no Anthropic API key. The on-device scanner handles standard receipts.';
    }
  });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

render();
