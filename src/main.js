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

/* ───────────── service photo that trails the cursor ───────────── */
const peek = document.createElement('div');
peek.className = 'peek';
peek.innerHTML = '<div class="peek__in"></div>';
document.body.appendChild(peek);
const peekIn = $('.peek__in', peek);
const peekImgs = {};
let peekOn = false;
$$('[data-row][data-img]').forEach((row) => {
  const src = row.dataset.img;
  const img = new Image();
  img.src = src;
  img.alt = '';
  peekIn.appendChild(img);
  peekImgs[src] = img;
  row.addEventListener('pointerenter', () => {
    Object.values(peekImgs).forEach((im) => im.classList.toggle('cur', im === img));
    peekOn = true;
    peek.classList.add('on');
  });
  row.addEventListener('pointerleave', () => {
    peekOn = false;
    peek.classList.remove('on');
  });
});
const pk = { x: innerWidth / 2, y: innerHeight / 2, r: 0 };
function stepPeek(dt) {
  const k = 1 - Math.pow(0.0025, dt);
  const vx = mouse.x - pk.x;
  pk.x += vx * k;
  pk.y += (mouse.y - pk.y) * k;
  pk.r += (Math.max(-10, Math.min(10, vx * 0.06)) - pk.r) * (1 - Math.pow(0.02, dt));
  peek.style.transform = `translate(${pk.x}px, ${pk.y}px) translate(-50%, -50%) rotate(${pk.r}deg) scale(${peekOn ? 1 : 0.88})`;
}
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

/* ───────────── webgl ───────────── */
const S = createGL($('#gl'));
window.__S = S;
addEventListener('resize', () => S.resize());

async function boot() {
  await document.fonts.load('300px "Gloock"');
  await document.fonts.load('400 40px "Inter Tight Variable"');
  const [photo, geo] = await Promise.all([loadTexture('/nicolas-cut.png'), loadTexture('/nicolas-geo.png', false)]);

  VIEWS.glass = S.add(new Glass(S, $('[data-view="glass"]'), { photo, geo }));
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
  stepPeek(dt);
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
