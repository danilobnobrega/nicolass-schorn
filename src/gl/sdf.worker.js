/* distance fields off the main thread */
const INF = 1e20;
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
function edt2d(grid, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n),
    d = new Float64Array(n),
    z = new Float64Array(n + 1),
    v = new Uint32Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]);
  }
}

function maskToSDF(px, w, h) {
  const outer = new Float64Array(w * h);
  const inner = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = px[i] / 255;
    // sub-pixel edge from antialiased coverage
    outer[i] = a >= 0.999 ? 0 : a <= 0.001 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
    inner[i] = a <= 0.001 ? 0 : a >= 0.999 ? INF : Math.pow(Math.max(0, a - 0.5), 2);
  }
  edt2d(outer, w, h);
  edt2d(inner, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = outer[i] - inner[i];
  return out;
}


// separable box blur: rounds the medial ridges so curved profiles shade smoothly
function blur(d, w, h, r) {
  const tmp = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += d[y * w + Math.min(w - 1, Math.max(0, x + k))];
      tmp[y * w + x] = s / n;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      d[y * w + x] = s / n;
    }
}


self.onmessage = (e) => {
  const { id, alpha, w, h, soften } = e.data;
  const d = maskToSDF(alpha, w, h);
  for (let i = 0; i < soften; i++) blur(d, w, h, 2);
  // flip rows so the texture's v=0 is the bottom of the canvas
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) out.set(d.subarray((h - 1 - y) * w, (h - y) * w), y * w);
  self.postMessage({ id, out }, [out.buffer]);
};
