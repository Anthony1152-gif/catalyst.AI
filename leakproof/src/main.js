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

// Decorative water line along the bottom of the meter panel.
const WAVE = `<svg class="wave" viewBox="0 0 800 60" preserveAspectRatio="none" aria-hidden="true">
  <path class="w2" d="M0 30 Q 100 10 200 30 T 400 30 T 600 30 T 800 30 T 1000 30 T 1200 30 V60 H0Z"/>
  <path class="w1" d="M0 36 Q 100 18 200 36 T 400 36 T 600 36 T 800 36 T 1000 36 T 1200 36 V60 H0Z"/>
</svg>`;

let tickerFrame;

function renderMeter({ totals, leaks }) {
  cancelAnimationFrame(tickerFrame);
  if (!state.items.length) {
    $('#meter').innerHTML = `
      <div class="tank tank-empty">
        <p class="eyebrow">Your money leaks</p>
        <h2 class="tank-headline">Find what’s quietly draining your account.</h2>
        <p class="tank-copy">Paste your receipts and account emails. Leakproof spots forgotten subscriptions, trials about to charge you, price hikes and closing return windows, then writes the email that fixes each one.</p>
        <div class="row">
          <button class="btn on-tank" data-demo>Try the demo inbox</button>
          <button class="btn ghost-tank" data-go="scan">Scan my emails</button>
        </div>
        ${WAVE}
      </div>`;
    return;
  }
  const recurring = leaks.filter((l) => l.item.kind !== 'order').length;
  $('#meter').innerHTML = `
    <div class="tank">
      <p class="eyebrow">${leaks.length ? 'You’re leaking' : 'All leaks plugged'}</p>
      <p class="tank-figure"><span class="num">${money(totals.monthly)}</span><span class="unit">/month</span></p>
      <p class="ticker" aria-hidden="true"><span id="ticker">$0.0000</span> gone since you opened this page</p>
      <dl class="tank-stats">
        <div><dt>Per year</dt><dd>${whole(totals.yearly)}</dd><small>${count(recurring, 'charge')}</small></div>
        <div class="risk"><dt>Due this week</dt><dd>${whole(totals.atRisk)}</dd><small>${count(leaks.filter((l) => l.urgent).length, 'deadline')}</small></div>
        <div class="saved"><dt>Saved</dt><dd>${whole(totals.saved)}</dd><small>so far</small></div>
      </dl>
      ${WAVE}
    </div>`;
  startTicker(totals.monthly);
}

// Counts up what the recurring charges cost per second while the page is open.
function startTicker(monthly) {
  const el = $('#ticker');
  if (!el || !monthly) return;
  const perMs = monthly / (30.4375 * 86_400_000);
  const start = performance.now();
  let last = 0;
  const tick = (now) => {
    if (now - last > 120) {
      el.textContent = `$${((now - start) * perMs).toFixed(4)}`;
      last = now;
    }
    tickerFrame = requestAnimationFrame(tick);
  };
  tickerFrame = requestAnimationFrame(tick);
}

function renderAlerts({ alerts }) {
  $('#alerts').innerHTML = alerts.length
    ? `<div class="section-head"><h2>Act now</h2><small>soonest first</small></div>
       <div class="tickets">${alerts.map(ticket).join('')}</div>`
    : '';
}

function ticket(leak) {
  const { item } = leak;
  const d = leak.daysLeft;
  const stub = d === 0 ? '<b>Today</b>' : `<b>${d}</b><span>${d === 1 ? 'day' : 'days'}</span>`;
  return `
    <article class="ticket">
      <div class="stub" aria-label="${d === 0 ? 'Due today' : `${d} days left`}">${stub}</div>
      <div class="ticket-body">
        <div class="row-top">
          <h3>${esc(item.merchant)}</h3>
          <span class="amt">${money(item.amount, item.currency)}</span>
        </div>
        <p class="what">${esc(leak.reasons[0])}</p>
        ${actions(leak, true)}
      </div>
    </article>`;
}

function renderLeaks({ leaks, totals }) {
  const rest = leaks.filter((l) => !l.urgent);
  const max = Math.max(...rest.map((l) => l.yearly), 1);
  $('#leak-list').innerHTML = rest.length
    ? `<div class="section-head"><h2>Ongoing leaks</h2><small>biggest first</small></div>
       <ol class="ledger">${rest.map((l) => row(l, max, totals.yearly)).join('')}</ol>`
    : '';
}

