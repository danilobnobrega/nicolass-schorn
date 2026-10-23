import * as THREE from 'three';
import { quad, clamp, damp, ease, smooth, Spring, GLSL_COMMON, DISPLAY, SANS, wrap, seamUniform, setSeam } from './core.js';

/*
 * How I work: a dossier on a dark desk. Each sheet turns on its binding as you scroll,
 * bending the way heavy paper does (the spine leads, the free edge lags, one corner
 * leads the other) and casting a real shadow from the cursor's lamp.
 */
const PAGES = [
  { cover: true, title: 'Como trabalho', sub: 'NÍCOLAS T. SCHORN · PRIVATE BANKER' },
  { n: '01', title: 'Escuta antes da proposta', text: 'Primeiro entendo os objetivos do cliente, da família e da empresa. A estratégia vem depois.' },
  { n: '02', title: 'Especialistas ao lado', text: 'Sucessão, crédito, previdência e mercado internacional com o apoio dos especialistas do ecossistema XP.' },
  { n: '03', title: 'Revisão contínua', text: 'Patrimônio muda com a vida. As estratégias são revistas ao longo do tempo, junto com você.' },
];
const PW = 1.0,
  PH = 1.38,
  SX = 64,
  SY = 20;

function pageCanvas(p, back = false) {
  const W = 1100,
    H = Math.round((W * PH) / PW);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // heavy cotton stock: warm, with a little tooth
  g.fillStyle = p.cover ? '#e6dccb' : '#efe8dc';
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  if (back) {
    // the print shows through the stock (the back face mirrors it on its own)
    g.save();
    g.globalAlpha = 0.03;
    g.drawImage(pageCanvas(p), 0, 0);
    g.restore();
    return c;
  }
  const ink = '#1a1816';
  const brass = '#8e6a36';
  const M = 96;
  if (p.cover) {
    g.fillStyle = ink;
    g.font = `600 26px ${SANS}`;
    g.letterSpacing = '6px';
    g.fillText(p.sub, M, M + 22);
    g.fillRect(M, M + 52, W - M * 2, 2);
    g.font = `200px ${DISPLAY}`;
    g.letterSpacing = '-6px';
    const lines = wrap(g, p.title, W - M * 2);
    lines.forEach((l, i) => g.fillText(l, M - 6, H - M - 60 - (lines.length - 1 - i) * 196));
    g.fillStyle = brass;
    g.fillRect(M, H - M - 10, 120, 6);
    return c;
  }
  g.fillStyle = brass;
  g.font = `440px ${DISPLAY}`;
  g.letterSpacing = '-16px';
  g.fillText(p.n, M - 20, M + 350);
  g.fillStyle = ink;
  g.font = `128px ${DISPLAY}`;
  g.letterSpacing = '-3px';
  const tl = wrap(g, p.title, W - M * 2);
  const ty = H * 0.53;
  tl.forEach((l, i) => g.fillText(l, M, ty + i * 128));
  g.font = `400 46px ${SANS}`;
  g.letterSpacing = '0px';
  g.fillStyle = '#34302b';
  const bl = wrap(g, p.text, W - M * 2 - 40);
  bl.forEach((l, i) => g.fillText(l, M, ty + tl.length * 128 + 50 + i * 66));
  g.fillStyle = ink;
  g.fillRect(M, H - M, W - M * 2, 1.5);
  g.font = `600 24px ${SANS}`;
  g.letterSpacing = '5px';
  g.fillText('NÍCOLAS T. SCHORN', M, H - M + 40);
  g.textAlign = 'right';
  g.fillText(`${p.n} / 03`, W - M, H - M + 40);
  return c;
}

