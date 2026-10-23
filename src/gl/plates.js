import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { quad, clamp, damp, ease, smooth, GLSL_COMMON, DISPLAY, SANS, seamUniform, setSeam } from './core.js';
import { sdfTexture } from './sdf.js';

/*
 * Recognitions: four brushed brass plates on a dark wall, engraved and filled with black
 * enamel. The camera walks past them; the cursor holds the only light, so the brushing
 * flares and the engraving catches as it moves. Plates stand off the wall and cast
 * soft shadows onto it.
 */
const PLATES = [
  { top: 'MAIS DE', big: 'R$ 100 mi', small: 'EM CUSTÓDIA ADQUIRIDA' },
  { big: 'Top 15', small: 'RANKING XP · 2026' },
  { big: 'Top 77', small: 'RANKING XP · 2025' },
  { big: '1º NPS', small: 'MELHOR NPS DO GRUPO ÁVEL · 2025' },
];
const PW = 2.3,
  PH = 1.44,
  GAP = 3.4,
  STAND = 0.09;

const METAL = /* glsl */ `
uniform vec3 uLight, uCam;
uniform float uLightI;
vec3 brass(vec3 P, vec3 N, vec3 T, float streak, float enamel){
  vec3 V = normalize(uCam - P);
  vec3 Lv = uLight - P;
  float dist = length(Lv);
  vec3 L = Lv / dist;
  vec3 B = normalize(cross(N, T));
  T = normalize(cross(B, N));
  vec3 H = normalize(L + V);
  float NL = max(dot(N, L), 0.), NV = max(dot(N, V), 1e-3), NH = max(dot(N, H), 1e-3);
  float ax = mix(.055, .9, enamel), ay = mix(.34, .9, enamel);
  float ht = dot(H, T) / ax, hb = dot(H, B) / ay;
  float ward = exp(-(ht*ht + hb*hb) / (NH*NH)) / (12.566 * ax * ay * sqrt(max(NL * NV, 1e-4)));
  vec3 F0 = mix(vec3(.88,.70,.40) * (.92 + .16 * streak), vec3(.04), enamel);
  vec3 F = F0 + (1. - F0) * pow(1. - max(dot(V, H), 0.), 5.);
  float atten = uLightI / (1. + dist * dist * .08);
  vec3 spec = F * ward * NL * atten;
  // the room, smeared along the brushing
  vec3 R = reflect(-V, N);
  vec3 env = vec3(0.);
  for (int k = 0; k < 6; k++){
    float o = (float(k) - 2.5) / 2.5;
    env += studio(normalize(R + B * o * ay * 1.1 + T * o * ax * .3));
  }
  env /= 6.;
  vec3 Fe = F0 + (1. - F0) * pow(1. - NV, 5.) * .5;
  vec3 diff = mix(vec3(0.), vec3(.012,.011,.01), enamel) * NL * atten;
  // a broad fill so the brass reads golden away from the highlight
  vec3 fill = F0 * (.05 + .05 * smoothstep(-.3, .8, R.y));
  return spec * .8 + env * Fe * mix(.32, .2, enamel) + diff + fill * (1. - enamel * .92);
}
`;

