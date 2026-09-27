/**
 * Pipeworks — DOM layer.
 *
 * Hybrid architecture: the page is complete, semantic HTML that works without
 * JavaScript. This module progressively enhances it with smooth (inertial)
 * scrolling, text reveals, parallax layers and magnetic UI, then lazily loads
 * the WebGL experience only on capable devices.
 */
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/inter-tight';
import './styles/main.css';
import Lenis from 'lenis';

const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
root.classList.add('js');
if (reducedMotion) root.classList.add('reduced-motion');

document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));

/* ------------------------------------------------ capability / quality tier */
function detectTier() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  if (!gl) return 'none';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const conn = navigator.connection;
  if (conn?.saveData) return 'none';
  const mem = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const small = Math.min(screen.width, screen.height) < 700;
  if (mem <= 4 || cores <= 4 || (small && !finePointer)) return 'low';
  return 'high';
}
const params = new URLSearchParams(location.search);
const forced = params.get('quality'); // ?quality=low|high|none
const tier = ['high', 'low', 'none'].includes(forced) ? forced : detectTier();
root.dataset.tier = tier;

/* ------------------------------------------------ split headings into words */
document.querySelectorAll('[data-split]').forEach((el) => {
  let i = 0;
  const wrap = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.append(part);
            continue;
          }
          const mask = document.createElement('span');
          mask.className = 'word';
          const inner = document.createElement('span');
          inner.style.setProperty('--i', i++);
          inner.textContent = part;
          mask.append(inner);
          frag.append(mask);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        wrap(child);
      }
    }
  };
  // Keep the accessible name intact for screen readers.
  el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
  wrap(el);
  el.querySelectorAll('.word').forEach((w) => w.setAttribute('aria-hidden', 'true'));
});

/* ------------------------------------------------ reveals */
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        revealIO.unobserve(e.target);
      }
    }
  },
  { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
);
document.querySelectorAll('.reveal, [data-split]').forEach((el) => revealIO.observe(el));

/* ------------------------------------------------ smooth, inertial scroll */
const lenis = reducedMotion ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, anchors: { offset: 0 } });
let scrollY = window.scrollY;
let velocity = 0;
lenis?.on('scroll', (l) => {
  scrollY = l.scroll;
  velocity = l.velocity;
});
if (!lenis) window.addEventListener('scroll', () => (scrollY = window.scrollY), { passive: true });

/* ------------------------------------------------ scroll → shot index */
const shotSections = [...document.querySelectorAll('[data-shot]')];
let anchors = [];
function measure() {
  const vh = window.innerHeight;
  anchors = shotSections.map((s) => {
    const top = s.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top + s.offsetHeight / 2 - vh / 2);
  });
  anchors[0] = 0;
  const max = document.documentElement.scrollHeight - vh;
  anchors[anchors.length - 1] = Math.min(anchors[anchors.length - 1], max);
}
function shotProgress(y) {
  if (y <= anchors[0]) return 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (y < anchors[i + 1]) return i + (y - anchors[i]) / Math.max(1, anchors[i + 1] - anchors[i]);
  }
  return anchors.length - 1;
}

/* ------------------------------------------------ parallax layers */
const parallax = [...document.querySelectorAll('[data-speed]')].map((el) => ({ el, speed: parseFloat(el.dataset.speed) }));
function updateParallax() {
  if (reducedMotion) return;
  const vh = window.innerHeight;
  for (const p of parallax) {
    const rect = p.el.parentElement.getBoundingClientRect();
    const centre = rect.top + rect.height / 2 - vh / 2;
    p.el.style.setProperty('--py', `${(-centre * (p.speed - 1)).toFixed(1)}px`);
  }
}

/* ------------------------------------------------ pointer, cursor & magnetic UI */
const pointer = { x: 0, y: 0, cx: innerWidth / 2, cy: innerHeight / 2 };
const cursor = document.querySelector('.cursor');
const cursorPos = { x: pointer.cx, y: pointer.cy };
window.addEventListener(
  'pointermove',
  (e) => {
    pointer.cx = e.clientX;
    pointer.cy = e.clientY;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    root.classList.add('has-pointer');
  },
  { passive: true },
);