const POST = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uTime;
${GLSL_COMMON}
void main(){
  vec3 c = texture2D(uTex, vUv).rgb;
  vec2 q = vUv * 2. - 1.;
  c *= 1. - .4 * pow(length(q * vec2(.8, 1.)), 2.4);
  c = seam(toSRGB(aces(c * 1.1)));
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 91.) - .5) * .022;
  gl_FragColor = vec4(c, 1.);
}
`;

export class Sheets {
  constructor(S, el, section) {
    this.S = S;
    this.el = el;
    this.section = section;
    this.P = 0;
    this.mx = 0;
    this.my = 0;
    const scene = (this.scene = new THREE.Scene());
    this.cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);

    // desk
    const dc = document.createElement('canvas');
    dc.width = dc.height = 512;
    const dg = dc.getContext('2d');
    const di = dg.createImageData(512, 512);
    for (let i = 0; i < di.data.length; i += 4) {
      const n = 16 + Math.random() * 6;
      di.data[i] = n;
      di.data[i + 1] = n * 0.95;
      di.data[i + 2] = n * 0.88;
      di.data[i + 3] = 255;
    }
    dg.putImageData(di, 0, 0);
    const dt = new THREE.CanvasTexture(dc);
    dt.colorSpace = THREE.SRGBColorSpace;
    dt.wrapS = dt.wrapT = THREE.RepeatWrapping;
    dt.repeat.set(10, 10);
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ map: dt, roughness: 0.8, metalness: 0 }));
    desk.rotation.x = -Math.PI / 2;
    desk.receiveShadow = true;
    scene.add(desk);

    this.lamp = new THREE.SpotLight(0xffe7c8, 60, 12, 0.75, 0.65, 1.6);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(2048, 2048);
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.normalBias = 0.01;
    this.lamp.shadow.radius = 6;
    this.lamp.shadow.camera.near = 0.5;
    this.lamp.shadow.camera.far = 10;
    scene.add(this.lamp, this.lamp.target);
    scene.add(new THREE.HemisphereLight(0x8a8478, 0x1a1712, 0.22));

    this.sheets = PAGES.map((p, i) => {
      const geo = new THREE.PlaneGeometry(PW, PH, SX, SY);
      geo.translate(PW / 2, 0, 0); // hinge on the left edge
      const front = new THREE.CanvasTexture(pageCanvas(p));
      front.colorSpace = THREE.SRGBColorSpace;
      front.anisotropy = 8;
      const back = new THREE.CanvasTexture(pageCanvas(p, true));
      back.colorSpace = THREE.SRGBColorSpace;
      const mF = new THREE.MeshStandardMaterial({ map: front, roughness: 0.92, side: THREE.FrontSide });
      const mB = new THREE.MeshStandardMaterial({ map: back, roughness: 0.95, side: THREE.BackSide });
      const g = new THREE.Group();
      const a = new THREE.Mesh(geo, mF);
      const b = new THREE.Mesh(geo, mB);
      a.castShadow = b.castShadow = true;
      a.receiveShadow = b.receiveShadow = true;
      g.add(a, b);
      // flat on the desk, stacked: the cover on top
      g.rotation.x = -Math.PI / 2;
      g.position.set(0, 0.002 + (PAGES.length - i) * 0.0028, 0);
      scene.add(g);
      const base = geo.attributes.position.array.slice();
      return { g, geo, base, t: -1, lift: 0, ls: new Spring(0, 60, 9) };
    });

    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.post = quad(
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
        fragmentShader: POST,
        depthTest: false,
        uniforms: { uTex: { value: this.rt.texture }, uTime: { value: 0 }, uSeam: seamUniform() },
      }),
    );
    this.ray = new THREE.Raycaster();
    this.deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tmp = new THREE.Vector3();
    this.resize();
  }

  resize() {
    const S = this.S;
    this.rt.setSize(Math.round(S.w * S.dpr), Math.round(S.h * S.dpr));
    this.cam.aspect = S.w / S.h;
    this.cam.updateProjectionMatrix();
  }

  // bend one sheet: angle along the width grows from the spine, the free edge lags
  bend(sh, t, lift = 0) {
    if (Math.abs(t - sh.t) < 1e-5 && Math.abs(lift - sh.lift) < 1e-4) return;
    sh.t = t;
    sh.lift = lift;
    const pos = sh.geo.attributes.position.array;
    const theta = Math.PI * ease(t);
    const bendAmt = Math.sin(Math.PI * clamp(t)) * (1 - 0.35 * t);
    const cols = SX + 1;
    for (let j = 0; j <= SY; j++) {
      const v = j / SY;
      // the lower corner leads, as if the page was lifted by it
      const lag = 0.95 + (1 - v) * -0.35 + v * 0.25;
      let x = 0,
        z = 0,
        prev = 0;
      for (let i = 0; i < cols; i++) {
        const s = i / SX;
        const k = j * cols + i;
        if (i > 0) {
          const ds = PW / SX;
          const a = theta * (1 - lag * bendAmt * Math.pow(s, 1.5) * 0.55) + bendAmt * 0.28 * s * (1 - s);
          x += Math.cos((a + prev) / 2) * ds;
          z += Math.sin((a + prev) / 2) * ds;
          prev = a;
        } else prev = theta;
        // the free corner nearest the reader lifts toward the hand
        const cl = lift * Math.pow(s, 2.6) * v * v;
        pos[k * 3] = x - cl * 0.25;
        pos[k * 3 + 1] = sh.base[k * 3 + 1];
        pos[k * 3 + 2] = z + cl * 0.11;
      }
    }
    sh.geo.attributes.position.needsUpdate = true;
    sh.geo.computeVertexNormals();
  }

  update(r, on) {
    if (!on) return;
    const S = this.S;
    const sr = this.section.getBoundingClientRect();
    const p = clamp(-sr.top / (sr.height - S.h));
    const target = clamp((p - 0.06) / 0.86) * (PAGES.length - 1);
    this.P = damp(this.P, target, 4.5, S.dt);
    this.mx = damp(this.mx, (S.mouse.x / S.w) * 2 - 1, 3, S.dt);
    this.my = damp(this.my, (S.mouse.y / S.h) * 2 - 1, 3, S.dt);
    // the camera frames the closed dossier, then the open spread
    const open = clamp(this.P);
    const cx = 0.5 - open * 0.5;
    this.cam.position.set(cx + this.mx * 0.2, 3.75 - open * 0.12, 1.3 + this.my * 0.12);
    this.cam.lookAt(cx, 0, 0.06);
    this.cam.updateMatrixWorld();

    // where the cursor points on the desk
    const nx0 = ((S.mouse.x - r.left) / r.width) * 2 - 1;
    const ny0 = -(((S.mouse.y - r.top) / r.height) * 2 - 1);
    this.ray.setFromCamera({ x: nx0, y: ny0 }, this.cam);
    const hit = this.ray.ray.intersectPlane(this.deskPlane, new THREE.Vector3());
    const top = this.sheets.findIndex((sh, i) => this.P - i < 0.01);
    this.sheets.forEach((sh, i) => {
      const t = clamp(this.P - i);
      // the top sheet's corner rises when the hand comes near it
      const near = hit && i === top && i < PAGES.length - 1 ? smooth(0.5, 0.08, Math.hypot(hit.x - PW, hit.z - PH / 2)) : 0;
      sh.ls.t = near;
      const lift = clamp(sh.ls.step(S.dt), 0, 1.2);
      this.bend(sh, t, lift);
      const turned = t > 0.5;
      sh.g.position.y = 0.002 + (turned ? i : PAGES.length - i) * 0.0028 + Math.sin(Math.PI * t) * 0.01;
    });

    // the lamp hangs where the cursor points, above the desk
    const nx = ((S.light.x - r.left) / r.width) * 2 - 1;
    const ny = -(((S.light.y - r.top) / r.height) * 2 - 1);
    this.ray.setFromCamera({ x: nx, y: ny }, this.cam);
    this.ray.ray.intersectPlane(this.deskPlane, this.tmp);
    this.lamp.position.set(this.tmp.x * 0.6 + 0.3, 2.4, this.tmp.z * 0.6 + 0.7);
    this.lamp.target.position.set(this.tmp.x, 0, this.tmp.z);
    const vis = clamp((Math.min(sr.bottom, S.h) - Math.max(sr.top, 0)) / S.h);
    this.lamp.intensity = 16 * ease(vis);
    this.post.mesh.material.uniforms.uTime.value = S.time;
    setSeam(this.post.mesh.material.uniforms.uSeam, r, S);
  }

  prerender(renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
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
