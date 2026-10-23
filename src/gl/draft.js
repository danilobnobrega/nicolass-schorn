import * as THREE from 'three';
import { quad, clamp, damp, GLSL_COMMON, DISPLAY, SANS, wrap, canvasTex } from './core.js';
import { sdfTexture } from './sdf.js';

/*
 * About: the sentence is drafted before it is set. Guides and outlines are drawn first,
 * then every letter gains weight from its own skeleton until it is solid type.
 * Under the cursor the drawing shows through again.
 */
// the cursor leaves a trail (quarter resolution) that spreads, fades and drifts on a soft flow
const TRAIL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uRes, uMouse, uVel;
uniform float uDt, uOn, uTime;
${GLSL_COMMON}
void main(){
  vec2 px = vUv * uRes;
  float n1 = fbm(px * .025 + uTime * .05), n2 = fbm(px * .025 - uTime * .04 + 7.3);
  vec2 flow = vec2(n1 - .5, n2 - .5) * 14. * uDt;
  float prev = texture2D(uPrev, (px - flow) / uRes).r;
  vec2 tx = 1. / uRes;
  float blur = (texture2D(uPrev, vUv + vec2(tx.x, 0.)).r + texture2D(uPrev, vUv - vec2(tx.x, 0.)).r
              + texture2D(uPrev, vUv + vec2(0., tx.y)).r + texture2D(uPrev, vUv - vec2(0., tx.y)).r) * .25;
  float v = mix(prev, blur, .3) * exp(-uDt * .55);
  // the brush: stretched along the movement, a small presence even at rest
  vec2 d = px - uMouse;
  float sp = length(uVel);
  vec2 dir = sp > 1. ? uVel / sp : vec2(1., 0.);
  float along = dot(d, dir), across = dot(d, vec2(-dir.y, dir.x));
  float r = 9. + min(sp * .012, 10.);
  float st = 1. + min(sp * .01, 2.5);
  float b = exp(-(along * along / (r * r * st * st) + across * across / (r * r)));
  v += b * uOn * uDt * (1.8 + min(sp * .012, 4.));
  gl_FragColor = vec4(min(v, 1.4), 0., 0., 1.);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSDF, uMarks, uTrail;
uniform vec2 uRes, uMouse;
uniform float uScale, uP, uTime, uLines;
uniform vec4 uLine[4]; // per line: base y, x-height y, cap y, right edge x (all in px, top-left origin)
${GLSL_COMMON}

void main(){
  vec2 px = vec2(vUv.x, 1. - vUv.y) * uRes;
  float d = texture2D(uSDF, vUv).r / uScale;  // signed distance in css px
  float x01 = px.x / uRes.x;

  float li = 0.; float best = 1e9;
  for (int i = 0; i < 4; i++){
    if (float(i) >= uLines) break;
    float dy = abs(px.y - (uLine[i].x - 30.));
    if (dy < best){ best = dy; li = float(i); }
  }

  // progress per letter: left to right, line after line
  float order = x01 * .55 + li / max(uLines - 1., 1.) * .45;
  float t = clamp((uP - .1 - order * .5) / .4, 0., 1.);

  // the lens is the cursor's trail, with an edge that keeps changing shape
  float tr = texture2D(uTrail, vUv).r;
  float wob = fbm(px * .018 + vec2(uTime * .25, -uTime * .18)) - .5;
  float lens = smoothstep(.18, .42, tr + wob * .32);
  float rim = smoothstep(.12, .3, tr + wob * .32) - lens;   // the fringe where it is being redrawn
  float tl = mix(t, min(t, .16), lens);

  vec3 bone = vec3(.925,.902,.855);
  vec3 brass = vec3(.706,.553,.333);
  vec3 col = vec3(0.); float a = 0.;

  // drafting grid: drawn in line by line like a plotter, pulled out the same way
  vec2 cell = floor(px / 24.);
  vec2 g = abs(fract(px / 24.) - .5) * 24.;
  float lineV = 1. - smoothstep(0., 1., g.x), lineH = 1. - smoothstep(0., 1., g.y);
  float hv = hash12(vec2(cell.x, 1.)), hh = hash12(vec2(2., cell.y));
  float y01 = px.y / uRes.y;
  float inV = step(y01, uP * 2.6 - hv * .9) * step(uP * 2.6 - 1.4 - hv * .2, y01);
  float inH = step(x01, uP * 2.6 - hh * .9) * step(uP * 2.6 - 1.4 - hh * .2, x01);
  float grid = max(lineV * inV, lineH * inH) * .055;
  // inside the lens the grid is alive: it slides, and its dashes run
  vec2 gp = px + vec2(uTime * 9., uTime * -6.);
  vec2 g2 = abs(fract(gp / 24.) - .5) * 24.;
  float dash = step(.45, fract((gp.x + gp.y) / 9. - uTime * .6));
  float gridL = (1. - smoothstep(0., 1.2, min(g2.x, g2.y))) * (.16 + .14 * dash);
  vec2 g3 = abs(fract(gp / 6.) - .5) * 6.;
  float fine = (1. - smoothstep(0., .7, min(g3.x, g3.y))) * .05;
  grid = mix(grid, gridL + fine, lens);
  col += brass * grid; a += grid;

  // construction marks: traced in behind a bright pen head, erased as the type sets
  vec4 m = texture2D(uMarks, vUv);
  float drawn = smoothstep(order - .02, order, uP * 2.2);
  float erased = smoothstep(order + .02, order, (uP - .5) * 2.1);
  float head = exp(-pow((order - uP * 2.2) * 40., 2.));
  float mk = m.a * drawn * erased;
  // in the lens the marks come back with a scan running through them
  float scan = .55 + .45 * smoothstep(.2, .9, sin(x01 * 9. - uTime * 1.4) * .5 + .5);
  mk = max(mk, m.a * lens * scan);
  col += brass * mk * (1. + head * 1.5); a += mk;

  // outline: a hairline drawn before the letter is filled
  float reveal = smoothstep(0., .08, t);
  float ol = 1. - smoothstep(.35, 1.1, abs(d));
  float olFade = max(reveal * (1. - smoothstep(.7, 1., t)), lens);
  col += mix(brass, bone, .35) * ol * olFade * .9; a += ol * olFade * .9;
  // where the lens is closing the outline glows as the weight comes back
  col += brass * ol * rim * 1.2; a += ol * rim;

  // weight: the fill grows outward from the skeleton
  float inset = (1. - tl) * 9.;
  float fill = 1. - smoothstep(-inset - .6, -inset + .6, d);
  fill *= smoothstep(.04, .2, tl);
  col = mix(col, bone, fill); a = max(a, fill);

  a = clamp(a, 0., 1.);
  gl_FragColor = vec4(min(col, vec3(1.)) * (a > 0. ? 1. : 0.), a);
}
`;

export class Draft {
  constructor(S, el, text) {
    this.S = S;
    this.el = el;
    this.text = text.trim();
    this.p = 0;
    this.on = 0;
    this.hover = false;
    this.pm = null;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uSDF: { value: null },
        uMarks: { value: null },
        uRes: { value: new THREE.Vector2() },
        uMouse: { value: new THREE.Vector2(-999, -999) },
        uScale: { value: 2 },
        uP: { value: 0 },
        uTrail: { value: null },
        uTime: { value: 0 },
        uLines: { value: 3 },
        uLine: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      },
    });
    this.q = quad(this.mat);
    const tOpt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.trail = [new THREE.WebGLRenderTarget(4, 4, tOpt), new THREE.WebGLRenderTarget(4, 4, tOpt)];
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: TRAIL,
      depthTest: false,
      uniforms: {
        uPrev: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uMouse: { value: new THREE.Vector2(-999, -999) },
        uVel: { value: new THREE.Vector2() },
        uDt: { value: 0.016 },
        uOn: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.tq = quad(this.trailMat);
    el.addEventListener('pointerenter', () => (this.hover = true));
    el.addEventListener('pointerleave', () => (this.hover = false));
    this.resize();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const W = Math.round(r.width),
      H = Math.round(r.height);
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    const k = 2; // texels per css px
    const size = Math.round(W * 0.052);
    const padX = 44;
    const c = document.createElement('canvas');
    c.width = W * k;
    c.height = H * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    g.font = `${size}px ${DISPLAY}`;
    g.letterSpacing = `${-size * 0.02}px`;
    const lines = wrap(g, this.text, W - padX * 2 - W * 0.1).slice(0, 4);
    const lh = size * 1.12;
    const top = (H - lines.length * lh) / 2 + size * 0.1;
    g.fillStyle = '#000';
    const info = [];
    lines.forEach((ln, i) => {
      const base = top + size * 0.8 + i * lh;
      g.fillText(ln, padX, base);
      const m = g.measureText(ln);
      const xm = g.measureText('x');
      const Hm = g.measureText('H');
      info.push({ ln, base, xh: base - xm.actualBoundingBoxAscent, cap: base - Hm.actualBoundingBoxAscent, right: padX + m.width });
    });
    this.hidden = true;
    sdfTexture(c).then((t) => {
      this.sdf?.dispose();
      this.sdf = t;
      this.mat.uniforms.uSDF.value = t;
      this.hidden = false;
    });
    this.mat.uniforms.uScale.value = k;
    this.mat.uniforms.uLines.value = lines.length;
    info.forEach((o, i) => this.mat.uniforms.uLine.value[i].set(o.base, o.xh, o.cap, o.right));

    // construction drawing
    const mc = document.createElement('canvas');
    mc.width = W * k;
    mc.height = H * k;
    const m = mc.getContext('2d');
    m.scale(k, k);
    m.strokeStyle = '#fff';
    m.fillStyle = '#fff';
    m.lineWidth = 0.75;
    m.font = `${size}px ${DISPLAY}`;
    m.letterSpacing = `${-size * 0.02}px`;
    const label = (s, x, y, align = 'left') => {
      m.save();
      m.font = `500 10px ${SANS}`;
      m.letterSpacing = '0.8px';
      m.textAlign = align;
      m.fillText(s, x, y);
      m.restore();
    };
    info.forEach((o, i) => {
      // guides: base, x-height, cap, dashed past the text
      [o.base, o.xh, o.cap].forEach((y, j) => {
        m.globalAlpha = j === 0 ? 0.55 : 0.32;
        m.setLineDash(j === 0 ? [] : [3, 4]);
        m.beginPath();
        m.moveTo(padX - 24, y + 0.5);
        m.lineTo(W - padX - 44, y + 0.5);
        m.moveTo(padX - 24, y + 0.5);
        m.stroke();
      });
      m.setLineDash([]);
      m.globalAlpha = 0.6;
      // vertical ticks at word starts
      let x = padX;
      o.ln.split(' ').forEach((w) => {
        m.beginPath();
        m.moveTo(x + 0.5, o.cap - 10);
        m.lineTo(x + 0.5, o.base + 10);
        m.stroke();
        // compass arcs on round bowls
        [...w].forEach((ch, ci) => {
          if (!'oOcCeaáéód'.includes(ch)) return;
          const cx = x + m.measureText(w.slice(0, ci)).width + m.measureText(ch).width / 2;
          const cy = (o.base + o.xh) / 2;
          const rr = (o.base - o.xh) * 0.62;
          m.globalAlpha = 0.38;
          m.beginPath();
          m.arc(cx, cy, rr, 0, Math.PI * 2);
          m.stroke();
          m.beginPath();
          m.moveTo(cx - 3, cy);
          m.lineTo(cx + 3, cy);
          m.moveTo(cx, cy - 3);
          m.lineTo(cx, cy + 3);
          m.stroke();
          m.globalAlpha = 0.6;
        });
        x += m.measureText(w + ' ').width;
      });
      // a dimension line over the line, with its measure
      const yy = o.cap - 22;
      m.globalAlpha = 0.5;
      m.beginPath();
      m.moveTo(padX, yy);
      m.lineTo(o.right, yy);
      m.moveTo(padX, yy - 5);
      m.lineTo(padX, yy + 5);
      m.moveTo(o.right, yy - 5);
      m.lineTo(o.right, yy + 5);
      m.stroke();
      const arrow = (x0, dir) => {
        m.beginPath();
        m.moveTo(x0, yy);
        m.lineTo(x0 + 7 * dir, yy - 2.5);
        m.lineTo(x0 + 7 * dir, yy + 2.5);
        m.closePath();
        m.fill();
      };
      arrow(padX, 1);
      arrow(o.right, -1);
      m.globalAlpha = 0.75;
      const mm = ((o.right - padX) * 0.2646).toFixed(1).replace('.', ',');
      m.clearRect((padX + o.right) / 2 - 30, yy - 7, 60, 14);
      label(`${mm} mm`, (padX + o.right) / 2, yy + 3.5, 'center');
      if (i === 0) {
        label('CAP', W - padX - 34, o.cap + 3.5);
        label('X', W - padX - 34, o.xh + 3.5);
        label('BASE', W - padX - 34, o.base + 3.5);
      }
    });
    this.marks?.dispose();
    this.marks = canvasTex(mc, { srgb: false });
    this.mat.uniforms.uMarks.value = this.marks;
    this.mat.uniforms.uRes.value.set(W, H);
    // the trail lives at a quarter of the resolution
    this.trail.forEach((t) => t.setSize(Math.ceil(W / 4), Math.ceil(H / 4)));
    this.trailMat.uniforms.uRes.value.set(Math.ceil(W / 4), Math.ceil(H / 4));
  }

  update(r, on) {
    if (!on) return;
    const S = this.S;
    // once the sentence is well in view the drawing plays through on its own clock,
    // in one continuous gesture, so scrolling and the lens never fight over it
    if (this.t0 == null && r.top < S.h * 0.62) this.t0 = S.time;
    this.p = this.t0 == null ? 0 : clamp((S.time - this.t0) / 4.2);
    const u = this.mat.uniforms;
    u.uP.value = this.p;
    u.uTime.value = S.time;
    const mx = S.mouse.x - r.left,
      my = S.mouse.y - r.top;
    u.uMouse.value.set(mx, my);
    const tu = this.trailMat.uniforms;
    // trail space: quarter resolution, y up
    const q = { x: mx / 4, y: (r.height - my) / 4 };
    const k = 1 / Math.max(S.dt, 1e-3);
    const vel = this.pm ? { x: (q.x - this.pm.x) * k, y: (q.y - this.pm.y) * k } : { x: 0, y: 0 };
    this.pm = q;
    tu.uMouse.value.set(q.x, q.y);
    tu.uVel.value.set(vel.x, vel.y);
    tu.uDt.value = S.dt;
    tu.uTime.value = S.time;
    this.on += ((this.hover && this.p >= 1 ? 1 : 0) - this.on) * (1 - Math.exp(-10 * S.dt));
    tu.uOn.value = this.on;
  }

  prerender(renderer) {
    const [a, b] = this.trail;
    this.trailMat.uniforms.uPrev.value = a.texture;
    renderer.setRenderTarget(b);
    this.tq.draw(renderer);
    this.trail = [b, a];
    this.mat.uniforms.uTrail.value = b.texture;
  }

  render(renderer) {
    this.q.draw(renderer);
  }
}
