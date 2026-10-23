import * as THREE from 'three';
import { quad, clamp, Spring, GLSL_COMMON, DISPLAY } from './core.js';
import { sdfTexture } from './sdf.js';

/*
 * Services: the titles are real DOM type, drawn here from their exact distance fields.
 * The row you are reading rises out of the page as cast relief: a rounded height field,
 * lit by the cursor, casting soft shadows marched across the field.
 */
const N = 5;
// one draw per title, all-scalar uniforms. (An earlier version indexed uniform arrays
// dynamically in a single full-list pass; on iPhones that took the GPU down.)
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSDF;
uniform vec2 uSize, uOff, uBox, uLight;
uniform float uK, uSlot, uSlotH, uN, uTexW, uZ, uRel, uAct;
${GLSL_COMMON}

float sdf(vec2 px){
  vec2 l = px - uOff;
  vec2 q = clamp(l, vec2(0.), uBox);
  vec2 uv = vec2(q.x / uTexW, 1. - (uSlot * uSlotH + q.y * uK) / (uSlotH * uN));
  return texture2D(uSDF, uv).r / uK + length(l - q);
}
float height(vec2 px){
  float s = clamp(-sdf(px) / (9. * uZ), 0., 1.);
  return uRel * 16. * uZ * sqrt(s * (2. - s));
}