function row(leak, max, totalYearly) {
  const { item } = leak;
  const tags = [];
  if (item.previousAmount) tags.push('<span class="tag hike">Price hike</span>');
  if (leak.converted) tags.push('<span class="tag hike">Trial ended</span>');
  const meta = [item.itemName, item.amount ? `${money(item.amount, item.currency)}${per(item.cadence)}` : null]
    .filter(Boolean).map(esc).join(' · ');
  const share = totalYearly ? Math.round((leak.yearly / totalYearly) * 100) : 0;
  return `
    <li class="leak-row">
      <div class="mark" aria-hidden="true">${esc(item.merchant.charAt(0).toUpperCase())}</div>
      <div class="leak-main">
        <div class="row-top">
          <h3>${esc(item.merchant)}${tags.join('')}</h3>
          <span class="amt">${money(leak.yearly, item.currency)}<small>/yr</small></span>
        </div>
        <div class="meta">${meta}</div>
        <ul class="reasons">${leak.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="share" title="${share}% of your yearly leaks">
          <span class="bar"><i style="width:${Math.max(4, (leak.yearly / max) * 100).toFixed(1)}%"></i></span>
          <span class="pct">${share}% of total</span>
        </div>
        ${actions(leak, false)}
      </div>
    </li>`;
}

function actions(leak, urgent) {
  const { item } = leak;
  return `
    <div class="actions">
      <button class="btn small ${urgent ? 'urgent' : 'primary'}" data-act="${esc(leak.action)}" data-id="${esc(item.id)}">${esc(actionLabel(leak.action))}</button>
      ${leak.action === 'negotiate' ? `<button class="btn small" data-act="cancel" data-id="${esc(item.id)}">Cancel it</button>` : ''}
      <button class="link" data-keep="${esc(item.id)}">${item.kind === 'order' ? 'Keeping it' : 'I use this'}</button>
    </div>`;
}

function renderSaved({ resolved, kept, totals }) {
  const resolvedRows = resolved
    .map((i) => `
      <li class="line-item">
        <div><b>${esc(i.merchant)}</b><span class="meta">${i.kind === 'order' ? 'Returned' : 'Cancelled'}${i.resolvedAt ? ` · ${esc(formatDate(i.resolvedAt.slice(0, 10)))}` : ''}</span></div>
        <div class="line-end"><span class="amt save">+${money(i.savedAmount, i.currency)}${i.kind === 'order' ? '' : '<small>/yr</small>'}</span><button class="link" data-undo="${esc(i.id)}">Undo</button></div>
      </li>`)
    .join('');
  const keptRows = kept
    .map((i) => `
      <li class="line-item">
        <div><b>${esc(i.merchant)}</b><span class="meta">${i.amount ? `${money(i.amount, i.currency)}${per(i.cadence)}` : ''}</span></div>
        <button class="link" data-undo="${esc(i.id)}">Track again</button>
      </li>`)
    .join('');
  $('#saved').innerHTML = `
    <div class="saved-hero">
      <p class="eyebrow">Money kept</p>
      <p class="saved-figure">${money(totals.saved)}</p>
      <p>${resolved.length ? `from plugging ${count(resolved.length, 'leak')}` : 'Fix a leak and the savings add up here.'}</p>
    </div>
    ${resolved.length ? `<h2>Fixed</h2><ul class="lines">${resolvedRows}</ul>` : ''}
    ${kept.length ? `<h2>Keeping on purpose</h2><p class="muted">These don’t count as leaks.</p><ul class="lines">${keptRows}</ul>` : ''}`;
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

// Two-tap confirmation, kept in the page rather than a confirm() dialog.
let resetArmed;
$('#reset-btn').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (!resetArmed) {
    btn.textContent = 'Tap again to erase everything';
    resetArmed = setTimeout(() => {
      resetArmed = null;
      btn.textContent = 'Erase all my data';
    }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  btn.textContent = 'Erase all my data';
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
      $('#ai-note').textContent = 'is off because no AI server is connected. The on-device scanner handles standard receipts.';
    }
  });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

render();