const PLATE_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vP; varying vec3 vN;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vP = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w; }
`;
const PLATE_FS = /* glsl */ `
precision highp float;
varying vec2 vUv; varying vec3 vP; varying vec3 vN;
uniform sampler2D uSDF;
uniform vec2 uTexRes;
uniform float uTexel, uFace;
${GLSL_COMMON}
${METAL}
void main(){
  vec3 N = normalize(vN);
  float streak = hash12(vec2(floor(vUv.y * 1400.), 3.)) * .6 + vnoise(vec2(vUv.x * 6., vUv.y * 900.)) * .4;
  float enamel = 0.;
  if (uFace > .5){
    // engraved: a v-groove 1.4 texels wide, its floor filled with black enamel
    vec2 e = vec2(1.5 / uTexRes.x, 0.);
    vec2 f = vec2(0., 1.5 / uTexRes.y);
    float d = texture2D(uSDF, vUv).r;
    float w = 2.2;
    float hd = smoothstep(0., w, -d);
    float gx = texture2D(uSDF, vUv + e).r - texture2D(uSDF, vUv - e).r;
    float gy = texture2D(uSDF, vUv + f).r - texture2D(uSDF, vUv - f).r;
    vec2 g = vec2(gx, gy) / 3.;
    float wall = (1. - smoothstep(w - .8, w, -d)) * smoothstep(.8, -.2, d);
    // groove walls tilt toward the outside of the stroke
    N = normalize(N + vec3(g * wall * 1.6, 0.));
    enamel = smoothstep(.4, 1.6, -d);
    streak *= 1. - hd * .5;
  }
  vec3 c = brass(vP, N, vec3(1., 0., 0.), streak, enamel);
  gl_FragColor = vec4(c, 1.);
}
`;

const WALL_FS = /* glsl */ `
precision highp float;
varying vec2 vUv; varying vec3 vP; varying vec3 vN;
uniform vec3 uLight;
uniform float uLightI;
uniform vec4 uRects[4];
${GLSL_COMMON}
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
void main(){
  vec2 p = vP.xy;
  float h = fbm(p * 5.) * .6 + fbm(p * 40.) * .4;
  vec2 g = vec2(fbm((p + vec2(.006,0.)) * 40.) - fbm((p - vec2(.006,0.)) * 40.), fbm((p + vec2(0.,.006)) * 40.) - fbm((p - vec2(0.,.006)) * 40.));
  vec3 N = normalize(vec3(-g * .5, 1.));
  vec3 Lv = uLight - vP;
  float dist = length(Lv);
  vec3 L = Lv / dist;
  float atten = uLightI / (1. + dist * dist * .08);
  float diff = max(dot(N, L), 0.) * atten;
  // plate shadows: each plate projected from the light onto the wall
  float sh = 1.;
  for (int i = 0; i < 4; i++){
    vec4 r = uRects[i];
    float k = ${STAND.toFixed(3)} / max(uLight.z - ${STAND.toFixed(3)}, .1);
    vec2 c = r.xy + (r.xy - uLight.xy) * k;
    float d = sdBox(p - c, r.zw * (1. + k), .04);
    float soft = .02 + ${STAND.toFixed(3)} * 1.6 + length(r.xy - uLight.xy) * .03;
    sh *= mix(.12, 1., smoothstep(-soft, soft, d));
    // contact occlusion right around the plate
    sh *= mix(.75, 1., smoothstep(0., .12, sdBox(p - r.xy, r.zw, .04)));
  }
  vec3 alb = vec3(.03,.028,.025) * (.9 + .16 * h);
  vec3 c = alb * (diff * sh + .05);
  gl_FragColor = vec4(c, 1.);
}
`;

const POST = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uTime, uFade;
${GLSL_COMMON}
void main(){
  vec3 c = texture2D(uTex, vUv).rgb;
  vec2 q = vUv * 2. - 1.;
  c *= 1. - .35 * pow(length(q * vec2(.8, 1.)), 2.6);
  c = seam(toSRGB(aces(c * 1.2)) * uFade);
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 91.) - .5) * .022;
  gl_FragColor = vec4(c, 1.);
}
`;

function plateCanvas({ top, big, small }) {
  const W = 1024,
    H = Math.round((1024 * PH) / PW);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  // inset rule
  g.lineWidth = 7;
  g.strokeRect(42, 42, W - 84, H - 84);
  g.lineWidth = 3;
  g.strokeRect(60, 60, W - 120, H - 120);
  let size = 230;
  g.font = `${size}px ${DISPLAY}`;
  g.letterSpacing = '-4px';
  while (g.measureText(big).width > W - 220) {
    size -= 6;
    g.font = `${size}px ${DISPLAY}`;
  }
  g.textAlign = 'center';
  g.fillText(big, W / 2, H * (top ? 0.575 : 0.56));
  // labels: brass letters left standing in a black enamel band, readable in any reflection
  const band = (text, y) => {
    // shrink long labels so the band always sits clear of the inset rule
    let fs = 36;
    g.font = `700 ${fs}px ${SANS}`;
    g.letterSpacing = '8px';
    while (g.measureText(text).width + 64 > W - 300 && fs > 22) {
      fs -= 1;
      g.font = `700 ${fs}px ${SANS}`;
      g.letterSpacing = `${(fs * 8) / 36}px`;
    }
    const w = g.measureText(text).width + 64;
    g.fillStyle = '#000';
    g.fillRect(W / 2 - w / 2, y - 38, w, 58);
    g.globalCompositeOperation = 'destination-out';
    g.fillText(text, W / 2 + 4, y + 3);
    g.globalCompositeOperation = 'source-over';
  };
  band(small, H * 0.77);
  if (top) band(top, H * 0.27);
  // a short rule between
  g.fillRect(W / 2 - 40, H * 0.635, 80, 4);
  return c;
}

