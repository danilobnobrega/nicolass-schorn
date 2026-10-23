import './style.css';
import Lenis from 'lenis';
import { createGL, loadTexture, clamp, disposeDeep } from './gl/core.js';
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
function noGL() {
  root.classList.add('gl-lost', 'is-ready');
  $('#gl').style.display = 'none';
  setTimeout(() => lenis.start(), 300);
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

async function boot() {
  S = await makeGL();
  if (!S) return noGL();
  window.__S = S;
  describeGL();
  setTimeout(() => root.classList.add('is-ready'), 8000);
  window.__dbg('boot');
  setTimeout(() => !VIEWS.glass?.started && window.__trouble('abertura não iniciou em 7s'), 7000);
  await document.fonts.load('300px "Gloock"');
  await document.fonts.load('400 40px "Inter Tight Variable"');
  window.__dbg('fontes ok');
  const [photo, geo] = await Promise.all([loadTexture('/nicolas-cut.png'), loadTexture('/nicolas-geo.png', false)]);
  window.__dbg('fotos ok');

  VIEWS.glass = S.add(new Glass(S, $('[data-view="glass"]'), { photo, geo }));
  // never leave the page blank: if the hero is slow, open anyway
  await Promise.race([VIEWS.glass.ready.then(() => window.__dbg('vidro pronto')), new Promise((r) => setTimeout(r, 5000))]);
  root.classList.add('is-ready');
  VIEWS.glass.start();
  setTimeout(() => lenis.start(), 1400);

  // the other scenes: all at once on a desktop; on a phone each one is built as it
  // comes within reach and torn down once it is far behind, so memory stays small
  const SCENES = [
    ['draft', '[data-view="draft"]', () => import('./gl/draft.js').then((m) => new m.Draft(S, $('[data-view="draft"]'), $('[data-draft-text]').textContent))],
    ['plates', '[data-view="plates"]', () => import('./gl/plates.js').then((m) => new m.Plates(S, $('[data-view="plates"]'), $('.plates')))],
    ['relief', '[data-view="relief"]', () => import('./gl/relief.js').then((m) => new m.Relief(S, $('[data-view="relief"]'), $$('[data-relief]')))],
    ['sheets', '[data-view="sheets"]', () => import('./gl/sheets.js').then((m) => new m.Sheets(S, $('[data-view="sheets"]'), $('.method')))],
    ['wall', '[data-view="wall"]', () => import('./gl/wall.js').then((m) => new m.Wall(S, $('[data-view="wall"]'), $('.wall')))],
    ['ink', '[data-view="ink"]', () => import('./gl/ink.js').then((m) => new m.Ink(S, $('[data-view="ink"]')))],
  ].map(([key, sel, make]) => ({ key, el: $(sel), make, state: 'idle' }));
  const sortViews = () => S.views.sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
  const build = async (sc) => {
    sc.state = 'building';
    try {
      VIEWS[sc.key] = S.add(await sc.make());
      sortViews();
      sc.state = 'live';
      window.__dbg?.('+ ' + sc.key);
    } catch (e) {
      console.error(e);
      sc.state = 'failed';
    }
  };
  const drop = (sc) => {
    const v = VIEWS[sc.key];
    S.views = S.views.filter((x) => x !== v);
    disposeDeep(v);
    delete VIEWS[sc.key];
    sc.state = 'idle';
    window.__dbg?.('- ' + sc.key);
  };
  if (!S.touch) {
    for (const sc of SCENES) await build(sc);
  } else {
    // one scene at a time, in the order they are needed
    let busy = false;
    setInterval(async () => {
      if (busy) return;
      const h = innerHeight;
      for (const sc of SCENES) {
        const r = sc.el.closest('section').getBoundingClientRect();
        const near = r.bottom > -1.2 * h && r.top < 2.2 * h;
        const far = r.bottom < -2.5 * h || r.top > 3.5 * h;
        if (near && sc.state === 'idle') {
          busy = true;
          await build(sc);
          busy = false;
          return;
        }
        if (far && sc.state === 'live') drop(sc);
      }
    }, 250);
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