const magnets = [...document.querySelectorAll('.magnetic')].map((el) => ({ el, x: 0, y: 0, tx: 0, ty: 0 }));
function updateMagnets() {
  for (const m of magnets) {
    const r = m.el.getBoundingClientRect();
    const dx = pointer.cx - (r.left + r.width / 2);
    const dy = pointer.cy - (r.top + r.height / 2);
    const reach = Math.max(r.width, r.height) * 0.9 + 40;
    const inRange = finePointer && Math.hypot(dx, dy) < reach;
    m.tx = inRange ? dx * 0.28 : 0;
    m.ty = inRange ? dy * 0.38 : 0;
    m.x += (m.tx - m.x) * 0.16;
    m.y += (m.ty - m.y) * 0.16;
    if (Math.abs(m.x) + Math.abs(m.y) > 0.01 || inRange) {
      m.el.style.transform = `translate3d(${m.x.toFixed(2)}px, ${m.y.toFixed(2)}px, 0)`;
      const label = m.el.firstElementChild;
      if (label) label.style.transform = `translate3d(${(m.x * 0.35).toFixed(2)}px, ${(m.y * 0.35).toFixed(2)}px, 0)`;
    }
  }
}
document.querySelectorAll('a, button, input, select, textarea').forEach((el) => {
  el.addEventListener('pointerenter', () => cursor.classList.add('is-link'));
  el.addEventListener('pointerleave', () => cursor.classList.remove('is-link'));
});

/* ------------------------------------------------ nav state */
const nav = document.querySelector('[data-nav]');
const navLinks = [...document.querySelectorAll('.nav__links a')];

/* ------------------------------------------------ valve UI (works with or without WebGL) */
const valveBtn = document.querySelector('[data-valve-toggle]');
const valveStatus = document.querySelector('[data-valve-status]');
let experience = null;
let valveOpen = true;
function renderValveState(open) {
  valveOpen = open;
  valveStatus.textContent = open ? 'open' : 'isolated';
  valveBtn.setAttribute('aria-pressed', String(!open));
  valveBtn.firstElementChild.textContent = open ? 'Shut off the flow' : 'Restore the flow';
  root.classList.toggle('valve-shut', !open);
}
valveBtn.addEventListener('click', () => {
  renderValveState(experience ? experience.toggleValve() : !valveOpen);
});

/* ------------------------------------------------ contact form (progressive) */
const form = document.querySelector('[data-form]');
const formStatus = document.querySelector('[data-form-status]');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (form.querySelector('[name="company-url"]').value) return;
  formStatus.textContent = 'Sending…';
  try {
    const res = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString(),
    });
    if (!res.ok) throw new Error(res.status);
    form.reset();
    formStatus.textContent = 'Thanks — an engineer will reply within one working day.';
  } catch {
    formStatus.innerHTML = 'Couldn’t send just now. Email <a href="mailto:hello@pipeworks.example">hello@pipeworks.example</a>.';
  }
});

/* ------------------------------------------------ main loop */
let lastShot = -1;
function tick(time) {
  lenis?.raf(time);
  if (!lenis) velocity = 0;

  const f = shotProgress(scrollY);
  experience?.setProgress(f);
  experience?.setPointer(pointer.x, pointer.y);
  experience?.setVelocity(velocity);

  updateParallax();
  if (finePointer && !reducedMotion) {
    updateMagnets();
    cursorPos.x += (pointer.cx - cursorPos.x) * 0.2;
    cursorPos.y += (pointer.cy - cursorPos.y) * 0.2;
    cursor.style.transform = `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0)`;
  }

  nav.classList.toggle('is-scrolled', scrollY > 40);
  const current = Math.round(f);
  if (current !== lastShot) {
    lastShot = current;
    const id = shotSections[current]?.id;
    navLinks.forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === `#${id}`));
    root.dataset.shot = shotSections[current]?.dataset.shot ?? '';
  }
  requestAnimationFrame(tick);
}

measure();
new ResizeObserver(() => {
  measure();
  experience?.resize();
}).observe(document.body);
requestAnimationFrame(tick);

/* ------------------------------------------------ lazy WebGL boot */
async function bootWebGL() {
  if (tier === 'none') {
    root.classList.add('no-webgl');
    return;
  }
  try {
    const { createExperience } = await import('./webgl/Experience.js');
    experience = await createExperience({
      canvas: document.getElementById('webgl'),
      tier,
      reducedMotion,
      snap: params.has('snap'),
    });
    experience.onHover((h) => {
      cursor.classList.toggle('is-valve', h);
      root.classList.toggle('valve-hover', h);
    });
    window.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input, select, textarea, label')) return;
      if (experience.click()) renderValveState(experience.valveOpen);
    });
    experience.setProgress(shotProgress(scrollY));
    experience.start();
    await experience.firstFrame;
    root.classList.add('webgl-ready');
  } catch (err) {
    console.error('[pipeworks] WebGL unavailable, showing static poster', err);
    root.classList.add('no-webgl');
  }
}

// Let the text (LCP) paint first, then spend the main thread on 3D.
const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 120));
if (document.readyState === 'complete') idle(bootWebGL, { timeout: 1200 });
else window.addEventListener('load', () => idle(bootWebGL, { timeout: 1200 }), { once: true });
