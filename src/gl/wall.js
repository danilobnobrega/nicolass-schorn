import * as THREE from 'three';
import { quad, clamp, damp, GLSL_COMMON, DISPLAY, seamUniform, setSeam } from './core.js';
import { sdfTexture } from './sdf.js';

/*
 * Long-term relationships: one sentence painted on a lime-plaster wall, and a whole day
 * passing over it. Sunlight comes through a window on the side wall (traced per pixel,
 * with mullions, a soft penumbra and the leaves of a tree outside). Dawn rises out of the
 * dark of the previous section; dusk hands over to the dark of the next.
 */
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSDF;
uniform vec2 uRes, uTextSize;
uniform float uDay, uTime, uTexel, uFade;
${GLSL_COMMON}

const float WX = -3.4;               // side wall with the window
const vec4 WIN = vec4(.45, 2.05, -.2, 1.9); // window opening: z0, z1, y0, y1

float sdText(vec2 p){
  vec2 uv = p / uTextSize + .5;
  vec2 q = clamp(uv, 0., 1.);
  return texture2D(uSDF, q).r * uTexel + length((uv - q) * uTextSize);
}

// how much sun passes the window at a point of the window plane (y, z)
float windowAt(vec2 yz, float blur){
  float w = blur + .004;
  float open = smoothstep(WIN.x - w, WIN.x + w, yz.y) * smoothstep(WIN.y + w, WIN.y - w, yz.y)
             * smoothstep(WIN.z - w, WIN.z + w, yz.x) * smoothstep(WIN.w + w, WIN.w - w, yz.x);
  // mullions: one vertical, two horizontal bars
  float zc = (WIN.x + WIN.y) * .5;
  float bar = smoothstep(.028 + w, .028 - w, abs(yz.y - zc));
  float y1 = mix(WIN.z, WIN.w, .38), y2 = mix(WIN.z, WIN.w, .72);
  bar = max(bar, smoothstep(.022 + w, .022 - w, abs(yz.x - y1)));
  bar = max(bar, smoothstep(.022 + w, .022 - w, abs(yz.x - y2)));
  float t = open * (1. - bar);
  // a tree outside: leaves sway, further away so they blur more
  vec2 lp = yz * vec2(2.3, 2.3) + vec2(sin(uTime * .6) * .05 + sin(uTime * 1.7) * .015, cos(uTime * .5) * .03);
  float leaf = smoothstep(.46, .62, fbm(lp + 3.1) * (.55 + .7 * smoothstep(.2, 1.2, yz.x)) + fbm(lp * 3.1) * .25);
  t *= 1. - leaf * .82 * smoothstep(1.2, 2.1, yz.y + yz.x * .4);
  return t;
}

