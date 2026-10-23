import * as THREE from 'three';
import { quad, clamp, damp, ease, GLSL_COMMON, DISPLAY, seamUniform, setSeam } from './core.js';
import { sdfTexture, textCanvas } from './sdf.js';

/*
 * Hero: the name as a block of thick glass, raymarched from the exact distance field of
 * the font. The ray refracts in, travels through the glass, refracts out with a slightly
 * different index per channel and lands on the portrait behind it.
 */
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSDF, uPhoto;
uniform vec2 uRes, uSdfRes, uLight;
uniform vec3 uCam;
uniform mat3 uRot;
uniform vec2 uTextSize, uTextCenter;
uniform float uTexel, uDepth, uBevel, uIor, uIntro, uTime, uPhotoIn, uSweep, uAspect, uLeave;
uniform vec4 uPhotoRect;
uniform float uDbg;
${GLSL_COMMON}

const float TAN = 0.24933; // tan(14deg)
const float ZB = -1.35;     // portrait plane

float sd2(vec2 p){
  vec2 uv = (p - uTextCenter) / uTextSize + .5;
  vec2 q = clamp(uv, 0., 1.);
  float d = texture2D(uSDF, q).r * uTexel;
  // outside the texture: grow the distance with the box
  return d + length((uv - q) * uTextSize);
}
float map(vec3 p){
  vec3 c = vec3(uTextCenter, 0.);
  p = uRot * (p - c) + c;
  float d = sd2(p.xy);
  // a pillow profile: every stroke is a small lens, flat only where it is wide
  float s = clamp(-d / uBevel, 0., 1.);
  float H = uDepth * sqrt(s * (2. - s));
  return max(d, abs(p.z) - H) * .7;
}
vec3 nrm(vec3 p){
  vec2 e = vec2(.0012, 0.);
  return normalize(vec3(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx)));
}
vec2 box(vec3 ro, vec3 rd, vec3 b){
  // in object space
  vec3 m = 1./rd, n = m*ro, k = abs(m)*b;
  vec3 t1 = -n - k, t2 = -n + k;
  return vec2(max(max(t1.x,t1.y),t1.z), min(min(t2.x,t2.y),t2.z));
}

vec3 backdrop(vec2 p, vec2 lightW){
  // graphite wall, a warm pool where the light is, the portrait standing in it
  float pool = exp(-dot(p - lightW*1.25, p - lightW*1.25) * 1.1);
  vec3 c = vec3(.011,.010,.009) + vec3(.065,.05,.034) * pool * (.35 + .65*uIntro);
  c += vec3(.016,.014,.012) * smoothstep(-2.2, 1.5, p.y);
  vec2 uv = (p - uPhotoRect.xy) / uPhotoRect.zw + .5;
  if (uv.x > 0. && uv.x < 1. && uv.y > 0. && uv.y < 1.){
    vec4 ph = texture2D(uPhoto, uv);
    float a = smoothstep(.55, 1., ph.a);
    vec3 col = toLin(ph.rgb);
    // relight: the photo sits in the same warm pool as the wall
    col *= .62 + .5 * pool;
    col = mix(vec3(dot(col, vec3(.3,.59,.11))), col, .6) * vec3(.95, 1., 1.03);
    // fade the feet of the portrait into the floor
    a *= smoothstep(.0, .22, uv.y);
    // the portrait comes up with the light, never as a cut-out silhouette
    c = mix(c, col * mix(.35, 1., uPhotoIn), a * smoothstep(0., .7, uPhotoIn));
  }
  return c;
}

