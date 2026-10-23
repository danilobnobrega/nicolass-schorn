import * as THREE from 'three';
import { quad, clamp, damp, Spring, GLSL_COMMON, DISPLAY, SANS, wrap, canvasTex } from './core.js';
import { sdfTexture } from './sdf.js';

/*
 * About: the sentence is drafted before it is set. Guides and outlines are drawn first,
 * then every letter gains weight from its own skeleton until it is solid type.
 * Under the cursor the drawing shows through again.
 */
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSDF, uMarks;
uniform vec2 uRes, uMouse;
uniform float uScale, uP, uLens, uTime, uLines;
uniform vec4 uLine[4]; // per line: base y, x-height y, cap y, right edge x (all in px, top-left origin)
${GLSL_COMMON}

void main(){
  vec2 px = vec2(vUv.x, 1. - vUv.y) * uRes;
  float d = texture2D(uSDF, vUv).r / uScale;  // signed distance in css px
  float x01 = px.x / uRes.x;

  // which line are we on (nearest baseline)
  float li = 0.; float best = 1e9;
  for (int i = 0; i < 4; i++){
    if (float(i) >= uLines) break;
    float dy = abs(px.y - (uLine[i].x - 30.));
    if (dy < best){ best = dy; li = float(i); }
  }

  // progress per letter: left to right, line after line
  float order = x01 * .55 + li / max(uLines - 1., 1.) * .45;
  float t = clamp((uP - .1 - order * .5) / .4, 0., 1.);
  float tg = clamp((uP - order * .35) / .3, 0., 1.);  // guides lead the letters

  // the cursor lens brings the drawing back
  float lens = uLens * smoothstep(150., 60., length(px - uMouse));
  float tl = mix(t, min(t, .18), lens);

  vec3 bone = vec3(.925,.902,.855);
  vec3 brass = vec3(.706,.553,.333);
  vec3 col = vec3(0.); float a = 0.;

  // drafting grid, only while drawing
  vec2 g = abs(fract(px / 24.) - .5) * 24.;
  float grid = (1. - smoothstep(0., 1., min(g.x, g.y))) * .05 * (1. - smoothstep(.3, 1., tg)) * smoothstep(0., .2, tg);
  grid += (1. - smoothstep(0., 1., min(g.x, g.y))) * .07 * lens;
  col += brass * grid; a += grid;

  // construction marks (canvas): dimension lines, compass arcs, guides
  vec4 m = texture2D(uMarks, vUv);
  float mk = m.a * smoothstep(.0, .15, tg);
  float keep = mix(1. - smoothstep(.55, 1., t) * .85, 1., lens);
  col += brass * mk * keep; a += mk * keep;

  // outline: a hairline that is drawn before the letter is filled
  float reveal = smoothstep(0., .08, t);
  float ol = (1. - smoothstep(.35, 1.1, abs(d))) * reveal;
  float olFade = mix(1. - smoothstep(.7, 1., t), 1., lens);
  col += mix(brass, bone, .35) * ol * olFade * .9; a += ol * olFade * .9;

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
    this.lens = new Spring(0, 90, 16);
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
        uLens: { value: 0 },
        uTime: { value: 0 },
        uLines: { value: 3 },
        uLine: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      },
    });
    this.q = quad(this.mat);
    el.addEventListener('pointerenter', () => (this.lens.t = 1));
    el.addEventListener('pointerleave', () => (this.lens.t = 0));
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
  }

  update(r, on) {
    if (!on) return;
    const S = this.S;
    // drafting starts as the block enters and is done a bit above the middle
    const target = clamp((S.h * 0.9 - r.top) / (S.h * 0.85));
    this.p = damp(this.p, target, 4, S.dt);
    const u = this.mat.uniforms;
    u.uP.value = this.p;
    u.uLens.value = clamp(this.lens.step(S.dt), 0, 1.2);
    u.uMouse.value.set(S.mouse.x - r.left, S.mouse.y - r.top);
    u.uTime.value = S.time;
  }

  render(renderer) {
    this.q.draw(renderer);
  }
}
