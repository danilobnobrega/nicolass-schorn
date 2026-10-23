import * as THREE from 'three';
// single-stroke script glyphs (Hershey "scripts"), only the letters of the name
import GLYPHS from './script-glyphs.json';
import { quad, clamp, GLSL_COMMON } from './core.js';

/*
 * Contact: the name written by hand in metallic brass ink on the dark page. The strokes
 * come from a single-line script, smoothed and drawn with a broad nib (width follows the
 * angle of travel), in writing order, with pen lifts and the accent added last. Wet ink
 * is dark and glossy; it dries to a satin metal that sparkles under the cursor's light.
 */
const NIB = (38 * Math.PI) / 180;
const SPEED = 230; // glyph units per second

function parse(d) {
  return d
    .split('M')
    .filter(Boolean)
    .map((s) =>
      s
        .replace('L', ' ')
        .trim()
        .split(/\s+/)
        .map((p) => p.split(',').map(Number)),
    );
}

// centripetal catmull-rom, so the coarse hershey points become a flowing line
function smoothLine(pts, sub = 8) {
  if (pts.length < 3) return pts;
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const t01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5) || 1e-3;
    const t12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5) || 1e-3;
    const t23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5) || 1e-3;
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const m1 = [0, 1].map((a) => p2[a] - p1[a] + t12 * ((p1[a] - p0[a]) / t01 - (p2[a] - p0[a]) / (t01 + t12)));
      const m2 = [0, 1].map((a) => p2[a] - p1[a] + t12 * ((p3[a] - p2[a]) / t23 - (p3[a] - p1[a]) / (t12 + t23)));
      const t2 = t * t,
        t3 = t2 * t;
      out.push([0, 1].map((a) => (2 * t3 - 3 * t2 + 1) * p1[a] + (t3 - 2 * t2 + t) * m1[a] + (-2 * t3 + 3 * t2) * p2[a] + (t3 - t2) * m2[a]));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function nameStrokes() {
  const strokes = [];
  const place = (ch, ox, skipFirst = false) => {
    const g = parse(GLYPHS[ch].d);
    const minX = Math.min(...g.flat().map((p) => p[0]));
    g.forEach((s, si) => {
      if (skipFirst && si === 0) return;
      strokes.push(s.map(([x, y]) => [x - minX + ox, y]));
    });
    const last = g[g.length - 1];
    return { exit: last[last.length - 1][0] - minX + ox, maxX: Math.max(...g.flat().map((p) => p[0])) - minX + ox };
  };
  // "Nicolas" is one connected word: each letter starts where the last one left off
  let x = 0;
  let iX = 0;
  for (const ch of 'Nicolas') {
    if (ch === 'i') iX = x;
    x = place(ch, x, ch === 'i').exit; // the dot of the i becomes an accent, written later
  }
  // the accent over the i, once the word is done
  strokes.push([
    [iX + 3.6, 10.4],
    [iX + 5.6, 7.8],
    [iX + 7, 6.2],
  ]);
  // T. S.
  const t = place('T', x + 9);
  place('.', t.maxX - 5);
  const sx = t.maxX + 3;
  const sg = place('S', sx);
  place('.', sg.maxX + 1.5);
  const end = sg.maxX + 4;
  // a long underline swash
  strokes.push([
    [4, 27.2],
    [28, 28.4],
    [62, 27.4],
    [end - 6, 24.8],
    [end + 4, 21.2],
  ]);
  return strokes.map((s) => smoothLine(s));
}

const STRIP_VS = /* glsl */ `
attribute float aT; attribute float aSide; attribute float aInk;
uniform vec2 uRes;
varying float vT; varying float vSide; varying float vInk;
void main(){ vT = aT; vSide = aSide; vInk = aInk;
  vec2 c = position.xy / uRes * 2. - 1.; gl_Position = vec4(c.x, -c.y, 0., 1.); }
`;
const STRIP_FS = /* glsl */ `
precision highp float;
uniform float uHead, uTotal;
varying float vT; varying float vSide; varying float vInk;
void main(){
  if (vT > uHead) discard;
  float prof = 1. - vSide * vSide;
  // the newest millimetre is still spreading from the nib
  float fresh = smoothstep(0., .05, uHead - vT);
  gl_FragColor = vec4(fresh * smoothstep(0., .35, prof), vT / uTotal, prof * vInk * fresh, 1.);
}
`;

