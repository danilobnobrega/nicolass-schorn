import * as THREE from 'three';

/*
 * Exact Euclidean distance fields of canvas masks, computed in workers
 * (Felzenszwalb & Huttenlocher, see sdf.worker.js). Signed distance in texels:
 * negative inside the ink, positive outside.
 */
// one worker on phones keeps the peak memory low
const phone = matchMedia('(hover: none), (pointer: coarse)').matches;
const POOL = Array.from({ length: phone ? 1 : Math.min(3, navigator.hardwareConcurrency || 2) }, () => new Worker(new URL('./sdf.worker.js', import.meta.url), { type: 'module' }));
const jobs = new Map();
let seq = 0;
POOL.forEach((wk) =>
  wk.addEventListener('message', (e) => {
    const j = jobs.get(e.data.id);
    jobs.delete(e.data.id);
    j(e.data.out);
  }),
);

export function sdfTexture(canvas, { soften = 0 } = {}) {
  const w = canvas.width,
    h = canvas.height;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3];
  const id = ++seq;
  return new Promise((res) => {
    jobs.set(id, (out) => {
      const t = new THREE.DataTexture(out, w, h, THREE.RedFormat, THREE.HalfFloatType);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      res(t);
    });
    POOL[id % POOL.length].postMessage({ id, alpha, w, h, soften }, [alpha.buffer]);
  });
}

export function textCanvas(lines, { font, size, width, height, lineHeight = 1.1, align = 'left', padX = 0, padY = 0, tracking = 0 }) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.font = `${size}px ${font}`;
  g.textBaseline = 'alphabetic';
  if (tracking) g.letterSpacing = `${tracking}px`;
  const metrics = [];
  lines.forEach((line, i) => {
    const m = g.measureText(line);
    const x = align === 'center' ? (width - m.width) / 2 : padX;
    const base = padY + size * 0.8 + i * size * lineHeight;
    g.textAlign = 'left';
    g.fillText(line, x, base);
    metrics.push({ x, base, w: m.width });
  });
  return { canvas: c, ctx: g, metrics };
}