void main(){
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - .5) * vec2(aspect, 1.) * 3.;   // metres on the wall

  // the day: azimuth sweeps, the sun rises and sets
  float d = uDay;
  float elev = sin(clamp(d, 0., 1.) * 3.14159) * .3 + .03;
  float az = mix(.12, 1.05, d);
  vec3 S = normalize(vec3(-cos(az) * cos(elev), sin(elev) * .85, sin(az) * cos(elev)));
  float up = smoothstep(.0, .12, d) * smoothstep(1., .86, d);   // sun above the horizon

  vec3 sunCol = mix(vec3(1., .45, .18), vec3(1., .78, .52), smoothstep(.0, .25, d));
  sunCol = mix(sunCol, vec3(1., .96, .9), smoothstep(.25, .5, d) * smoothstep(.75, .5, d));
  sunCol = mix(sunCol, vec3(1., .5, .2), smoothstep(.65, .9, d));
  float sunI = up * (1.3 + 1.6 * sin(clamp(d, 0., 1.) * 3.14159));
  vec3 sky = mix(vec3(.05,.06,.09), vec3(.32,.33,.34), smoothstep(.05, .35, d) * smoothstep(1., .7, d));
  sky *= smoothstep(-.02, .1, d) * smoothstep(1.06, .9, d);

  // lime plaster: soft trowel marks, fine sand, slight colour drift
  float big = fbm(p * 1.3 + 9.);
  float trowel = fbm(vec2(p.x * 2.2 + p.y * .9, p.y * 5.5 - p.x * .6) * 1.6);
  float sand = vnoise(p * 380.) * .5 + vnoise(p * 140.) * .5;
  vec2 e = vec2(.004, 0.);
  float hC = trowel * .9 + sand * .12;
  float hx = fbm(vec2((p.x+e.x) * 2.2 + p.y * .9, p.y * 5.5 - (p.x+e.x) * .6) * 1.6) * .9 + vnoise((p + e.xy) * 380.) * .06 + vnoise((p + e.xy) * 140.) * .06;
  float hy = fbm(vec2(p.x * 2.2 + (p.y+e.x) * .9, (p.y+e.x) * 5.5 - p.x * .6) * 1.6) * .9 + vnoise((p + e.yx) * 380.) * .06 + vnoise((p + e.yx) * 140.) * .06;
  vec3 N = normalize(vec3(-(hx - hC) / e.x * .012, -(hy - hC) / e.x * .012, 1.));
  vec3 alb = vec3(.80,.76,.69) * (.9 + .14 * big) * (.96 + .05 * sand);

  // paint: the sentence, matte graphite with a breath of sheen
  float sd = sdText(p - vec2(0., .05));
  float paint = 1. - smoothstep(-.0015, .0015, sd);
  alb = mix(alb, vec3(.045,.042,.04), paint);
  N = normalize(mix(N, vec3(0,0,1), paint * .8));

  // trace the sun back to the window
  vec3 P = vec3(p, 0.);
  float tw = (WX - P.x) / S.x;
  vec3 W = P + S * tw;
  float sun = windowAt(W.yz, tw * .012) * up;
  float ndl = max(dot(N, S), 0.);
  vec3 col = alb * (sunCol * sunI * sun * ndl + sky * (.55 + .45 * N.z));
  // light bounced from the floor and the lit patch
  col += alb * sunCol * sunI * .035 * up;
  float sheen = pow(max(dot(reflect(-S, N), vec3(0,0,1)), 0.), 30.) * paint * sun * .25;
  col += sunCol * sheen * sunI;

  col *= uFade;
  vec2 q = vUv * 2. - 1.;
  col *= 1. - .35 * pow(length(q * vec2(.8, 1.)), 2.6);
  col = seam(toSRGB(aces(col * 1.1)));
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.) - .5) * .022;
  gl_FragColor = vec4(col, 1.);
}
`;

export class Wall {
  constructor(S, el, section) {
    this.S = S;
    this.el = el;
    this.section = section;
    this.day = 0;
    const size = 260;
    const lines = ['Acredito em relações', 'de longo prazo.'];
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `${size}px ${DISPLAY}`;
    probe.letterSpacing = '-6px';
    const w = Math.ceil(Math.max(...lines.map((l) => probe.measureText(l).width))) + 120;
    const lh = size * 1.05;
    const h = Math.ceil(lh * lines.length + 120);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.font = `${size}px ${DISPLAY}`;
    g.letterSpacing = '-6px';
    g.textAlign = 'center';
    g.fillStyle = '#000';
    lines.forEach((l, i) => g.fillText(l, w / 2, 60 + size * 0.82 + i * lh));
    this.aspect = w / h;
    this.texW = w;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: {
        uSDF: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTextSize: { value: new THREE.Vector2(1, 1) },
        uDay: { value: 0 },
        uTime: { value: 0 },
        uTexel: { value: 1 },
        uFade: { value: 1 },
        uSeam: seamUniform(),
      },
    });
    this.q = quad(this.mat);
    this.hidden = true;
    sdfTexture(c).then((t) => {
      this.mat.uniforms.uSDF.value = t;
      this.hidden = false;
    });
    this.resize();
  }

  resize() {
    const S = this.S;
    const u = this.mat.uniforms;
    u.uRes.value.set(S.w, S.h);
    const tw = Math.min((S.w / S.h) * 3 * 0.78, 3.9);
    u.uTextSize.value.set(tw, tw / this.aspect);
    u.uTexel.value = tw / this.texW;
  }

  update(r, on) {
    if (!on) return;
    const S = this.S;
    const sr = this.section.getBoundingClientRect();
    // from first light as it slides in, to dusk as it leaves
    const target = clamp((S.h - sr.top) / (sr.height + S.h * 0.2)) * 1.08 - 0.02;
    this.day = damp(this.day, target, 3.5, S.dt);
    const u = this.mat.uniforms;
    u.uDay.value = this.day;
    u.uTime.value = S.time;
    setSeam(u.uSeam, r, S);
  }

  render(renderer) {
    this.q.draw(renderer);
  }
}