const SHOW_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uInk;
uniform vec2 uRes, uLight;
uniform float uHead, uTotal, uTime;
${GLSL_COMMON}
void main(){
  vec2 px = vec2(vUv.x, 1. - vUv.y) * uRes;
  vec2 tx = 1. / uRes;
  vec4 k = texture2D(uInk, vUv);
  // a little bleed along the fibres of the stock
  float fib = vnoise(px * vec2(.35, 2.2)) - .5;
  float cov = k.r * .6;
  cov += texture2D(uInk, vUv + vec2(tx.x * 1.2, fib * tx.y * 1.5)).r * .2;
  cov += texture2D(uInk, vUv - vec2(tx.x * 1.2, fib * tx.y * 1.5)).r * .2;
  if (cov < .002) { gl_FragColor = vec4(0.); return; }
  float age = uHead - k.g * uTotal;
  float wet = 1. - smoothstep(.15, 1.6, age);

  // surface: the ink stands a hair above the paper
  float hL = texture2D(uInk, vUv - vec2(tx.x, 0.)).b, hR = texture2D(uInk, vUv + vec2(tx.x, 0.)).b;
  float hD = texture2D(uInk, vUv - vec2(0., tx.y)).b, hU = texture2D(uInk, vUv + vec2(0., tx.y)).b;
  vec3 N = normalize(vec3((hL - hR) * mix(.8, 2.2, wet), (hD - hU) * mix(.8, 2.2, wet), 1.));
  vec3 L = normalize(vec3(uLight - px, 260.) * vec3(1., -1., 1.));
  vec3 V = vec3(0., 0., 1.);
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.);
  float flake = pow(hash12(floor(px * .9)), 6.);

  vec3 brass = toLin(vec3(.78,.6,.34));
  vec3 dry = brass * (.42 + .5 * max(dot(N, L), 0.)) + brass * pow(nh, 30.) * 1.2 + vec3(1.,.9,.7) * flake * pow(nh, 8.) * 1.4;
  vec3 wetc = toLin(vec3(.32,.22,.1)) * (.6 + .4 * max(dot(N, L), 0.)) + vec3(1.) * pow(nh, 280.) * 3.;
  vec3 col = mix(dry, wetc, wet);
  float dist = length(uLight - px);
  col *= .75 + .45 * exp(-dist * dist / (2. * 380. * 380.));
  col = toSRGB(aces(col * 1.1));
  float a = clamp(cov, 0., 1.);
  gl_FragColor = vec4(col * a, a);
}
`;

export class Ink {
  constructor(S, el) {
    this.S = S;
    this.el = el;
    this.head = 0;
    this.started = false;
    const strokes = nameStrokes();
    // timing: uniform speed along each stroke, a pause for every pen lift
    let T = 0;
    const lines = strokes.map((s, si) => {
      if (si > 0) {
        const prev = strokes[si - 1];
        const a = prev[prev.length - 1],
          b = s[0];
        T += 0.04 + Math.hypot(b[0] - a[0], b[1] - a[1]) / (SPEED * 8);

      }
      const out = s.map((p, i) => {
        if (i > 0) {
          const q = s[i - 1];
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          // the pen slows into tight turns
          const r = i < s.length - 1 ? 1 - Math.abs(Math.atan2(s[i + 1][1] - p[1], s[i + 1][0] - p[0]) - Math.atan2(p[1] - q[1], p[0] - q[0])) / Math.PI : 1;
          T += d / (SPEED * (0.55 + 0.45 * clamp(r)));
        }
        return { x: p[0], y: p[1], t: T };
      });
      return out;
    });
    this.total = T;
    this.lines = lines;
    const xs = lines.flat().map((p) => p.x),
      ys = lines.flat().map((p) => p.y);
    this.box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };

    this.stripMat = new THREE.ShaderMaterial({
      vertexShader: STRIP_VS,
      fragmentShader: STRIP_FS,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      side: THREE.DoubleSide,
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uHead: { value: 0 }, uTotal: { value: T } },
    });
    this.stripScene = new THREE.Scene();
    this.stripCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.show = quad(
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
        fragmentShader: SHOW_FS,
        transparent: true,
        depthTest: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: {
          uInk: { value: null },
          uRes: { value: new THREE.Vector2(1, 1) },
          uLight: { value: new THREE.Vector2() },
          uHead: { value: 0 },
          uTotal: { value: T },
          uTime: { value: 0 },
        },
      }),
    );
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: S.rtType });
    this.show.mesh.material.uniforms.uInk.value = this.rt.texture;
    this.resize();
  }

  build(W, H) {
    this.stripScene.clear();
    const b = this.box;
    const scale = Math.min((W * (W <= 820 ? 0.86 : 0.62)) / (b.x1 - b.x0), (H * 0.8) / (b.y1 - b.y0));
    const ox = (W - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale;
    const oy = (H - (b.y1 - b.y0) * scale) / 2 - b.y0 * scale;
    const wMax = scale * 1.3,
      wMin = scale * 0.24;
    const pos = [],
      aT = [],
      aSide = [],
      aInk = [],
      idx = [];
    this.lines.forEach((ln, li) => {
      const thin = li === this.lines.length - 1 ? 0.55 : 1;
      let len = 0;
      const base = pos.length / 3;
      ln.forEach((p, i) => {
        const a = ln[Math.max(0, i - 1)],
          c = ln[Math.min(ln.length - 1, i + 1)];
        let dx = c.x - a.x,
          dy = c.y - a.y;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        if (i > 0) len += Math.hypot(p.x - ln[i - 1].x, p.y - ln[i - 1].y) * scale;
        // broad nib: thick when travelling across the nib, thin along it
        const ang = Math.atan2(dy, dx);
        let w = wMin + (wMax - wMin) * Math.abs(Math.sin(ang - NIB));
        // the pen touches down and lifts off: taper both ends
        const left = (ln.length - 1 - i) / Math.max(1, ln.length - 1);
        w *= (0.45 + 0.55 * Math.min(1, len / (scale * 1.2)) * Math.min(1, left * 8 + 0.2)) * thin;
        const nx = -dy * w * 0.5,
          ny = dx * w * 0.5;
        const X = ox + p.x * scale,
          Y = oy + p.y * scale;
        pos.push(X + nx, Y + ny, 0, X - nx, Y - ny, 0);
        aT.push(p.t, p.t);
        aSide.push(1, -1);
        // ink pools where the nib lands
        const pool = 1 + 0.5 * Math.exp(-len / (scale * 0.8));
        aInk.push(pool, pool);
        if (i > 0) {
          const k = base + (i - 1) * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(aSide, 1));
    geo.setAttribute('aInk', new THREE.Float32BufferAttribute(aInk, 1));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.stripMat);
    mesh.frustumCulled = false;
    this.stripScene.add(mesh);
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const W = Math.round(r.width),
      H = Math.round(r.height);
    if (W < 2 || H < 2) return;
    this.W = W;
    this.H = H;
    const dpr = this.S.dpr;
    this.rt.setSize(Math.round(W * Math.min(dpr * 1.5, 2)), Math.round(H * Math.min(dpr * 1.5, 2)));
    this.stripMat.uniforms.uRes.value.set(W, H);
    this.show.mesh.material.uniforms.uRes.value.set(W, H);
    this.build(W, H);
  }

  update(r, on) {
    const S = this.S;
    if (!this.started && on && r.top < S.h * 0.62) {
      this.started = true;
      this.t0 = S.time;
    }
    if (!this.started || !on) return;
    this.head = Math.min(this.total + 3, (S.time - this.t0) * 1.0);
    this.stripMat.uniforms.uHead.value = this.head;
    const u = this.show.mesh.material.uniforms;
    u.uHead.value = this.head;
    u.uLight.value.set(S.light.x - r.left, S.light.y - r.top);
    u.uTime.value = S.time;
  }

  prerender(renderer) {
    if (!this.started) return;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.stripScene, this.stripCam);
  }

  render(renderer) {
    if (!this.started) return;
    this.show.draw(renderer);
  }
}
