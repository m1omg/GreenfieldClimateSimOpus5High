// Procedural planetary topography shared by the simulation (hypsometry per band) and the
// renderer (height texture). Raw fractal noise only sets the *pattern*; elevations are then
// remapped by rank onto Earth's hypsometric curve, so one Earth ocean gives ~71% ocean cover
// with realistic shelf/abyss proportions. Relief scales with 1/g.

// --- deterministic 3D simplex noise (Gustavson), seeded permutation
function makePerm(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}
const G3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];

export function makeNoise(seed) {
  const perm = makePerm(seed);
  const F3 = 1 / 3, G3c = 1 / 6;
  return function noise(x, y, z) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3c;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3c, y1 = y0 - j1 + G3c, z1 = z0 - k1 + G3c;
    const x2 = x0 - i2 + 2 * G3c, y2 = y0 - j2 + 2 * G3c, z2 = z0 - k2 + 2 * G3c;
    const x3 = x0 - 1 + 0.5, y3 = y0 - 1 + 0.5, z3 = z0 - 1 + 0.5;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    const c = (tx, ty, tz, gi) => {
      let tt = 0.6 - tx * tx - ty * ty - tz * tz;
      if (tt < 0) return 0;
      tt *= tt;
      const g = G3[gi % 12];
      return tt * tt * (g[0] * tx + g[1] * ty + g[2] * tz);
    };
    n += c(x0, y0, z0, perm[ii + perm[jj + perm[kk]]]);
    n += c(x1, y1, z1, perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]);
    n += c(x2, y2, z2, perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]);
    n += c(x3, y3, z3, perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]);
    return 32 * n;
  };
}

/** Raw terrain field: continents (low frequency) + ridged mountains + detail. */
export function rawHeightFn(seed) {
  const n1 = makeNoise(seed), n2 = makeNoise(seed + 101), n3 = makeNoise(seed + 977);
  return function (x, y, z) {
    // domain warp for organic coastlines
    const wx = n3(x * 1.3 + 5.1, y * 1.3, z * 1.3) * 0.35;
    const wy = n3(x * 1.3, y * 1.3 + 9.7, z * 1.3) * 0.35;
    const X = x + wx, Y = y + wy, Z = z;
    let cont = 0, a = 1, f = 0.9;
    for (let o = 0; o < 5; o++) { cont += a * n1(X * f, Y * f, Z * f); a *= 0.5; f *= 2.03; }
    let ridge = 0; a = 0.5; f = 2.2;
    for (let o = 0; o < 4; o++) { const r = 1 - Math.abs(n2(X * f, Y * f, Z * f)); ridge += a * r * r; a *= 0.5; f *= 2.1; }
    return cont + 0.35 * ridge * Math.max(0, cont + 0.15);
  };
}

// Earth hypsometric curve: elevation (km) vs cumulative area fraction below it.
const HYPSO = [
  [0.0, -8.0], [0.014, -6.0], [0.171, -5.0], [0.41, -4.0], [0.544, -3.0], [0.59, -2.0],
  [0.62, -1.0], [0.66, -0.2], [0.705, 0.0], [0.80, 0.3], [0.914, 1.0], [0.959, 2.0], [0.981, 3.0],
  [0.995, 4.5], [1.0, 7.0],
];
function hypso(r) {
  for (let i = 0; i < HYPSO.length - 1; i++) {
    if (r <= HYPSO[i + 1][0]) {
      const f = (r - HYPSO[i][0]) / (HYPSO[i + 1][0] - HYPSO[i][0]);
      return HYPSO[i][1] * (1 - f) + HYPSO[i + 1][1] * f;
    }
  }
  return HYPSO[HYPSO.length - 1][1];
}

/**
 * Build an equirectangular height map (km, Earth-normalised) of size W x H.
 * Returns Float32Array (row 0 = north pole).
 */
export function buildHeightMap(seed, W, H) {
  const f = rawHeightFn(seed);
  const raw = new Float32Array(W * H);
  const wts = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const lat = Math.PI / 2 - (j + 0.5) / H * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = (i + 0.5) / W * 2 * Math.PI - Math.PI;
      const x = cl * Math.cos(lon), y = sl, z = cl * Math.sin(lon);
      raw[j * W + i] = f(x, y, z);
      wts[j * W + i] = cl;
    }
  }
  // rank (area-weighted) -> Earth hypsometry
  const idx = new Uint32Array(W * H);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx.sort((a, b) => raw[a] - raw[b]);
  let tot = 0;
  for (let i = 0; i < wts.length; i++) tot += wts[i];
  const out = new Float32Array(W * H);
  let cum = 0;
  for (let n = 0; n < idx.length; n++) {
    const id = idx[n];
    const r = (cum + 0.5 * wts[id]) / tot;
    out[id] = hypso(r);
    cum += wts[id];
  }
  return out;
}

/** Downsample a height map by block averaging. */
export function downsample(h, W, H, w, hh) {
  const out = new Float32Array(w * hh);
  const fx = W / w, fy = H / hh;
  for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
    let s = 0, n = 0;
    for (let y = Math.floor(j * fy); y < Math.floor((j + 1) * fy); y++)
      for (let x = Math.floor(i * fx); x < Math.floor((i + 1) * fx); x++) { s += h[y * W + x]; n++; }
    out[j * w + i] = s / n;
  }
  return out;
}