void main(){
  vec2 px = vec2(vUv.x, 1. - vUv.y) * uSize;
  float d = sdf(px);
  vec3 Lp = vec3(uLight, 520.);
  float h = height(px);
  vec2 e = vec2(1., 0.);
  vec3 Nn = normalize(vec3(-(height(px + e.xy) - height(px - e.xy)) * .5, -(height(px + e.yx) - height(px - e.yx)) * .5, 1.));
  vec3 L = normalize(Lp - vec3(px, h));

  // soft shadow toward the light across the height field (fixed step count)
  vec2 dir = normalize(Lp.xy - px + vec2(1e-3));
  float slope = (Lp.z - h) / max(length(Lp.xy - px), 1.);
  float sh = 1.;
  float st = 2. * uZ;
  for (int k = 0; k < STEPS; k++){
    float hr = h + st * slope;
    sh = min(sh, smoothstep(-(1.5 * uZ + st * .18), 0., hr - height(px + dir * st)));
    st += (70. * uZ) / float(STEPS);
  }
  sh = mix(1., sh, uRel);

  vec3 bone = toLin(vec3(.925,.902,.855));
  vec3 mute = toLin(vec3(.36,.345,.32));
  float ink = 1. - smoothstep(-.6, .6, d);
  vec3 alb = mix(mute, bone, uAct);
  float diff = max(dot(Nn, L), 0.);
  vec3 H = normalize(L + vec3(0,0,1));
  float spec = pow(max(dot(Nn, H), 0.), 60.) * .25 * uRel;
  vec3 lit = alb * mix(1., (.42 + .75 * diff) * mix(.55, 1., sh), uRel) + spec;
  float a = max(ink, (1. - sh) * (1. - ink) * .75);
  vec3 col = toSRGB(lit * ink);
  gl_FragColor = vec4(col * a, a);
}
`;

const MARGIN = 48; // room around each title for its shadow

export class Relief {
  constructor(S, el, titles) {
    this.S = S;
    this.el = el;
    this.titles = titles;
    this.rows = titles.map((t) => t.closest('[data-row]'));
    this.rel = titles.map(() => new Spring(0, 70, 13));
    this.act = titles.map(() => new Spring(0, 60, 14));
    this.hover = -1;
    this.rows.forEach((row, i) => {
      row.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && (this.hover = i));
      row.addEventListener('pointerleave', () => this.hover === i && (this.hover = -1));
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: '#define STEPS ' + (S.touch ? 8 : 18) + String.fromCharCode(10) + FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uSDF: { value: null },
        uSize: { value: new THREE.Vector2() },
        uOff: { value: new THREE.Vector2() },
        uBox: { value: new THREE.Vector2() },
        uLight: { value: new THREE.Vector2() },
        uK: { value: 1.5 },
        uSlot: { value: 0 },
        uSlotH: { value: 1 },
        uN: { value: N },
        uTexW: { value: 1 },
        uZ: { value: 1 },
        uRel: { value: 0 },
        uAct: { value: 0 },
      },
    });
    this.q = quad(this.mat);
    this.resize();
  }

  resize() {
    const lr = this.el.getBoundingClientRect();
    const t0 = this.titles[0].getBoundingClientRect();
    const W = Math.round(lr.width);
    // room above and below the line box: accents and descenders overflow it
    this.pad = Math.ceil(parseFloat(getComputedStyle(this.titles[0]).fontSize) * 0.32);
    const Hs = Math.ceil(t0.height) + this.pad * 2;
    if (W === this.W && Hs === this.Hs) return;
    this.W = W;
    this.Hs = Hs;
    const k = Math.min(3, Math.max(1.5, 150 / parseFloat(getComputedStyle(this.titles[0]).fontSize)));
    const slot = Math.ceil(Hs * k);
    const c = document.createElement('canvas');
    c.width = Math.ceil(W * k);
    c.height = slot * N;
    const g = c.getContext('2d');
    const cs = getComputedStyle(this.titles[0]);
    const size = parseFloat(cs.fontSize);
    g.font = `${size * k}px ${DISPLAY}`;
    g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : `${parseFloat(cs.letterSpacing) * k}px`;
    g.fillStyle = '#000';
    this.titles.forEach((t, i) => {
      const m = g.measureText(t.textContent);
      const asc = m.fontBoundingBoxAscent,
        desc = m.fontBoundingBoxDescent;
      const base = (slot - (asc + desc)) / 2 + asc;
      g.fillText(t.textContent, 0, i * slot + base);
    });
    const u = this.mat.uniforms;
    this.hidden = true;
    sdfTexture(c).then((t) => {
      this.sdf?.dispose();
      this.sdf = t;
      u.uSDF.value = t;
      this.hidden = false;
    });
    u.uK.value = k;
    u.uTexW.value = W;
    // relief depth follows the type size (tuned at ~104px)
    u.uZ.value = Math.max(0.35, size / 104);
    u.uSlotH.value = slot;
  }

  update(r, on) {
    if (!on) return;
    const S = this.S;
    this.view = r;
    // the reading row: nearest the middle of the screen, unless one is hovered
    let near = -1,
      best = 1e9;
    this.boxes = this.titles.map((t, i) => {
      const tr = t.getBoundingClientRect();
      const dd = Math.abs(tr.top + tr.height / 2 - S.h * 0.5);
      if (dd < best && dd < S.h * 0.3) {
        best = dd;
        near = i;
      }
      return tr;
    });
    const focus = this.hover >= 0 ? this.hover : near;
    this.titles.forEach((t, i) => {
      this.rel[i].t = i === focus ? 1 : 0;
      this.act[i].t = i === focus || focus < 0 ? 1 : 0.0;
      this.rel[i].v = clamp(this.rel[i].step(S.dt), 0, 1.15);
      this.act[i].v = clamp(this.act[i].step(S.dt));
    });
  }

  render(renderer) {
    const S = this.S,
      u = this.mat.uniforms;
    this.boxes?.forEach((tr, i) => {
      const x = tr.left - MARGIN,
        y = tr.top - this.pad - MARGIN;
      const w = tr.width + MARGIN * 2,
        h = tr.height + this.pad * 2 + MARGIN * 2;
      if (y > S.h || y + h < 0) return;
      renderer.setViewport(x, S.h - (y + h), w, h);
      u.uSize.value.set(w, h);
      u.uOff.value.set(MARGIN, MARGIN);
      u.uBox.value.set(tr.width, tr.height + this.pad * 2);
      u.uLight.value.set(S.light.x - x, S.light.y - y);
      u.uSlot.value = i;
      u.uRel.value = this.rel[i].v;
      u.uAct.value = this.act[i].v;
      this.q.draw(renderer);
    });
  }
}