void main(){
  vec2 ndc = vUv * 2. - 1.;
  vec3 fw = normalize(-uCam);
  vec3 rt = normalize(cross(fw, vec3(0,1,0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw + ndc.x * uAspect * TAN * rt + ndc.y * TAN * up);
  vec3 ro = uCam;

  // where the cursor light is, on the z=0 plane, and in space
  vec2 lightW = uLight;
  vec3 L = vec3(lightW, 1.6);

  // backdrop through empty space
  float tb = (ZB - ro.z) / rd.z;
  vec3 col = backdrop((ro + rd*tb).xy, lightW);

  vec3 bx = vec3(uTextSize*.5 + uBevel + .02, uDepth + .02);
  vec3 tc = vec3(uTextCenter, 0.);
  vec2 hit = box(uRot * (ro - tc), uRot * rd, bx);
  if (hit.x < hit.y && hit.y > 0. && uDepth > .007){
    float t = max(hit.x, 0.);
    bool found = false;
    for (int i = 0; i < 128; i++){
      vec3 p = ro + rd*t;
      float d = map(p);
      if (d < .0004){ found = true; break; }
      t += d;
      if (t > hit.y + .01) break;
    }
    if (found){
      vec3 p = ro + rd*t;
      vec3 n = nrm(p);
      float cosi = clamp(dot(-rd, n), 0., 1.);
      float F = .04 + .96 * pow(1. - cosi, 5.);

      // reflection: the studio, plus the cursor light as a hard highlight
      vec3 rf = reflect(rd, n);
      vec3 refl = studio(rf) * 1.5;
      vec3 Ld = normalize(L - p);
      vec3 h = normalize(Ld - rd);
      float nh = max(dot(n, h), 0.);
      float spec = pow(nh, 600.) * 30. + pow(nh, 120.) * .08 * (1. - n.z);
      // the intro sweep: a band of light crossing the letters once
      float sweep = exp(-pow((p.x - uSweep) * 3.2, 2.)) * smoothstep(.2, 1., 1. - abs(n.z));

      // into the glass
      float ior = mix(1.0, uIor, uIntro);
      vec3 ri = refract(rd, n, 1./ior);
      float ti = .004;
      vec3 q = p + ri * ti;
      float thick = 0.;
      for (int i = 0; i < 64; i++){
        float d = -map(q);
        if (d < .0005) break;
        float s = max(d, .0015);
        q += ri * s; thick += s;
      }
      vec3 n2 = -nrm(q);
      vec3 tint = exp(-thick * vec3(4.2, 4.6, 5.4));
      vec3 through = vec3(0.);
      // three indices, three exits: the dispersion lives here
      float spread = .028 * uIntro;
      for (int c = 0; c < 3; c++){
        float e = ior + (float(c) - 1.) * spread;
        vec3 ro2 = refract(ri, n2, e);
        if (dot(ro2, ro2) < .01) ro2 = reflect(ri, n2);
        float tb2 = (ZB - q.z) / min(ro2.z, -.05);
        vec3 b = backdrop((q + ro2*tb2).xy, lightW);
        // light caught inside the edges
        b += studio(ro2) * .015;
        through[c] = b[c];
      }
      through *= tint;
      if (uDbg > 3.5){ gl_FragColor = vec4(toSRGB(aces((uDbg < 4.5 ? through : (uDbg < 5.5 ? refl*F : vec3(spec)))*1.2)), 1.); return; }
      if (uDbg > .5){ vec3 ro2 = refract(ri, n2, ior); gl_FragColor = vec4(uDbg < 1.5 ? vec3(thick*12.) : (uDbg < 2.5 ? ro2*.5+.5 : n2*.5+.5), 1.); return; }
      // edges glow with the internal bounce of the light
      float edge = pow(1. - abs(dot(n, normalize(vec3(0,0,1) * uRot))), 3.);
      vec3 lit = through * (1. - F) + refl * F;
      lit += vec3(1.,.92,.8) * spec * uIntro;
      lit += vec3(1.,.9,.75) * sweep * 1.4;
      lit += vec3(.9,.8,.65) * edge * .05 * uIntro;
      float a = smoothstep(0., .25, uIntro);
      col = mix(col, lit, a);
    }
  }

  // grain and a soft vignette: same lens on every section
  col *= 1. - .35 * pow(length(ndc * vec2(.8, 1.)), 2.6);
  col = aces(col * 1.2);
  col = seam(toSRGB(col));
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.) - .5) * .022;
  gl_FragColor = vec4(col, 1.);
}
`;

export class Glass {
  constructor(S, el, { photo }) {
    this.S = S;
    this.el = el;
    this.intro = 0;
    this.started = false;
    this.mx = 0;
    this.my = 0;

    const { canvas } = this.makeMask();
    this.hidden = true;
    this.ready = sdfTexture(canvas, { soften: 2 }).then((t) => {
      this.mat.uniforms.uSDF.value = t;
      this.hidden = false;
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSDF: { value: null },
        uPhoto: { value: photo },
        uRes: { value: new THREE.Vector2() },
        uSdfRes: { value: new THREE.Vector2(canvas.width, canvas.height) },
        uLight: { value: new THREE.Vector2() },
        uCam: { value: new THREE.Vector3(0, 0, 4) },
        uRot: { value: new THREE.Matrix3() },
        uTextSize: { value: new THREE.Vector2() },
        uTextCenter: { value: new THREE.Vector2() },
        uTexel: { value: 1 },
        uDepth: { value: 0.018 },
        uBevel: { value: 0.03 },
        uIor: { value: 1.5 },
        uIntro: { value: 0 },
        uTime: { value: 0 },
        uPhotoIn: { value: 0 },
        uSweep: { value: -9 },
        uAspect: { value: 1 },
        uLeave: { value: 0 },
        uPhotoRect: { value: new THREE.Vector4() },
        uSeam: seamUniform(),
        uDbg: { value: +(new URLSearchParams(location.search).get('dbg') || 0) },
      },
    });
    this.mat = mat;
    this.q = quad(mat);
    this.rot = new THREE.Matrix4();
    this.resize();
  }

  makeMask() {
    const size = 300;
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `${size}px ${DISPLAY}`;
    probe.letterSpacing = '-6px';
    const text = 'Nícolas Schorn';
    const w = Math.ceil(probe.measureText(text).width) + 160;
    const h = 420;
    const tc = textCanvas([text], { font: DISPLAY, size, width: w, height: h, padX: 80, padY: 50, tracking: -6 });
    this.maskW = w;
    this.maskH = h;
    return tc;
  }

  resize() {
    const u = this.mat.uniforms;
    const aspect = this.S.w / this.S.h;
    u.uAspect.value = aspect;
    // the name spans almost the full width, sitting in the lower third
    const tw = 2 * aspect * 0.94;
    const th = (tw * this.maskH) / this.maskW;
    u.uTextSize.value.set(tw, th);
    u.uTextCenter.value.set(0, -0.6);
    u.uTexel.value = tw / this.maskW;
    // portrait plane is further back; scale it so it fills the height
    const zb = 1.35,
      D = 4;
    const k = (D + zb) / D;
    const ph = 1.78 * k;
    u.uPhotoRect.value.set(0.04 * k, -1 * k + ph / 2 - 0.02, ph, ph);
  }

  start() {
    this.started = true;
    this.t0 = this.S.time;
  }

  update(r, on) {
    if (!this.started) return;
    const S = this.S;
    const t = S.time - this.t0;
    const io = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    this.intro = io(clamp(t / 3.4));
    const u = this.mat.uniforms;
    u.uIntro.value = this.intro;
    u.uPhotoIn.value = io(clamp((t - 0.5) / 2.8));
    u.uSweep.value = -2.6 + ease(clamp((t - 0.9) / 2.8)) * 5.4;
    u.uDepth.value = 0.008 + 0.022 * io(clamp((t - 0.2) / 2.8));
    u.uTime.value = S.time;
    if (!on) return;
    setSeam(u.uSeam, r, S);
    // camera orbits with the cursor, and lifts as the hero leaves
    const nx = (S.mouse.x / S.w) * 2 - 1;
    const ny = (S.mouse.y / S.h) * 2 - 1;
    this.mx = damp(this.mx, nx, 3, S.dt);
    this.my = damp(this.my, ny, 3, S.dt);
    const leave = clamp(-r.top / r.height);
    u.uLeave.value = leave;
    const yaw = this.mx * 0.11;
    const pitch = -this.my * 0.06 + leave * 0.2;
    u.uCam.value.set(Math.sin(yaw) * 4, Math.sin(pitch) * 4, Math.cos(yaw) * Math.cos(pitch) * 4);
    // the slab tilts back as you scroll away, so its top bevel catches the strip light
    this.rot.makeRotationX(-leave * 0.55 - 0.04);
    u.uRot.value.setFromMatrix4(this.rot);
    const aspect = S.w / S.h;
    const lx = ((S.light.x - r.left) / r.width) * 2 - 1;
    const ly = -(((S.light.y - r.top) / r.height) * 2 - 1);
    u.uLight.value.set(lx * aspect, ly);
  }

  render(renderer) {
    this.q.draw(renderer);
  }
}
