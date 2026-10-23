import * as THREE from 'three';
import { quad, clamp, Spring, GLSL_COMMON, DISPLAY } from './core.js';
import { sdfTexture } from './sdf.js';

/*
 * Services: the titles are real DOM type, drawn here from their exact distance fields.
 * The row you are reading rises out of the page as cast relief: a rounded height field,
 * lit by the cursor, casting soft shadows marched across the field.
 */
const N = 5;
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSDF;
uniform vec2 uRes, uLight;
uniform float uK, uSlotH, uTime, uZ;
uniform vec4 uRows[${N}];    // x, y, w, h of each title in px (view space, y down)
uniform float uRelief[${N}], uActive[${N}];
${GLSL_COMMON}

float sdfRow(vec2 px, int i){
  vec4 r = uRows[i];
  vec2 l = px - r.xy;
  vec2 q = clamp(l, vec2(0.), r.zw);
  vec2 uv = vec2(q.x / uRes.x, 1. - (float(i) * uSlotH + q.y * uK) / (uSlotH * ${N}.));
  return texture2D(uSDF, uv).r / uK + length(l - q);
}
float sdfAt(vec2 px, out int row){
  // the row whose band is nearest: padded bands overlap, so never take the first hit
  row = -1;
  float best = 1e9;
  for (int i = 0; i < ${N}; i++){
    vec4 r = uRows[i];
    float dy = abs(px.y - (r.y + r.w * .5));
    if (px.x > r.x - 60. && px.x < r.x + r.z + 60. && dy < r.w * .5 + 60. && dy < best){ best = dy; row = i; }
  }
  return row < 0 ? 1e4 : sdfRow(px, row);
}
float heightRow(vec2 px, int i){
  float s = clamp(-sdfRow(px, i) / (9. * uZ), 0., 1.);
  return uRelief[i] * 16. * uZ * sqrt(s * (2. - s));
}

void main(){
  vec2 px = vec2(vUv.x, 1. - vUv.y) * uRes;
  int row;
  float d = sdfAt(px, row);
  float act = 0., rel = 0.;
  for (int i = 0; i < ${N}; i++) if (i == row){ act = uActive[i]; rel = uRelief[i]; }

  vec3 Lp = vec3(uLight, 520.);
  int R = row < 0 ? 0 : row;
  float h = row < 0 ? 0. : heightRow(px, R);
  vec2 e = vec2(1., 0.);
  vec3 Nn = vec3(0., 0., 1.);
  if (rel > .001) Nn = normalize(vec3(-(heightRow(px + e.xy, R) - heightRow(px - e.xy, R)) * .5, -(heightRow(px + e.yx, R) - heightRow(px - e.yx, R)) * .5, 1.));
  vec3 L = normalize(Lp - vec3(px, h));

  // soft shadow marched toward the light across the height field
  float sh = 1.;
  if (rel > .01){
    vec2 dir = normalize(Lp.xy - px);
    float dist2 = length(Lp.xy - px);
    float slope = (Lp.z - h) / max(dist2, 1.);
    float s = 2. * uZ;
    for (int k = 0; k < 22; k++){
      float hr = h + s * slope;
      float hs = heightRow(px + dir * s, R);
      sh = min(sh, smoothstep(-(1.5 * uZ + s * .18), 0., hr - hs));
      s += 2. * uZ + s * .12;
      if (s > 70. * uZ) break;
    }
    sh = mix(1., sh, rel);
  }

  vec3 bone = toLin(vec3(.925,.902,.855));
  vec3 mute = toLin(vec3(.36,.345,.32));
  float ink = 1. - smoothstep(-.6, .6, d);
  vec3 alb = mix(mute, bone, act);
  float diff = max(dot(Nn, L), 0.);
  vec3 H = normalize(L + vec3(0,0,1));
  float spec = pow(max(dot(Nn, H), 0.), 60.) * .25 * rel;
  // flat type stays exactly its colour; relief brings out the shading
  vec3 lit = alb * mix(1., (.42 + .75 * diff) * mix(.55, 1., sh), rel) + spec;
  float a = ink;
  vec3 col = lit * ink;

  // the ground: only the shadow and a faint lift where the light falls
  float pool = exp(-dot(px - uLight, px - uLight) / (2. * 260. * 260.));
  float shadow = (1. - sh) * (1. - ink);
  col += vec3(0.);
  a = max(a, shadow * .75);

  vec3 outc = toSRGB(col);
  gl_FragColor = vec4(outc * (ink > 0. ? 1. : 0.) * a, a);
}
`;

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
      row.addEventListener('pointerenter', () => (this.hover = i));
      row.addEventListener('pointerleave', () => this.hover === i && (this.hover = -1));
    });
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
        uRes: { value: new THREE.Vector2() },
        uLight: { value: new THREE.Vector2() },
        uK: { value: 1.5 },
        uSlotH: { value: 1 },
        uTime: { value: 0 },
        uZ: { value: 1 },
        uRows: { value: titles.map(() => new THREE.Vector4()) },
        uRelief: { value: titles.map(() => 0) },
        uActive: { value: titles.map(() => 0) },
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
    // relief depth follows the type size (tuned at ~104px)
    u.uZ.value = Math.max(0.35, size / 104);
    u.uSlotH.value = slot;
  }

  update(r, on) {
    if (!on) return;
    const S = this.S;
    const u = this.mat.uniforms;
    u.uRes.value.set(r.width, r.height);
    u.uLight.value.set(S.light.x - r.left, S.light.y - r.top);
    u.uTime.value = S.time;
    // the reading row: nearest the middle of the screen, unless one is hovered
    let near = -1,
      best = 1e9;
    this.titles.forEach((t, i) => {
      const tr = t.getBoundingClientRect();
      u.uRows.value[i].set(tr.left - r.left, tr.top - r.top - this.pad, tr.width, tr.height + this.pad * 2);
      const dd = Math.abs(tr.top + tr.height / 2 - S.h * 0.5);
      if (dd < best && dd < S.h * 0.3) {
        best = dd;
        near = i;
      }
    });
    const focus = this.hover >= 0 ? this.hover : near;
    this.titles.forEach((t, i) => {
      this.rel[i].t = i === focus ? 1 : 0;
      this.act[i].t = i === focus || focus < 0 ? 1 : 0.0;
      u.uRelief.value[i] = clamp(this.rel[i].step(S.dt), 0, 1.15);
      u.uActive.value[i] = clamp(this.act[i].step(S.dt));
    });
  }

  render(renderer) {
    this.q.draw(renderer);
  }
}
