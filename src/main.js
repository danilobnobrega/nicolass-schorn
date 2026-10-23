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
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
const peek = document.createElement('img');
peek.className = 'premio-img';
peek.alt = '';
document.body.appendChild(peek);
let peekOn = false;
const pk = { x: 0, y: 0 };
$$('[data-row][data-img]').forEach((row) => {
  new Image().src = row.dataset.img;
  row.addEventListener('pointerenter', () => {
    peek.src = row.dataset.img;
    peekOn = true;
    peek.style.opacity = '1';
  });
  row.addEventListener('pointerleave', () => {
    peekOn = false;
    peek.style.opacity = '0';
  });
});
function stepPeek(dt) {
  const k = 1 - Math.pow(0.002, dt);
  const vx = mouse.x - pk.x;
  pk.x += vx * k;
  pk.y += (mouse.y - pk.y) * k;
  const rot = Math.max(-12, Math.min(12, vx * 0.08));
  peek.style.transform = `translate(${pk.x}px, ${pk.y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${peekOn ? 1 : 0.85})`;
}

/* ───────────── webgl ───────────── */
/* ───────────── ?debug: what this device's GPU can do, and any errors, on screen ───────────── */
if (location.search.includes('debug')) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;z-index:99;left:8px;right:8px;bottom:8px;max-height:45vh;overflow:auto;margin:0;padding:10px;font:11px/1.4 monospace;color:#9f9;background:rgba(0,0,0,.85);white-space:pre-wrap;pointer-events:none';
  document.body.appendChild(box);
  const log = (s) => (box.textContent += s + String.fromCharCode(10));
  addEventListener('error', (e) => log('ERR ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  addEventListener('unhandledrejection', (e) => log('REJ ' + (e.reason?.message || e.reason)));
  const ce = console.error.bind(console);
  console.error = (...a) => (log('CE ' + a.map(String).join(' ').slice(0, 300)), ce(...a));
  const cw = console.warn.bind(console);
  console.warn = (...a) => (log('CW ' + a.map(String).join(' ').slice(0, 300)), cw(...a));
  window.__dbg = log;
}

const S = createGL($('#gl'));
if (window.__dbg) {
  const gl = S.renderer.getContext();
  const ri = gl.getExtension('WEBGL_debug_renderer_info');
  window.__dbg(`gpu ${ri ? gl.getParameter(ri.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`);
  window.__dbg(`webgl2 ${S.renderer.capabilities.isWebGL2} · rt ${S.rtType === 1016 ? 'half' : 'byte'} · floatLinear ${!!gl.getExtension('OES_texture_float_linear')} · maxTex ${gl.getParameter(gl.MAX_TEXTURE_SIZE)} · precision ${S.renderer.capabilities.precision}`);
  window.__dbg(`screen ${innerWidth}x${innerHeight} dpr ${devicePixelRatio} · canvas letterSpacing ${'letterSpacing' in CanvasRenderingContext2D.prototype}`);
  setInterval(() => window.__dbg(`views ${S.views.map((v) => v.constructor.name + (v.hidden ? '(h)' : '')).join(' ')} · fps ${Math.round(1 / Math.max(S.dt, 1e-3))}`), 3000);
}
window.__S = S;
addEventListener('resize', () => S.resize());

async function boot() {
  setTimeout(() => root.classList.add('is-ready'), 8000);
  await document.fonts.load('300px "Gloock"');
  await document.fonts.load('400 40px "Inter Tight Variable"');
  const [photo, geo] = await Promise.all([loadTexture('/nicolas-cut.png'), loadTexture('/nicolas-geo.png', false)]);

  VIEWS.glass = S.add(new Glass(S, $('[data-view="glass"]'), { photo, geo }));
  // never leave the page blank: if the hero is slow, open anyway
  await Promise.race([VIEWS.glass.ready, new Promise((r) => setTimeout(r, 5000))]);
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