export class Plates {
  constructor(S, el, section) {
    this.S = S;
    this.el = el;
    this.section = section;
    this.p = 0;
    this.mx = 0;
    this.my = 0;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

    const shared = {
      uLight: { value: new THREE.Vector3(0, 0, 2) },
      uCam: { value: new THREE.Vector3() },
      uLightI: { value: 0 },
    };
    this.shared = shared;
    const rects = [];
    const waits = [];
    this.hidden = true;
    const edgeMat = new THREE.ShaderMaterial({
      vertexShader: PLATE_VS,
      fragmentShader: PLATE_FS,
      uniforms: { ...shared, uSDF: { value: null }, uTexRes: { value: new THREE.Vector2(1, 1) }, uTexel: { value: 1 }, uFace: { value: 0 } },
    });
    PLATES.forEach((pl, i) => {
      const c = plateCanvas(pl);
      const cw = c.width,
        ch = c.height;
      const faceU = { value: null };
      waits.push(sdfTexture(c).then((t) => (faceU.value = t)));
      const x = i * GAP;
      const box = new THREE.Mesh(new RoundedBoxGeometry(PW, PH, 0.05, 4, 0.018), edgeMat);
      box.position.set(x, 0, STAND - 0.025);
      this.scene.add(box);
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(PW - 0.03, PH - 0.03),
        new THREE.ShaderMaterial({
          vertexShader: PLATE_VS,
          fragmentShader: PLATE_FS,
          uniforms: { ...shared, uSDF: faceU, uTexRes: { value: new THREE.Vector2(cw, ch) }, uTexel: { value: 1 }, uFace: { value: 1 } },
        }),
      );
      face.position.set(x, 0, STAND + 0.0012);
      this.scene.add(face);
      // four domed screws
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), edgeMat);
        s.rotation.x = Math.PI / 2;
        s.scale.set(1, 0.35, 1);
        s.position.set(x + sx * (PW / 2 - 0.075), sy * (PH / 2 - 0.075), STAND + 0.001);
        this.scene.add(s);
      }
      rects.push(new THREE.Vector4(x, 0, PW / 2, PH / 2));
    });
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 20),
      new THREE.ShaderMaterial({ vertexShader: PLATE_VS, fragmentShader: WALL_FS, uniforms: { ...shared, uRects: { value: rects } } }),
    );
    Promise.all(waits).then(() => (this.hidden = false));
    wall.position.set(GAP * 1.5, 0, 0);
    this.scene.add(wall);

    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: S.rtType, samples: S.rtSamples });
    this.post = quad(
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
        fragmentShader: POST,
        depthTest: false,
        uniforms: { uTex: { value: this.rt.texture }, uTime: { value: 0 }, uFade: { value: 1 }, uSeam: seamUniform() },
      }),
    );
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.5);
    this.tmp = new THREE.Vector3();
    this.resize();
  }

  resize() {
    const S = this.S;
    this.rt.setSize(Math.round(S.w * S.rtDpr), Math.round(S.h * S.rtDpr));
    this.cam.aspect = S.w / S.h;
    this.cam.updateProjectionMatrix();
  }

  update(r, on) {
    if (!on) return;
    const S = this.S;
    const sr = this.section.getBoundingClientRect();
    const target = clamp(-sr.top / (sr.height - S.h));
    this.p = damp(this.p, target, 5, S.dt);
    // a straight walk along the wall, one plate centred at each quarter of the scroll
    const n = PLATES.length - 1;
    let f = clamp((this.p - 0.04) / 0.92) * n;
    const x = f * GAP;
    this.mx = damp(this.mx, (S.mouse.x / S.w) * 2 - 1, 3, S.dt);
    this.my = damp(this.my, (S.mouse.y / S.h) * 2 - 1, 3, S.dt);
    // far enough that a plate (and a hint of the next) fits the width of the screen
    const fitZ = (PW * 1.25) / (2 * Math.tan((15 * Math.PI) / 180) * this.cam.aspect);
    this.cam.position.set(x + this.mx * 0.45, -this.my * 0.22, Math.max(7.1, fitZ));
    this.cam.lookAt(x + this.mx * 0.1, 0, 0);

    // light: where the cursor points, a little off the wall
    this.cam.updateMatrixWorld();
    const nx = ((S.light.x - r.left) / r.width) * 2 - 1;
    const ny = -(((S.light.y - r.top) / r.height) * 2 - 1);
    this.ray.setFromCamera({ x: nx, y: ny }, this.cam);
    this.ray.ray.intersectPlane(this.plane, this.tmp);
    this.shared.uLight.value.copy(this.tmp);
    this.shared.uCam.value.copy(this.cam.position);
    // the light comes on as the section takes the screen
    const vis = clamp((Math.min(sr.bottom, S.h) - Math.max(sr.top, 0)) / S.h);
    this.shared.uLightI.value = 2.4 * ease(vis);
    this.post.mesh.material.uniforms.uTime.value = S.time;
    setSeam(this.post.mesh.material.uniforms.uSeam, r, S);
  }

  prerender(renderer) {
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.cam);
    renderer.setClearColor(0x000000, 0);
  }

  render(renderer) {
    this.post.draw(renderer);
  }
}
