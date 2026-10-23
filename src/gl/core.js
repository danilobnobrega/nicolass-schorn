import * as THREE from 'three';

export const GRAPHITE = '#12110f';
export const BONE = '#ece6da';
export const BRASS = '#b48d55';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// the one curve of the site: cubic-bezier(.35,0,0,1), solved numerically
export function ease(t) {
  t = clamp(t);
  let lo = 0,
    hi = 1,
    u = t;
  for (let i = 0; i < 18; i++) {
    u = (lo + hi) / 2;
    const x = 3 * (1 - u) * (1 - u) * u * 0.35 + 3 * (1 - u) * u * u * 0 + u * u * u;
    x < t ? (lo = u) : (hi = u);
  }
  return 3 * (1 - u) * u * u * 1 + u * u * u;
}

export class Spring {
  constructor(v = 0, k = 120, c = 14) {
    this.v = v;
    this.t = v;
    this.vel = 0;
    this.k = k;
    this.c = c;
  }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (this.t - this.v) * this.k - this.vel * this.c;
      this.vel += a * h;
      this.v += this.vel * h;
    }
    return this.v;
  }
}

/*
 * One renderer, one fixed canvas. Each section owns a view drawn only inside the
 * screen rectangle of its DOM element. A single light, led by the cursor, is shared
 * by every view, so it travels with you through the whole site.
 */
export function createGL(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.toneMapping = THREE.NoToneMapping;

  const S = {
    renderer,
    w: 1,
    h: 1,
    dpr: 1,
    time: 0,
    dt: 1 / 60,
    mouse: { x: 0, y: 0, seen: false },
    // light in screen pixels (smoothed) + height above the page in px
    light: { x: 0, y: 0, vx: 0, vy: 0 },
    views: [],
  };
  const lx = new Spring(0, 30, 10);
  const ly = new Spring(0, 30, 10);

  S.resize = () => {
    S.w = window.innerWidth;
    S.h = window.innerHeight;
    S.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(S.dpr);
    renderer.setSize(S.w, S.h, false);
    if (!S.mouse.seen) {
      S.mouse.x = S.w * 0.66;
      S.mouse.y = S.h * 0.3;
      lx.v = lx.t = S.mouse.x;
      ly.v = ly.t = S.mouse.y;
    }
    S.views.forEach((v) => v.resize?.());
  };
  addEventListener('pointermove', (e) => {
    S.mouse.x = e.clientX;
    S.mouse.y = e.clientY;
    S.mouse.seen = true;
  });

  S.add = (v) => {
    S.views.push(v);
    return v;
  };

  S.step = (dt) => {
    S.dt = dt;
    S.time += dt;
    lx.t = S.mouse.x;
    ly.t = S.mouse.y;
    const px = S.light.x;
    const py = S.light.y;
    S.light.x = lx.step(dt);
    S.light.y = ly.step(dt);
    S.light.vx = (S.light.x - px) / Math.max(dt, 1e-3);
    S.light.vy = (S.light.y - py) / Math.max(dt, 1e-3);
  };

  S.render = () => {
    renderer.setScissorTest(false);
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, S.w, S.h);
    renderer.clear();
    for (const v of S.views) {
      const r = v.el.getBoundingClientRect();
      v.rect = r;
      const on = r.bottom > -2 && r.top < S.h + 2 && r.width > 0 && r.height > 0;
      v.update?.(r, on);
      if (!on || v.hidden) continue;
      const top = Math.max(0, r.top);
      const bottom = Math.min(S.h, r.bottom);
      if (bottom - top < 1) continue;
      v.prerender?.(renderer, r);
      renderer.setRenderTarget(null);
      renderer.setScissorTest(true);
      renderer.setViewport(r.left, S.h - r.bottom, r.width, r.height);
      renderer.setScissor(r.left, S.h - bottom, r.width, bottom - top);
      v.render(renderer);
      renderer.setScissorTest(false);
    }
  };

  S.resize();
  return S;
}

// a full-rect quad with its own camera; most views are a single shader
export function quad(material) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { scene, cam, mesh, draw: (r) => r.render(scene, cam) };
}

export function loadTexture(url, srgb = true) {
  return new Promise((res, rej) =>
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 8;
        res(t);
      },
      undefined,
      rej,
    ),
  );
}

export function canvasTex(canvas, { srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = 8;
  return t;
}

export function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// keeps a view's uSeam uniform in step with its rectangle on screen
export function seamUniform() {
  return { value: new THREE.Vector4(-1e4, 1e5, 1, 1) };
}
export function setSeam(u, r, S) {
  u.value.set(r.top > 1 ? r.top : -1e4, r.bottom < S.h - 1 ? r.bottom : 1e5, S.h, S.dpr);
}

export const DISPLAY = '"Gloock", serif';
export const SANS = '"Inter Tight Variable", sans-serif';

// sRGB hex as raw vec3 for shaders that write straight to the screen
export const raw = (hex) => {
  const c = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
};

// shared GLSL: noise and the studio environment every material reflects
export const GLSL_COMMON = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= .5; } return s; }
// a dark studio with two long soft boxes and a warm floor bounce
vec3 studio(vec3 d){
  d = normalize(d);
  vec3 c = vec3(.018,.016,.014) + vec3(.05,.04,.03) * smoothstep(-.4,.6,d.y);
  float box1 = smoothstep(.16,.0, abs(d.x - .55)) * smoothstep(.55,.25, abs(d.y - .35));
  float box2 = smoothstep(.10,.0, abs(d.x + .7)) * smoothstep(.7,.3, abs(d.y - .1));
  float strip = smoothstep(.03,.0, abs(d.y - .78)) * smoothstep(.9,.2, abs(d.x));
  c += vec3(1.,.93,.82) * box1 * 2.2 + vec3(.75,.8,.9) * box2 * .9 + vec3(1.) * strip * .6;
  c += vec3(.22,.15,.08) * smoothstep(.0,-.6,d.y);
  return c;
}
// every scene melts into the page at its edges, and its darkest dark is the page itself
uniform vec4 uSeam; // top, bottom (css px, -1e4/1e5 when off-edge), viewport height, dpr
vec3 seam(vec3 c){
  float y = uSeam.z - gl_FragCoord.y / uSeam.w;
  float F = uSeam.z * .32;
  float m = smoothstep(0., F, y - uSeam.x) * smoothstep(0., F, uSeam.y - y);
  vec3 bg = vec3(.0706,.0667,.0588);
  c = c + bg * (1. - c);
  return mix(bg, c, m);
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
vec3 toSRGB(vec3 c){ return pow(c, vec3(1./2.2)); }
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
`;
