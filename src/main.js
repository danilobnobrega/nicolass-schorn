import './style.css';
import Lenis from 'lenis';
import { createGL, loadTexture, clamp } from './gl/core.js';
import { Glass } from './gl/glass.js';
// every scene in the one bundle: a phone never has to fetch a second script mid-deploy
import { Draft } from './gl/draft.js';
import { Plates } from './gl/plates.js';
import { Relief } from './gl/relief.js';
import { Sheets } from './gl/sheets.js';
import { Wall } from './gl/wall.js';
import { Ink } from './gl/ink.js';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const root = document.documentElement;
const VIEWS = {};
window.__V = VIEWS;

/* ───────────── scroll ───────────── */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
// on phones the scroll is driven from the same frame as the WebGL, so type drawn in the
// canvas never trails the page
const touchScroll = matchMedia('(hover: none), (pointer: coarse)').matches;
const lenis = new Lenis({ lerp: 0.085, autoRaf: false, syncTouch: touchScroll, syncTouchLerp: 0.09, touchInertiaExponent: 1.7 });
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
{
  // diagnostics: always recorded, shown with ?debug or by itself when something goes wrong
  const lines = [];
  let box = null;
  const show = (why) => {
    if (!box) {
      box = document.createElement('pre');
      box.style.cssText = 'position:fixed;z-index:99;left:8px;right:8px;bottom:8px;max-height:55vh;overflow:auto;margin:0;padding:10px;font:11px/1.4 monospace;color:#9f9;background:rgba(0,0,0,.88);white-space:pre-wrap;pointer-events:none';
      document.body.appendChild(box);
    }
    if (why) lines.unshift('>> ' + why);
    box.textContent = lines.join(String.fromCharCode(10));
  };
  const t0 = performance.now();
  const log = (s) => {
    lines.push(((performance.now() - t0) / 1000).toFixed(1) + 's ' + s);
    if (box) show();
  };
  window.__dbg = log;
  // the panel only shows with ?debug; the live site reports to the project's logs instead
  window.__trouble = (why) => (lines.unshift('>> ' + why), location.search.includes('debug') && show());
  if (location.search.includes('debug')) show();
  addEventListener('error', (e) => (log('ERR ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno), window.__trouble('erro')));
  addEventListener('unhandledrejection', (e) => (log('REJ ' + (e.reason?.message || e.reason)), window.__trouble('erro')));
  const ce = console.error.bind(console);
  console.error = (...a) => (log('CE ' + a.map(String).join(' ').slice(0, 300)), ce(...a));
  // a load that never reached "healthy" means the page was killed (usually memory)
  try {
    const prev = +(sessionStorage.getItem('nic-boot') || 0);
    if (prev) {
      const n = +(sessionStorage.getItem('nic-crash') || 0) + 1;
      sessionStorage.setItem('nic-crash', n);
      log('a página anterior caiu durante o carregamento (' + n + 'x)');
      setTimeout(() => window.__trouble('página caiu antes'), 1500);
    }
    sessionStorage.setItem('nic-boot', Date.now());
    setTimeout(() => sessionStorage.removeItem('nic-boot'), 15000);
  } catch (e) {}
  log('build ' + (typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'));
  log(navigator.userAgent);
  // on the live site, phones report their diagnostics to the project's own logs
  if (matchMedia('(hover: none), (pointer: coarse)').matches && !/localhost|192\.168/.test(location.host)) {
    const id = Math.random().toString(36).slice(2, 8);
    const send = (tag) => {
      try {
        navigator.sendBeacon('/api/diag', new Blob([JSON.stringify({ id, tag, lines })], { type: 'text/plain' }));
      } catch (e) {}
    };
    let pend = null;
    const dbg = window.__dbg;
    window.__dbg = (x) => {
      dbg(x);
      clearTimeout(pend);
      pend = setTimeout(() => send('stage'), 250);
    };
    setTimeout(() => send('4s'), 4000);
    setTimeout(() => send('12s'), 12000);
    const trouble = window.__trouble;
    let sent = 0;
    window.__trouble = (why) => (trouble(why), sent++ < 5 && setTimeout(() => send('trouble'), 300));
    addEventListener('pagehide', () => send('hide'));
  }
}

// no WebGL (blocked, unsupported, or refused by the browser): the page still works,
// with the photo and plain type standing in for the scenes
let S = null;
// a browser that refused WebGL a moment ago (after a GPU reset) often gives it to a fresh
// canvas a little later, so try a few times before settling for the plain page
async function makeGL() {
  for (let i = 0; i < 4; i++) {
    try {
      const s = createGL($('#gl'));
      const gl = s.renderer.getContext();
      if (gl && !gl.isContextLost()) return s;
      s.renderer.dispose();
      throw new Error('contexto perdido na criação');
    } catch (e) {
      window.__dbg?.(`webgl tentativa ${i + 1}: ${e.message}`);
      const fresh = document.createElement('canvas');
      fresh.id = 'gl';
      fresh.setAttribute('aria-hidden', 'true');
      $('#gl').replaceWith(fresh);
      await new Promise((r) => setTimeout(r, 500 + i * 700));
    }
  }
  return null;
}
// no WebGL right now (blocked for a while after a GPU reset): the page stays exactly as it
// is and keeps asking; the moment a context is granted, the scenes come back where you are
function noGL() {
  root.classList.add('is-ready', 'no-gl');
  setTimeout(() => lenis.start(), 300);
  let tries = 0;
  const again = async () => {
    if (S || tries++ > 40) return;
    const s = await makeGL();
    if (s) {
      S = s;
      startGL();
    } else setTimeout(again, 3000);
  };
  setTimeout(again, 3000);
}
function describeGL() {
  const gl = S.renderer.getContext();
  const ri = gl.getExtension('WEBGL_debug_renderer_info');
  window.__dbg(`gpu ${ri ? gl.getParameter(ri.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`);
  window.__dbg(`webgl2 ${S.renderer.capabilities.isWebGL2} · rt ${S.rtType === 1016 ? 'half' : 'byte'} · floatLinear ${!!gl.getExtension('OES_texture_float_linear')} · maxTex ${gl.getParameter(gl.MAX_TEXTURE_SIZE)} · precision ${S.renderer.capabilities.precision}`);
  window.__dbg(`screen ${innerWidth}x${innerHeight} dpr ${devicePixelRatio} · canvas letterSpacing ${'letterSpacing' in CanvasRenderingContext2D.prototype}`);
  if (location.search.includes('debug')) setInterval(() => window.__dbg(`views ${S.views.map((v) => v.constructor.name + (v.hidden ? '(h)' : '')).join(' ')} · fps ${Math.round(1 / Math.max(S.dt, 1e-3))}`), 3000);
}
addEventListener('resize', () => S?.resize());

let scenesTimer = 0;
async function boot() {
  window.__dbg('boot');
  setTimeout(() => root.classList.add('is-ready'), 8000);
  await document.fonts.load('300px "Gloock"');
  await document.fonts.load('400 40px "Inter Tight Variable"');
  window.__dbg('fontes ok');
  S = await makeGL();
  if (!S) return noGL();
  startGL();
}

// a GPU reset on a phone: rebuild everything on a fresh canvas, at the current scroll
function onLost() {
  // while there is no context the titles drawn by WebGL fall back to the page's own type
  root.classList.add('no-gl');
  window.__dbg('reconstruindo o WebGL');
  clearInterval(scenesTimer);
  for (const k of Object.keys(VIEWS)) delete VIEWS[k];
  const old = S;
  S = null;
  try {
    old?.renderer.dispose();
  } catch (e) {}
  setTimeout(async () => {
    const s = await makeGL();
    if (!s) return noGL();
    S = s;
    startGL(true);
  }, 600);
}

async function startGL(again = false) {
  root.classList.remove('no-gl');
  window.__S = S;
  S.onLost = onLost;
  describeGL();
  setTimeout(() => !VIEWS.glass?.started && window.__trouble('abertura não iniciou em 7s'), 7000);
  const [photo, geo] = await Promise.all([loadTexture('/nicolas-cut.png'), loadTexture('/nicolas-geo.png', false)]);
  window.__dbg('fotos ok');

  VIEWS.glass = S.add(new Glass(S, $('[data-view="glass"]'), { photo, geo }));
  // never leave the page blank: if the hero is slow, open anyway
  await Promise.race([VIEWS.glass.ready.then(() => window.__dbg('vidro pronto')), new Promise((r) => setTimeout(r, 5000))]);
  root.classList.add('is-ready');
  VIEWS.glass.start(again);
  if (!again) setTimeout(() => lenis.start(), 1400);

  // the other scenes: all at once on a desktop; on a phone each one is built as it
  // comes within reach and torn down once it is far behind, so memory stays small
  const SCENES = [
    ['draft', '[data-view="draft"]', async () => new Draft(S, $('[data-view="draft"]'), $('[data-draft-text]').textContent)],
    ['plates', '[data-view="plates"]', async () => new Plates(S, $('[data-view="plates"]'), $('.plates'))],
    ['relief', '[data-view="relief"]', async () => new Relief(S, $('[data-view="relief"]'), $$('[data-relief]'))],
    ['sheets', '[data-view="sheets"]', async () => new Sheets(S, $('[data-view="sheets"]'), $('.method'))],
    ['wall', '[data-view="wall"]', async () => new Wall(S, $('[data-view="wall"]'), $('.wall'))],
    ['ink', '[data-view="ink"]', async () => new Ink(S, $('[data-view="ink"]'))],
  ].map(([key, sel, make]) => ({ key, el: $(sel), make, state: 'idle' }));
  const sortViews = () => S.views.sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
  const build = async (sc) => {
    sc.state = 'building';
    try {
      const v = await sc.make();
      v.key = sc.key;
      VIEWS[sc.key] = S.add(v);
      sortViews();
      sc.state = 'live';
      window.__dbg?.('+ ' + sc.key);
    } catch (e) {
      console.error(e);
      sc.state = 'failed';
    }
  };
  // every scene is built and warmed while the intro plays, one per frame gap, so a scroll
  // never waits for a build, a shader compile or a texture upload
  for (const sc of SCENES) {
    if (!S) return;
    await build(sc);
    const v = VIEWS[sc.key];
    if (v) {
      await new Promise((r) => setTimeout(r, 0));
      await (v.ready || Promise.resolve());
      if (v.hidden) await new Promise((r) => { const t = setInterval(() => !v.hidden && (clearInterval(t), r()), 50); setTimeout(() => (clearInterval(t), r()), 4000); });
      if (S) S.warm(v);
      window.__dbg?.('aquecido ' + sc.key);
    }
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  }
  // heartbeat: what is on screen and how the frames are doing
  if (S.touch) {
    let worst = 0;
    const tick = () => (worst = Math.max(worst, S?.dt || 0));
    scenesTimer = setInterval(() => {
      if (!S) return;
      const on = S.views.filter((v) => v.rect && v.rect.bottom > 0 && v.rect.top < S.h).map((v) => v.key || 'gl');
      window.__dbg?.(`y ${Math.round(scrollY)} · ${on.join('+')} · pior quadro ${Math.round(worst * 1000)}ms`);
      worst = 0;
    }, 2000);
    S.onFrame = tick;
  }
}

let last = performance.now();
let lastLight = false;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  lenis.raf(now);
  stepPeek(dt);
  if (S && !S.lost) {
    S.step(dt);
    S.render();
    S.onFrame?.();
  }
  // the header reads dark while the wall is in daylight behind it
  const w = VIEWS.wall;
  const light = w && w.rect && w.rect.top < 90 && w.rect.bottom > 0 && w.day > 0.06 && w.day < 0.93;
  if (light !== lastLight) root.classList.toggle('hdr-dark', !!(lastLight = light));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
boot();

export { clamp };
