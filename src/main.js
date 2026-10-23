import './style.css';
import Lenis from 'lenis';
import { createGL, loadTexture, clamp } from './gl/core.js';
import { Glass } from './gl/glass.js';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const root = document.documentElement;
const VIEWS = {};
window.__V = VIEWS;

/* ───────────── scroll ───────────── */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
const lenis = new Lenis({ lerp: 0.085, autoRaf: false });
window.__lenis = lenis;
lenis.stop();

$$('[data-nav]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    setMenu(false);
    const id = a.getAttribute('href');
    lenis.scrollTo(id === '#topo' ? 0 : id, { duration: 2, easing: (t) => 1 - Math.pow(1 - t, 4) });
  }),
);

/* ───────────── menu ───────────── */
const menuBtn = $('[data-menu-btn]');
function setMenu(open) {
  root.classList.toggle('menu-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  $('[data-menu]').setAttribute('aria-hidden', String(!open));
  $$('[data-menu-label],[data-menu-label2]').forEach((s) => (s.textContent = open ? 'Fechar' : 'Menu'));
  open ? lenis.stop() : lenis.start();
}
menuBtn.addEventListener('click', () => setMenu(!root.classList.contains('menu-open')));
addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

/* ───────────── fades ───────────── */
const io = new IntersectionObserver(
  (entries) =>
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      io.unobserve(en.target);
    }),
  { rootMargin: '0px 0px -10% 0px' },
);
$$('[data-fade]').forEach((el) => io.observe(el));

/* ───────────── magnetic button ───────────── */
$$('[data-magnetic]').forEach((el) => {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
  });
  el.addEventListener('pointerleave', () => (el.style.transform = ''));
  el.style.transition = 'transform .6s cubic-bezier(.35,0,0,1)';
});

/* ───────────── webgl ───────────── */
const S = createGL($('#gl'));
window.__S = S;
addEventListener('resize', () => S.resize());

async function boot() {
  await document.fonts.load('300px "Gloock"');
  await document.fonts.load('400 40px "Inter Tight Variable"');
  const photo = await loadTexture('/nicolas-cut.png');

  VIEWS.glass = S.add(new Glass(S, $('[data-view="glass"]'), { photo }));
  await VIEWS.glass.ready;
  root.classList.add('is-ready');
  VIEWS.glass.start();
  setTimeout(() => lenis.start(), 1400);

  const mods = await Promise.allSettled([
    import('./gl/draft.js').then((m) => (VIEWS.draft = S.add(new m.Draft(S, $('[data-view="draft"]'), $('[data-draft-text]').textContent)))),
    import('./gl/plates.js').then((m) => (VIEWS.plates = S.add(new m.Plates(S, $('[data-view="plates"]'), $('.plates'))))),
    import('./gl/relief.js').then((m) => (VIEWS.relief = S.add(new m.Relief(S, $('[data-view="relief"]'), $$('[data-relief]'))))),
    import('./gl/sheets.js').then((m) => (VIEWS.sheets = S.add(new m.Sheets(S, $('[data-view="sheets"]'), $('.method'))))),
    import('./gl/wall.js').then((m) => (VIEWS.wall = S.add(new m.Wall(S, $('[data-view="wall"]'), $('.wall'))))),
    import('./gl/ink.js').then((m) => (VIEWS.ink = S.add(new m.Ink(S, $('[data-view="ink"]'))))),
  ]);
  mods.forEach((m) => m.status === 'rejected' && console.error(m.reason));
  // keep the hero first so the scissor order follows the page
  S.views.sort((a, b) => a.el.getBoundingClientRect().top + scrollY - (b.el.getBoundingClientRect().top + scrollY));

}

/* ───────────── rows: open on hover / click ───────────── */
$$('[data-row]').forEach((row) => {
  const head = $('.row__head', row);
  const set = (v) => {
    row.classList.toggle('is-open', v);
    head.setAttribute('aria-expanded', String(v));
  };
  row.addEventListener('pointerenter', () => set(true));
  row.addEventListener('pointerleave', () => set(false));
  head.addEventListener('click', () => set(!row.classList.contains('is-open')));
});

let last = performance.now();
let lastLight = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  lenis.raf(now);
  S.step(dt);
  S.render();
  // the header reads dark while the wall is in daylight behind it
  const w = VIEWS.wall;
  const light = w && w.rect && w.rect.top < 90 && w.rect.bottom > 0 && w.day > 0.06 && w.day < 0.93;
  if (light !== lastLight) root.classList.toggle('hdr-dark', !!(lastLight = light));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
boot();

export { clamp };
