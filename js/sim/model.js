// Planetary climate model.
//
// Fast climate: 36-band (5°) latitudinal energy-balance model (or substellar-coordinate bands
// for tidally locked planets) with full spectral radiative transfer via lookup tables
// (radcache.js), implicit (backward-Euler, Newton) time stepping, diffusive heat transport
// scaled with pressure, heat capacity, molecular weight, rotation and latent heat, a
// global deep ocean, sea ice and snow, clouds, and a latent-heat "effective heat capacity"
// that makes the evaporation of an ocean during a runaway take as long as energy demands.
//
// Slow processes: hydrological cycle with land ice sheets (water can be cold-trapped),
// carbonate–silicate cycle (land and seafloor weathering, outgassing, ocean carbon storage,
// carbonate decomposition on hot surfaces), CO2 condensation (atmospheric collapse),
// hydrogen escape (diffusion- or energy-limited) driving water loss and abiotic O2,
// bulk atmospheric erosion (cosmic-shoreline scaling), biosphere O2/CH4, sulfur and haze.

import {
  SIGMA, G_GRAV, R_GAS, N_A, YEAR, S_EARTH, M_EARTH, R_EARTH, G_EARTH, OCEAN_EARTH,
  OMEGA_EARTH, MOLAR, CP, C_WATER, RHO_WATER, T_SOLIDUS, L_ROCK, RHO_ROCK, C_ROCK,
  OUTGAS_EARTH, PCO2_REF,
} from './constants.js';
import { psat, latentVap, co2FrostPoint } from './thermo.js';
import { LWCache, SWCache } from './radcache.js';
import { lookupAlbedo, TILE } from './shortwave.js';
import { STAR_TYPES, lumFactor, xuvRatio } from './star.js';
import { buildHeightMap, downsample } from './terrain.js';

export const NB = 36;
const DEG = Math.PI / 180;
const L_CO2 = 5.9e5;                 // J/kg CO2 sublimation
const XUV_EARTH = 4.6e-3;            // W/m2 present solar XUV at 1 AU
const TAU_DEEP = 1500;               // yr, deep ocean ventilation for a 3.7 km ocean
const ALK = 2.3e-3;                  // mol/L ocean alkalinity (carbonate system capacity)
const P_HALF = 6e-5;                 // bar, saturation of the carbonate buffer

// Tunable model constants (calibrated in tests/calibrate_ebm.mjs)
export const TUNE = {
  D0: 0.30,           // W/m2/K dry heat-transport coefficient for an Earth-like planet
  Dlock: 0.55,        // dry coefficient for tidally locked (substellar) geometry
  cloudF: 0.62,
  cloudTau: 4.3,
  cloudDT: 11.5,        // K, cloud-top temperature below clear-sky emission temperature
  W0: 0.034,          // mol/m2/yr land-weathering coefficient (per m2 of ice-free land at 288 K)
  seafloorFrac: 0.1,
  hML: 50,            // m ocean mixed layer
  iceT: 262,
  evapF: 0.75,
  stLo: 0.15,
  stHi: 0.45,
  evapTau: 12,
  evapDT: 12,
  gradRef: 45,
  gradExp: 1.0,
  snowSeaMax: 0.5,
  iceW: 4,
  cloudTauMin: 0.7,
};

function logistic(x) { return 1 / (1 + Math.exp(-x)); }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

export const DEFAULT_PARAMS = {
  massE: 1.0,
  waterEO: 1.0,
  instellation: 1.0,
  starType: 'G',
  ageGyr: 4.57,
  stellarEvolution: false,
  rotationHours: 24,
  tidallyLocked: false,
  obliquity: 23.44,
  pN2: 0.78, pO2: 0.21, pCO2: 280e-6, pCH4: 1.8e-6, pH2: 0, pSO2: 0,
  outgassing: 1.0,
  tectonics: 'plate',
  weathering: true,
  biosphere: true,
  relief: 1.0,
  seed: 7,
  crustCarbonBar: 60,
};

export class ClimateModel {
  constructor(params = {}, heightMap = null) {
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.lw = new LWCache();
    this.sw = new SWCache();
    this.ev = {};
    this.events = [];
    this.hm = heightMap; // {W,H,data} Earth-normalised km
    this._init();
  }

  // ------------------------------------------------------------------ setup
  _init() {
    const p = this.p;
    this._setPlanet();
    this._setGrid();
    this._setTerrain();
    const s = this.s = {
      t: 0,
      age: p.ageGyr,
      T: new Float64Array(NB),
      Td: 277,
      W: p.waterEO * OCEAN_EARTH / this.area,      // kg/m2 total water
      ice: new Float64Array(NB),                    // land ice kg/m2 (of band area)
      co2ice: new Float64Array(NB),                 // mol/m2 (of band area)
      n: { N2: 0, O2: 0, CH4: 0, H2: 0, SO2: 0 },
      nCO2: 0,                                      // atmospheric CO2 mol/m2
      Cexo: 0, Ccrust: 0,
      Tstrat: 200,
      lifeOn: p.biosphere,
      o2Target: p.pO2, ch4Target: p.pCH4,
      lostWater: 0, lostH: 0,
    };
    // initial temperatures: rough radiative guess
    const Te = Math.pow(p.instellation * S_EARTH * 0.7 / 4 / SIGMA, 0.25);
    for (let i = 0; i < NB; i++) s.T[i] = clamp(Te + 33 + 30 * (Math.cos(this.lat[i]) - 0.6), 150, 330);
    s.Td = clamp(Te + 20, 271.5, 300);
    this.setGases({ N2: p.pN2, O2: p.pO2, CH4: p.pCH4, H2: p.pH2, SO2: p.pSO2, CO2: p.pCO2 }, true);
    s.Ccrust = p.crustCarbonBar * 1e5 / (G_EARTH * MOLAR.CO2); // mol/m2 (Earth-equivalent bars)
    this.dtLast = 1;
    this.diag = this._emptyDiag();
    // spin up quickly to the fast-equilibrium (energy only); humidity starts from the actual
    // surface-water distribution (a dry world must not spin up with Earth-like humidity)
    this._refreshHydro();
    {
      const wet0 = Math.min(0.75, this._oceanCover());
      this._wet = wet0;
      this._rh = clamp(0.1 + 0.67 * Math.sqrt(clamp(wet0 / 0.6, 0, 1)), 0.05, 0.77) * (this._avail > 0.01 ? 1 : 0.2);
    }
    for (let k = 0; k < 40; k++) this._fastStep(k < 20 ? 2 : 50, true);
    this.dtLast = 50;
  }

  _setPlanet() {
    const p = this.p;
    const M = p.massE * M_EARTH;
    const expo = p.massE < 1 ? 0.306 : 0.274;   // rocky mass–radius (Sotin et al. 2007)
    const R = R_EARTH * Math.pow(p.massE, expo);
    this.M = M; this.R = R;
    this.g = G_GRAV * M / (R * R);
    this.area = 4 * Math.PI * R * R;
    this.vesc = Math.sqrt(2 * G_GRAV * M / R);
    const st = STAR_TYPES[p.starType] || STAR_TYPES.G;
    this.Teff = st.Teff;
  }

  _setGrid() {
    const p = this.p;
    this.locked = !!p.tidallyLocked;
    const lat = new Float64Array(NB), xe = new Float64Array(NB + 1), a = new Float64Array(NB);
    for (let i = 0; i <= NB; i++) xe[i] = Math.sin((-90 + 180 * i / NB) * DEG);
    for (let i = 0; i < NB; i++) { lat[i] = (-90 + 180 * (i + 0.5) / NB) * DEG; a[i] = (xe[i + 1] - xe[i]) / 2; }
    this.lat = lat; this.xe = xe; this.a = a;
    this.xc = Float64Array.from(lat, l => Math.sin(l));
    this._setInsolation();
  }

  /** Annual-mean insolation distribution q_i (global mean = 1/4) and insolation-weighted mu. */
  _setInsolation() {
    const q = new Float64Array(NB), mu = new Float64Array(NB);
    if (this.locked) {
      for (let i = 0; i < NB; i++) {
        let s1 = 0, s2 = 0, n = 0;
        for (let k = 0; k < 20; k++) {
          const l = (-90 + 180 * (i + (k + 0.5) / 20) / NB) * DEG;
          const x = Math.sin(l), w = Math.cos(l);
          s1 += w * Math.max(0, x); s2 += w * Math.max(0, x) ** 2; n += w;
        }
        q[i] = s1 / n; mu[i] = s1 > 0 ? s2 / s1 : 0.5;
      }
    } else {
      const eps = this.p.obliquity * DEG;
      for (let i = 0; i < NB; i++) {
        let s1 = 0, s2 = 0, n = 0;
        for (let k = 0; k < 8; k++) {
          const phi = (-90 + 180 * (i + (k + 0.5) / 8) / NB) * DEG;
          const w = Math.cos(phi);
          let qi = 0, qq = 0;
          const NL = 72;
          for (let m = 0; m < NL; m++) {
            const lam = 2 * Math.PI * (m + 0.5) / NL;
            const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
            const A = Math.sin(phi) * Math.sin(dec), B = Math.cos(phi) * Math.cos(dec);
            let h0;
            const c = -A / (B || 1e-12);
            if (c >= 1) h0 = 0; else if (c <= -1) h0 = Math.PI; else h0 = Math.acos(c);
            const I1 = (A * h0 + B * Math.sin(h0)) / Math.PI;                 // daily mean mu (incl. night)
            const I2 = (A * A * h0 + 2 * A * B * Math.sin(h0) + B * B * (h0 / 2 + Math.sin(2 * h0) / 4)) / Math.PI;
            qi += I1; qq += I2;
          }
          s1 += w * qi / NL; s2 += w * qq / NL; n += w;
        }
        q[i] = s1 / n; mu[i] = s1 > 1e-9 ? s2 / s1 : 0.3;
      }
    }
    // normalise global mean to 1/4
    let gm = 0;
    for (let i = 0; i < NB; i++) gm += q[i] * this.a[i];
    for (let i = 0; i < NB; i++) q[i] *= 0.25 / gm;
    this.qIns = q; this.muIns = mu;
  }

  _setTerrain() {
    const p = this.p;
    let W = 192, H = 96, data;
    if (this.hm) { W = this.hm.W; H = this.hm.H; data = this.hm.data; }
    else data = buildHeightMap(p.seed, W, H);
    // per-band sorted heights (km) with weights; band assignment by latitude or substellar latitude
    const scale = 1000 * p.relief * (G_EARTH / this.g); // km -> m with relief and gravity scaling
    const cells = [];
    for (let j = 0; j < H; j++) {
      const la = Math.PI / 2 - (j + 0.5) / H * Math.PI;
      const w = Math.cos(la);
      for (let i = 0; i < W; i++) {
        const lo = (i + 0.5) / W * 2 * Math.PI - Math.PI;
        const x = this.locked ? Math.cos(la) * Math.cos(lo) : Math.sin(la);
        let b = Math.floor((Math.asin(clamp(x, -1, 1)) / DEG + 90) / 180 * NB);
        b = clamp(b, 0, NB - 1);
        cells.push([data[j * W + i] * scale, w, b]);
      }
    }
    const tot = cells.reduce((s, c) => s + c[1], 0);
    // global sorted with prefix sums
    cells.sort((u, v) => u[0] - v[0]);
    const n = cells.length;
    const hs = new Float64Array(n), cw = new Float64Array(n + 1), ch = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) {
      hs[k] = cells[k][0];
      cw[k + 1] = cw[k] + cells[k][1] / tot;
      ch[k + 1] = ch[k] + cells[k][1] / tot * cells[k][0];
    }
    this.hyp = { hs, cw, ch, n };
    // per band
    const bands = [];
    for (let b = 0; b < NB; b++) bands.push({ h: [], w: [] });
    for (const c of cells) { bands[c[2]].h.push(c[0]); bands[c[2]].w.push(c[1]); }
    this.bandHyp = bands.map(B => {
      const t = B.w.reduce((s, x) => s + x, 0) || 1;
      const h = Float64Array.from(B.h);
      const cwb = new Float64Array(h.length + 1);
      for (let k = 0; k < h.length; k++) cwb[k + 1] = cwb[k] + B.w[k] / t;
      return { h, cw: cwb };
    });
    this.hMin = hs[0]; this.hMax = hs[n - 1];
  }

  // ------------------------------------------------------------------ composition
  /** Set dry-gas partial pressures (bar). keys: N2,O2,CO2,CH4,H2,SO2. */
  setGases(pp, all = false) {
    const s = this.s, g = this.g;
    if (all) {
      const ptot = Object.values(pp).reduce((a, b) => a + Math.max(0, b), 0) * 1e5;
      let Mm = 0;
      for (const k in pp) Mm += Math.max(0, pp[k]) * 1e5 / Math.max(ptot, 1e-9) * MOLAR[k];
      if (ptot <= 0) Mm = MOLAR.N2;
      for (const k in pp) {
        const nmol = Math.max(0, pp[k]) * 1e5 / (g * Mm);
        if (k === 'CO2') s.nCO2 = nmol; else s.n[k] = nmol;
      }
    } else {
      for (const k in pp) {
        // solve for moles of gas k giving partial pressure pp[k] with others fixed
        const target = Math.max(0, pp[k]) * 1e5;
        let nO = 0, mO = 0;
        for (const j in s.n) if (j !== k) { nO += s.n[j]; mO += s.n[j] * MOLAR[j]; }
        if (k !== 'CO2') { nO += s.nCO2; mO += s.nCO2 * MOLAR.CO2; }
        const Mk = MOLAR[k];
        const A = g * Mk, B = g * mO - target, C = -target * nO;
        const nk = A > 0 ? (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A) : 0;
        if (k === 'CO2') s.nCO2 = nk; else s.n[k] = nk;
      }
    }
    if ('CO2' in pp) {
      const pc = this.partials().CO2 / 1e5;
      s.Cexo = s.nCO2 + this._oceanCarbon(pc);
    }
    if ('O2' in pp) s.o2Target = pp.O2;
    if ('CH4' in pp) s.ch4Target = pp.CH4;
    this.lw.key = '';
  }

  /** Dry partial pressures in Pa. */
  partials() {
    const s = this.s, g = this.g;
    let N = s.nCO2, m = s.nCO2 * MOLAR.CO2;
    for (const k in s.n) { N += s.n[k]; m += s.n[k] * MOLAR[k]; }
    const pd = g * m;
    const out = { CO2: N > 0 ? s.nCO2 / N * pd : 0 };
    for (const k in s.n) out[k] = N > 0 ? s.n[k] / N * pd : 0;
    out.total = pd;
    out.M = N > 0 ? m / N : MOLAR.N2;
    return out;
  }

  _oceanCarbon(pCO2bar) {
    // dissolved inorganic carbon (mol/m2): Henry's law + alkalinity-limited carbonate buffer
    const L = this._liquid ?? this.s.W;
    if (L <= 0) return 0;
    const Td = this.s.Td;
    const KH = 0.034 * Math.exp(2400 * (1 / Td - 1 / 298.15));  // mol/L/atm
    const p = Math.max(0, pCO2bar);
    return L * (KH * p / 1.01325 + ALK * p / (p + P_HALF));
  }

  /** Re-partition exogenic carbon between atmosphere and ocean. */
  _partitionCarbon() {
    const s = this.s, g = this.g;
    let nO = 0, mO = 0;
    for (const k in s.n) { nO += s.n[k]; mO += s.n[k] * MOLAR[k]; }
    const pOf = (nc) => { const N = nO + nc; return N > 0 ? nc / N * g * (mO + nc * MOLAR.CO2) / 1e5 : 0; };
    let lo = 0, hi = Math.max(0, s.Cexo);
    for (let it = 0; it < 50; it++) {
      const mid = 0.5 * (lo + hi);
      const f = mid + this._oceanCarbon(pOf(mid)) - s.Cexo;
      if (f > 0) hi = mid; else lo = mid;
      if (hi - lo < 1e-9 * (s.Cexo + 1e-12)) break;
    }
    s.nCO2 = 0.5 * (lo + hi);
  }

  // ------------------------------------------------------------------ hydrology helpers
  /** Sea level (m) for a liquid-water global-equivalent depth D (m). */
  _seaLevel(D) {
    const { hs, cw, ch, n } = this.hyp;
    if (D <= 0) return this.hMin - 1;
    // V(l) = l*W(l) - H(l), monotonic in l
    let lo = 0, hi = n; // find k with V(hs[k]) <= D < V(hs[k+1])
    const V = (k) => hs[k] * cw[k] - ch[k];
    if (V(n - 1) + (hs[n - 1] - hs[n - 1]) < D) {
      // above highest point: everything flooded
      const l = (D + ch[n]) / cw[n];
      return l;
    }
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (V(mid) <= D) lo = mid; else hi = mid; }
    // within [hs[lo], hs[lo+1]] the covered fraction is cw[lo+1]
    const Wc = cw[lo + 1], Hc = ch[lo + 1];
    return (D + Hc) / Wc;
  }

  _refreshHydro() {
    const s = this.s;
    let iceTot = 0;
    for (let i = 0; i < NB; i++) iceTot += this.a[i] * s.ice[i];
    let co2iceTot = 0;
    for (let i = 0; i < NB; i++) co2iceTot += this.a[i] * s.co2ice[i];
    this.co2iceTot = co2iceTot;
    const avail = Math.max(0, s.W - iceTot);
    this._avail = avail;
    const vap = this.diag?.vapor ?? 0;
    const liquid = Math.max(0, avail - vap);
    this._liquid = liquid;
    const D = liquid / RHO_WATER;
    const sl = this._seaLevel(D);
    this.seaLevel = sl;
    const fo = new Float64Array(NB);
    for (let b = 0; b < NB; b++) {
      const B = this.bandHyp[b];
      let lo = 0, hi = B.h.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (B.h[m] < sl) lo = m + 1; else hi = m; }
      fo[b] = B.cw[lo];
    }
    this.fOcean = fo;
    // seafloor pressure (high-pressure ice threshold ~1 GPa; Kite & Ford 2018)
    const maxDepth = Math.max(0, sl - this.hMin);
    const meanDepth = D / Math.max(1e-6, fo.reduce((acc, f, i) => acc + f * this.a[i], 0));
    this.oceanDepth = liquid > 0 ? meanDepth : 0;
    this.seafloorP = RHO_WATER * this.g * meanDepth;
    this.hpIce = this.seafloorP > 1.0e9;
    this.maxDepth = maxDepth;
  }

  // ------------------------------------------------------------------ star
  instellation() {
    const p = this.p;
    if (!p.stellarEvolution) return p.instellation;
    return p.instellation * lumFactor(p.starType, this.s.age) / lumFactor(p.starType, p.ageGyr);
  }
  xuvFlux() {
    // W/m2 at the planet
    const p = this.p;
    return this.instellation() * S_EARTH * xuvRatio(p.starType, this.s.age);
  }

  // ------------------------------------------------------------------ main step
  _emptyDiag() {
    return {
      Tmean: 0, Tmin: 0, Tmax: 0, olr: 0, asr: 0, albedo: 0, vapor: 0, pS: 0, pv: 0,
      xStrat: 0, escH: 0, iceFrac: 0, oceanFrac: 0, landIceFrac: 0, seaIceFrac: 0,
      cloudFrac: 0, weath: 0, outgas: 0, Tsurf: new Float64Array(NB), tauS: 0, tauH: 0,
      imbalance: 0, rgbAtm: [0, 0, 0], precip: new Float64Array(NB), evap: new Float64Array(NB),
      fc: new Float64Array(NB), tc: new Float64Array(NB), seaIce: new Float64Array(NB),
      snow: new Float64Array(NB), D: new Float64Array(NB + 1),
    };
  }

  /** Composition object for the radiation code. */
  _comp() {
    const s = this.s, pp = this.partials();
    const pd = { N2: pp.N2, O2: pp.O2, CO2: pp.CO2, CH4: pp.CH4, H2: pp.H2, SO2: pp.SO2 };
    // surface vapour pressure if all available (non-ice) water were vapour
    const W = this._avail ?? s.W;
    let nd = 0, md = 0;
    for (const k in s.n) { nd += s.n[k]; md += s.n[k] * MOLAR[k]; }
    nd += s.nCO2; md += s.nCO2 * MOLAR.CO2;
    const nv = W / MOLAR.H2O;
    const pTot = this.g * (md + W);
    const pvCap = nv + nd > 0 ? nv / (nv + nd) * pTot : 0;
    let Tmx = 0;
    for (let i = 0; i < NB; i++) Tmx = Math.max(Tmx, s.T[i]);
    const relevant = pvCap < 20 * psat(Tmx + 25);
    return { g: this.g, pd, pvCap: relevant ? Math.max(pvCap, 1e-6) : 1e30, pvCapRelevant: relevant, rh: this._rh ?? 0.77, Tstrat: s.Tstrat, pdry: pp.total, Mdry: pp.M };
  }

  /**
   * Fast (energy) step of length dt years, implicit. Returns max |dT|.
   * When `energyOnly`, slow processes are not advanced (used for spin-up).
   */
  _fastStep(dt, energyOnly = false) {
    const s = this.s, p = this.p, a = this.a, d = this.diag;
    const dts = dt * YEAR;
    const comp = this._comp();
    this.lw.setComposition(comp);
    const lw = this.lw;
    const S = this.instellation() * S_EARTH;

    // ---------------- global properties
    const pp = this.partials();
    const pdry = pp.total;
    let Tg = 0;
    for (let i = 0; i < NB; i++) Tg += a[i] * s.T[i];
    const ev = {};
    lw.eval(Tg, ev);
    const pS = pdry + ev.pv;
    const xvs = ev.pv / Math.max(pS, 1);
    // heat capacity of air
    const qv = xvs * MOLAR.H2O / (xvs * MOLAR.H2O + (1 - xvs) * pp.M);
    let cpDry = 0, mt = 0;
    for (const k of ['N2', 'O2', 'CO2', 'CH4', 'H2', 'SO2']) { const m = (k === 'CO2' ? s.nCO2 : s.n[k]) * MOLAR[k]; cpDry += m * CP[k]; mt += m; }
    cpDry = mt > 0 ? cpDry / mt : 1004;
    const cpAir = qv * CP.H2O + (1 - qv) * cpDry;
    const Catm = cpAir * pS / this.g;

    // fraction of dry land that is dusty regolith (little water ever available)
    {
      const EOa = 2.745e6 * (5.1e14 / this.area);
      this._regolith = 1 - smooth(0.002, 0.05, s.W / EOa);
    }
    // ---------------- post-runaway indicator (no liquid ocean left in a steam atmosphere)
    {
      const avail = this._avail ?? 0;
      const target = avail > 1000 ? 1 - smooth(0.0, 0.03, (this._liquid ?? 0) / avail) : 0;
      this._steamPost = this._steamPost === undefined ? target : this._steamPost + (target - this._steamPost) * (1 - Math.exp(-dt / 20));
    }
    // ---------------- sulfuric deck and haze
    const ppSO2 = pp.SO2 || 0;
    const tauS = (Tg > 380 && this._liquid < 1) ? 30 * Math.min(1, Math.sqrt(ppSO2 / 2000)) * smooth(1e-7, 1e-5, xvs + 1e-9) : 0;
    const rCH4 = (pp.CH4 || 0) / Math.max(pp.CO2 || 0, 1e-3);
    const tauH = 3 * smooth(0.1, 1.0, rCH4) * Math.min(1, Math.sqrt((pp.CH4 || 0) / 100));
    d.tauS = tauS; d.tauH = tauH;

    // ---------------- shortwave table
    const cloudLayer = 5; // fixed placement (0.35–0.5 ps); avoids discontinuous albedo jumps
    const swt = this.sw.update({ comp, Tglob: Tg, Teff: this.Teff, tauS, tauH, cloudLayer }, lw.key);
    d.rgbAtm = swt.rgbAtm;

    // ---------------- clouds are evaluated inside the implicit solve (see _clouds)
    const fo = this.fOcean;
    const rotDays = p.rotationHours / 24;
    this._slowRot = this.locked ? 0 : smooth(0, 1, Math.log10(Math.max(rotDays, 1) / 2) / Math.log10(50));
    const fc = d.fc, tc = d.tc;

    // ---------------- band heat capacities
    const Cml = C_WATER * RHO_WATER * Math.min(TUNE.hML, Math.max(1, this._liquid / RHO_WATER / Math.max(0.05, this._oceanCover())));
    const kappaRock = 1e-6;
    const dRock = Math.min(1000, Math.sqrt(kappaRock * Math.min(dts, 3e4 * YEAR)));
    const C = new Float64Array(NB), Clat = new Float64Array(NB);
    const liquidAvail = this._liquid > 1 ? 1 : 0;
    for (let i = 0; i < NB; i++) {
      const Ti = s.T[i];
      const si = this._seaIce(Ti);
      let Cl = 4e6 + RHO_ROCK * C_ROCK * dRock;
      if (Ti > T_SOLIDUS - 100) Cl += RHO_ROCK * dRock * L_ROCK / 450 * smooth(T_SOLIDUS - 100, T_SOLIDUS, Ti);
      C[i] = Catm + fo[i] * ((1 - si) * Cml + si * 0.12 * Cml) + (1 - fo[i]) * Cl;
      if (liquidAvail || this._avail > 1) {
        lw.eval(Ti, ev);
        const Lv = Math.max(latentVap(Math.min(Ti, 640)), 2e5);
        Clat[i] = Math.max(0, (Lv + C_WATER * Math.max(0, Ti - s.Td)) * ev.dcol);
      }
    }

    // ---------------- heat transport coefficients at interfaces
    const D = d.D;
    // transport scales with atmospheric column mass (p/g), heat capacity and molecular weight
    // (Williams & Kasting 1997, with column mass instead of pressure)
    const rhoFac = (pS / this.g) / (1e5 / G_EARTH) * (cpAir / 1004) * Math.pow(0.029 / Math.max(pp.M, 0.002), 2);
    let rot = 1;
    if (!this.locked) rot = clamp(Math.pow(24 / Math.max(p.rotationHours, 1), -0.8), 0.25, 6);
    // Baroclinic-eddy diffusivity grows with the large-scale temperature contrast (Stone 1978;
    // Held 1999), which keeps total poleward transport nearly invariant across climates as in GCMs.
    let hot = 0, cold = 0, wh = 0, wc = 0;
    for (let i = 0; i < NB; i++) {
      const x = Math.abs(this.xc[i]);
      if (this.locked ? this.xc[i] > 0.5 : x < 0.5) { hot += a[i] * s.T[i]; wh += a[i]; }
      if (this.locked ? this.xc[i] < -0.3 : x > 0.866) { cold += a[i] * s.T[i]; wc += a[i]; }
    }
    const contrast = Math.max(1, hot / wh - cold / wc);
    const gTarget = clamp(Math.pow(contrast / TUNE.gradRef, TUNE.gradExp), 0.4, 2.5);
    s.gradFac = s.gradFac === undefined ? gTarget : s.gradFac + (gTarget - s.gradFac) * (1 - Math.exp(-dt / 5));
    const Dbase = (this.locked ? TUNE.Dlock : TUNE.D0) * rhoFac * rot * s.gradFac;
    const wet = this._wet ?? 0.6;
    D[0] = 0; D[NB] = 0;
    for (let k = 1; k < NB; k++) {
      const Tm = 0.5 * (s.T[k - 1] + s.T[k]);
      const qs = Math.min(1, 0.622 * psat(Tm) / Math.max(pS, 1));
      const Lv = latentVap(Math.min(Tm, 640));
      const dqs = qs * Lv / (461.5 * Tm * Tm);
      const beta = Math.min(40, (Lv / cpAir) * dqs * (this._rh ?? 0.77) * wet);
      let Dk = Dbase * (1 + beta);
      Dk = Dk / (1 + Dk / 60);
      D[k] = Dk;
      this._beta = this._beta || new Float64Array(NB + 1);
      this._beta[k] = beta;
    }

    // ---------------- deep ocean exchange weights
    const gam = new Float64Array(NB);
    const oceanCov = this._oceanCover();
    let Cdeep = 0;
    if (this._liquid > 1 && oceanCov > 0.001) {
      const deepMass = Math.max(0, this._liquid - RHO_WATER * TUNE.hML * oceanCov);
      Cdeep = C_WATER * deepMass;
      let Tmin = 1e9;
      for (let i = 0; i < NB; i++) if (fo[i] > 0.02) Tmin = Math.min(Tmin, Math.max(s.T[i], 271));
      let wsum = 0;
      // exchange only through open (ice-free) ocean; deep water forms near the ice edge
      for (let i = 0; i < NB; i++) {
        const open = fo[i] * (1 - this._seaIce(s.T[i])) * (s.T[i] > 271.2 ? 1 : 0);
        gam[i] = open * Math.exp(-(Math.max(s.T[i], 271) - Tmin) / 3); wsum += a[i] * gam[i];
      }
      const gtot = C_WATER * RHO_WATER * 3700 / (TAU_DEEP * YEAR) * oceanCov; // W/m2/K per planet area
      for (let i = 0; i < NB; i++) gam[i] = wsum > 0 ? gam[i] * gtot / wsum : 0;
    }

    // ---------------- Newton iterations
    const Told = Float64Array.from(s.T);
    const T = s.T;
    const rhs = new Float64Array(NB), diag_ = new Float64Array(NB), lo = new Float64Array(NB), up = new Float64Array(NB);
    const xe = this.xe, xcn = this.xc;
    const muI = this.muIns, qI = this.qIns;
    const out1 = {}, out2 = {};
    let asrTot = 0, olrTot = 0;
    const ASR = new Float64Array(NB), OLR = new Float64Array(NB);
    for (let it = 0; it < 8; it++) {
      let maxUpd = 0;
      for (let i = 0; i < NB; i++) {
        const Ti = T[i];
        const Ceff = C[i] + Clat[i];
        const F0 = this._netFlux(i, Ti, S * qI[i], muI[i], swt, tauS, out1, false);
        const F1 = this._netFlux(i, Ti + 0.5, S * qI[i], muI[i], swt, tauS, out2, false);
        const dF = (F1 - F0) / 0.5;
        ASR[i] = out1.asr; OLR[i] = out1.olr;
        // diffusion coefficients (x-space)
        const dxl = i > 0 ? xcn[i] - xcn[i - 1] : 1, dxr = i < NB - 1 ? xcn[i + 1] - xcn[i] : 1;
        const wid = 2 * a[i];
        const cl = i > 0 ? D[i] * (1 - xe[i] * xe[i]) / dxl / wid : 0;
        const cr = i < NB - 1 ? D[i + 1] * (1 - xe[i + 1] * xe[i + 1]) / dxr / wid : 0;
        const div = (i > 0 ? cl * (T[i - 1] - Ti) : 0) + (i < NB - 1 ? cr * (T[i + 1] - Ti) : 0);
        const res = Ceff * (Ti - Told[i]) / dts - (F0 + div + gam[i] * (s.Td - Ti) + 0.09);
        rhs[i] = -res;
        diag_[i] = Ceff / dts - dF + cl + cr + gam[i];
        lo[i] = -cl; up[i] = -cr;
      }
      // tridiagonal solve
      const cp = new Float64Array(NB), dp = new Float64Array(NB);
      cp[0] = up[0] / diag_[0]; dp[0] = rhs[0] / diag_[0];
      for (let i = 1; i < NB; i++) {
        const m = diag_[i] - lo[i] * cp[i - 1];
        cp[i] = up[i] / m; dp[i] = (rhs[i] - lo[i] * dp[i - 1]) / m;
      }
      const dx = new Float64Array(NB);
      dx[NB - 1] = dp[NB - 1];
      for (let i = NB - 2; i >= 0; i--) dx[i] = dp[i] - cp[i] * dx[i + 1];
      for (let i = 0; i < NB; i++) {
        const u = clamp(dx[i], -25, 25);
        T[i] = clamp(T[i] + u, 20, 6000);
        maxUpd = Math.max(maxUpd, Math.abs(u));
      }
      if (maxUpd < 0.005) break;
    }
    // final diagnostics at converged state
    asrTot = 0; olrTot = 0;
    for (let i = 0; i < NB; i++) {
      this._netFlux(i, T[i], S * qI[i], muI[i], swt, tauS, out1, false);
      ASR[i] = out1.asr; OLR[i] = out1.olr;
      fc[i] = out1.fc; tc[i] = out1.tc;
      asrTot += a[i] * out1.asr; olrTot += a[i] * out1.olr;
    }
    {
      let ac = 0, oc = 0;
      for (let i = 0; i < NB; i++) {
        this._netFlux(i, T[i], S * qI[i], muI[i], swt, tauS, out2, true);
        ac += a[i] * out2.asr; oc += a[i] * out2.olr;
      }
      d.asrClear = ac; d.olrClear = oc;
    }
    // deep ocean (implicit)
    if (Cdeep > 0) {
      let sg = 0, sgt = 0;
      for (let i = 0; i < NB; i++) { sg += a[i] * gam[i]; sgt += a[i] * gam[i] * T[i]; }
      s.Td = (Cdeep * s.Td / dts + sgt) / (Cdeep / dts + sg);
      if (s.Td < 271.2) s.Td = 271.2;
    } else {
      let Tm = 0; for (let i = 0; i < NB; i++) Tm += a[i] * T[i];
      s.Td = Tm;
    }

    // CO2 condensation thermostat (atmospheric collapse / CO2 ice caps)
    if (!energyOnly) this._co2Condense(C, Clat);

    let maxdT = 0;
    for (let i = 0; i < NB; i++) maxdT = Math.max(maxdT, Math.abs(T[i] - Told[i]));

    // ---------------- diagnostics
    let Tm = 0, Tmin = 1e9, Tmax = 0, vap = 0, xs = 0, wsum = 0;
    for (let i = 0; i < NB; i++) {
      Tm += a[i] * T[i]; Tmin = Math.min(Tmin, T[i]); Tmax = Math.max(Tmax, T[i]);
      lw.eval(T[i], ev);
      vap += a[i] * ev.col;
    }
    // stratospheric water: cold trap above the warmest third of the planet
    const order = Array.from(T.keys()).sort((u, v) => T[v] - T[u]);
    let acc = 0;
    for (const i of order) { if (acc > 0.33) break; lw.eval(T[i], ev); xs += a[i] * ev.xs; wsum += a[i]; acc += a[i]; }
    d.xStrat = xs / Math.max(wsum, 1e-9);
    d.Tmean = Tm; d.Tmin = Tmin; d.Tmax = Tmax;
    d.asr = asrTot; d.olr = olrTot; d.imbalance = asrTot - olrTot;
    d.albedo = 1 - asrTot / (S / 4);
    d.vapor = Math.min(vap, this._avail ?? vap);
    // above the critical point (or once the inventory cap binds) all available water is vapour;
    // avoids table-quantisation "phantom" oceans in hot steam atmospheres
    if (Tmin > 640 || (comp.pvCapRelevant && vap > 0.93 * (this._avail ?? 0) && Tm > 500)) d.vapor = this._avail ?? d.vapor;
    lw.eval(Tm, ev);
    d.pv = ev.pv; d.pS = pdry + ev.pv; d.Catm = Catm;
    d.Tsurf.set(T);
    d.cpAir = cpAir;
    // stratospheric temperature: ~0.79 Te, relaxed with hysteresis to avoid table churn
    const TsTarget = clamp(0.79 * Math.pow(Math.max(olrTot, 1) / SIGMA, 0.25), 100, 260);
    if (Math.abs(TsTarget - s.Tstrat) > 1.0) s.Tstrat += (TsTarget - s.Tstrat) * (1 - Math.exp(-dt / 3));
    this.ASR = ASR; this.OLR = OLR;
    this._Cband = C; this._Clat = Clat;
    return maxdT;
  }

  _oceanCover() { let c = 0; for (let i = 0; i < NB; i++) c += this.a[i] * this.fOcean[i]; return c; }

  // Annual-mean ice/snow cover: the broad transition stands in for seasonal partial cover
  // (seasonal ice zone), which suppresses the spurious small-ice-cap instability of
  // annual-mean energy-balance models.
  // (asymmetric: broad seasonal tail on the warm side, essentially complete cover once the
  // annual mean is well below freezing)
  _seaIce(T) { const x = TUNE.iceT - T; return logistic(x / (x > 0 ? TUNE.iceW * 0.45 : TUNE.iceW)); }
  _snowLand(T) { const x = TUNE.iceT - T; return logistic(x / (x > 0 ? TUNE.iceW * 0.5 : TUNE.iceW + 0.5)); }

  /** Cloud fraction, visible optical depth and cloud-top offset for band i at temperature T. */
  _clouds(i, T, ev, out) {
    const colRel = ev.col / 25;
    // clouds thin only when the column is genuinely dry (snowball-cold); storm tracks and
    // polar regions are cloudier than the subtropics (ISCCP/CERES climatology)
    const dry = Math.sqrt(clamp(ev.col / 0.6, 0, 1));
    const zonal = this.locked ? 1 : 0.85 + 0.3 * Math.abs(this.xc[i]);
    // essentially no condensate clouds in a column with < ~0.02 kg/m2 of water (e.g. Mars)
    let f = TUNE.cloudF * zonal * (0.45 + 0.55 * dry) * smooth(0.002, 0.05, ev.col);
    let tau = TUNE.cloudTau * clamp(Math.pow(colRel, 0.25), TUNE.cloudTauMin * dry + 0.2, 2.0);
    let dT = TUNE.cloudDT;
    const xvb = ev.pv / Math.max(ev.ps, 1);
    const st = smooth(TUNE.stLo, TUNE.stHi, xvb);
    // Evaporation phase (ocean still present): thick, bright, rising cloud decks whose net
    // effect is a slight cooling (Chaverot et al. 2023).
    // Post-runaway steam state (no ocean): day side clears, night-side clouds trap heat, so a
    // steam atmosphere persists at insolations where it would otherwise condense
    // (Turbet et al. 2021) -> hysteresis.
    const post = this._steamPost ?? 0;
    const fS = TUNE.evapF * (1 - post) + 0.5 * post;
    const tS = TUNE.evapTau * (1 - post) + 2.5 * post;
    const dS = TUNE.evapDT * (1 - post) + 42 * post;
    f = f + (fS - f) * st; tau = tau + (tS - tau) * st; dT = dT + (dS - dT) * st;
    if (this.locked) {
      // substellar deep convection: thick, bright cloud deck (Yang, Cowan & Abbot 2013)
      const x = this.xc[i];
      const conv = smooth(0.35, 0.8, x) * smooth(268, 285, T) * (this.fOcean[i] > 0.05 ? 1 : 0.4);
      f = f + (0.9 - f) * conv; tau = tau + (28 - tau) * conv; dT = dT + (25 - dT) * conv;
      if (x < 0) { f = Math.max(f, 0.55); dT = Math.max(dT, 18); }
    } else if (this._slowRot > 0) {
      // slow rotators develop a similar dayside cloud shield (Yang et al. 2014)
      const conv = this._slowRot * smooth(275, 290, T);
      f = f + (0.85 - f) * conv; tau = tau * (1 + 1.6 * conv);
    }
    out.fc = clamp(f, 0, 0.95); out.tc = Math.min(60, tau); out.dTc = dT; out.hi = st;
    out.ecl = 1 - Math.exp(-0.75 * out.tc);
  }

  /** Net downward flux (ASR - OLR) for band i at temperature T. */
  _netFlux(i, T, Sb, mu, swt, tauS, out, clearSky) {
    const s = this.s, fo = this.fOcean[i];
    const ev = this._ev || (this._ev = {});
    this.lw.eval(T, ev);
    let fc = 0, tauC = 0, ecl = 0, dTc = 0, hiW = 0;
    if (!clearSky) {
      const cl = this._cl || (this._cl = {});
      this._clouds(i, T, ev, cl);
      fc = cl.fc; tauC = cl.tc; ecl = cl.ecl; dTc = cl.dTc; hiW = cl.hi;
    }
    // ---- surface tile fractions
    const si = this._seaIce(T);
    // snow on sea ice: summer melt (wet snow, melt ponds) darkens ice in today's polar seas;
    // in a deep freeze the snow stays dry and bright where precipitation exceeds sublimation
    const meltF = TUNE.snowSeaMax + (1 - TUNE.snowSeaMax) * smooth(250, 236, T);
    const snowOnSea = (this._snowCov ? this._snowCov[i] : 0.7) * meltF;
    const landF = 1 - fo;
    const iceSheet = landF > 1e-6 ? 1 - Math.exp(-s.ice[i] / (landF * 1e4)) : 0;
    const co2c = s.co2ice[i] > 0 ? 1 - Math.exp(-s.co2ice[i] / 50) : 0;
    // seasonal snow needs a supply of precipitation (none on bone-dry worlds like Mars)
    const supply = this._snowSupply ? this._snowSupply[i] : 1;
    const snowL = Math.max(iceSheet, this._snowLand(T) * supply);
    const arid = this._arid ? this._arid[i] : 0.3;
    const lava = smooth(800, 1100, T);
    const fOpen = fo * (1 - si), fSea = fo * si;
    const fLandSnow = landF * snowL, fLandBare = landF * (1 - snowL);
    let A0 = 0, A1 = 0;
    const tiles = this._tiles || (this._tiles = [[0, TILE.ocean], [0, TILE.snow], [0, TILE.seaice], [0, TILE.snow], [0, TILE.land], [0, TILE.desert], [0, TILE.lava], [0, TILE.regolith]]);
    // water-poor worlds have dark oxidised regolith rather than bright aeolian sand
    const regol = this._regolith ?? 0;
    tiles[0][0] = fOpen; tiles[1][0] = fSea * snowOnSea; tiles[2][0] = fSea * (1 - snowOnSea);
    tiles[3][0] = fLandSnow; tiles[4][0] = fLandBare * (1 - lava) * (1 - arid);
    tiles[5][0] = fLandBare * (1 - lava) * arid * (1 - regol); tiles[6][0] = fLandBare * lava;
    tiles[7][0] = fLandBare * (1 - lava) * arid * regol;
    for (let k = 0; k < tiles.length; k++) {
      const f = tiles[k][0];
      if (f <= 0) continue;
      const t = tiles[k][1];
      A0 += f * lookupAlbedo(swt, mu, 0, t);
      if (fc > 0) {
        const lo = lookupAlbedo(swt, mu, tauC, t);
        A1 += f * (hiW > 0 ? lo + (lookupAlbedo(swt, mu, tauC, t, true) - lo) * hiW : lo);
      }
    }
    if (co2c > 0) {
      const As = lookupAlbedo(swt, mu, 0, TILE.snow), As1 = lookupAlbedo(swt, mu, tauC, TILE.snow);
      A0 = A0 * (1 - co2c) + As * co2c; A1 = A1 * (1 - co2c) + As1 * co2c;
    }
    const A = (1 - fc) * A0 + fc * A1;
    const asr = Sb * (1 - A);
    // ---- longwave
    const olrC = ev.olr;
    const Te = Math.pow(Math.max(olrC, 1) / SIGMA, 0.25);
    const Tct = Math.max(ev.ttrop, Te - dTc);
    let olr = olrC - fc * ecl * Math.max(0, olrC - SIGMA * Tct ** 4);
    if (tauS > 0) {
      const eS = 1 - Math.exp(-0.5 * tauS);
      olr = olr * (1 - eS) + eS * Math.min(olr, SIGMA * ev.ttop ** 4);
    }
    out.asr = asr; out.olr = olr; out.alb = A; out.fc = fc; out.tc = tauC;
    return asr - olr;
  }

  _co2Condense(C, Clat) {
    const s = this.s, T = s.T, a = this.a;
    const pp = this.partials();
    let changed = false;
    for (let i = 0; i < NB; i++) {
      const pc = this.partials().CO2;
      const Tf = co2FrostPoint(pc);
      const Ceff = C[i] + Clat[i];
      if (T[i] < Tf && s.nCO2 > 1e-6) {
        const E = Ceff * (Tf - T[i]);                    // J/m2 deficit
        let dn = E / (L_CO2 * MOLAR.CO2);                // mol/m2 of band
        const maxGlobal = s.nCO2 * 0.5;                  // limit per step
        dn = Math.min(dn, maxGlobal / a[i]);
        s.co2ice[i] += dn;
        s.nCO2 -= dn * a[i];
        s.Cexo -= dn * a[i];
        T[i] += dn * L_CO2 * MOLAR.CO2 / Ceff;
        changed = true;
      } else if (s.co2ice[i] > 0 && T[i] > Tf) {
        const E = Ceff * (T[i] - Tf);
        let dn = Math.min(s.co2ice[i], E / (L_CO2 * MOLAR.CO2));
        s.co2ice[i] -= dn;
        s.nCO2 += dn * a[i];
        s.Cexo += dn * a[i];
        T[i] -= dn * L_CO2 * MOLAR.CO2 / Ceff;
        changed = true;
      }
    }
    if (changed) this.lw.key = this.lw.key; // composition change picked up next step
  }

  // ------------------------------------------------------------------ slow processes
  _slowStep(dt) {
    const s = this.s, p = this.p, a = this.a, d = this.diag, T = s.T;
    const yr = dt;
    const pp = this.partials();
    const pCO2bar = pp.CO2 / 1e5;
    const fo = this.fOcean;

    // ---------------- hydrological cycle
    const pS = d.pS;
    const Mair = pp.M;
    const E = d.evap, P = d.precip;
    let Etot = 0;
    const L = 2.45e6;
    const energyAv = this.ASR;
    for (let i = 0; i < NB; i++) {
      const Ti = T[i];
      const si = this._seaIce(Ti);
      const rhoA = pS * Mair / (R_GAS * Ti);
      const qs = Math.min(1, 0.622 * psat(Ti) / Math.max(pS, 1));
      let Ep = rhoA * 8.4e-3 * (1 - (this._rh ?? 0.77)) * qs;               // kg/m2/s
      Ep = Math.min(Ep, Math.max(0, 0.75 * energyAv[i] + 20) / L);
      const wetFrac = this._liquid > 1 ? fo[i] * (1 - si) + 0.1 * fo[i] * si : 0;
      const landIceSub = (1 - fo[i]) * (s.ice[i] > 1 ? 0.1 : 0);
      E[i] = Ep * (wetFrac + landIceSub);
      Etot += a[i] * E[i];
    }
    // moisture transport by the latent part of the diffusive heat flux
    const D = d.D, xe = this.xe, xc = this.xc, beta = this._beta || new Float64Array(NB + 1);
    const conv = new Float64Array(NB);
    for (let k = 1; k < NB; k++) {
      const latFrac = beta[k] / (1 + beta[k]);
      const F = -D[k] * latFrac * (1 - xe[k] * xe[k]) * (T[k] - T[k - 1]) / (xc[k] - xc[k - 1]) / L; // kg/m2/s toward +x
      // limit by available moisture in the source band
      const src = F > 0 ? k - 1 : k;
      const Fl = Math.sign(F) * Math.min(Math.abs(F), (E[src] + 1e-12) * 2 * a[src] * 4);
      conv[k - 1] -= Fl / (2 * a[k - 1]);
      conv[k] += Fl / (2 * a[k]);
    }
    let Ptot = 0;
    for (let i = 0; i < NB; i++) { P[i] = Math.max(0, E[i] + conv[i]); Ptot += a[i] * P[i]; }
    if (Ptot > 0) for (let i = 0; i < NB; i++) P[i] *= Etot / Ptot;
    // aridity (for desert albedo) and snow cover on sea ice (net accumulation vs ablation)
    if (!this._arid) { this._arid = new Float64Array(NB).fill(0.3); this._snowCov = new Float64Array(NB).fill(0.7); this._snowSupply = new Float64Array(NB).fill(1); }
    const rlx = 1 - Math.exp(-yr / 30);
    for (let i = 0; i < NB; i++) {
      const Pyr = P[i] * YEAR / 1000; // m/yr
      this._arid[i] += (clamp(1 - Pyr / 0.6, 0, 1) - this._arid[i]) * rlx;
      const net = (P[i] - E[i]) * YEAR / 1000;
      this._snowCov[i] += (clamp(0.55 + net / 0.3, 0.05, 1) - this._snowCov[i]) * rlx;
      this._snowSupply[i] += (clamp(Pyr / 0.05, 0, 1) - this._snowSupply[i]) * rlx;
    }

    // ---------------- land ice sheets
    // 1) flow between bands (thickness diffusion), 2) accumulation, melt and calving solved
    //    semi-implicitly so that arbitrarily long steps relax to the right balance.
    const iceNew = Float64Array.from(s.ice);
    for (let k = 1; k < NB; k++) {
      const i = k - 1, j = k;
      const li = Math.max(1 - fo[i], 1e-4), lj = Math.max(1 - fo[j], 1e-4);
      const hi = iceNew[i] / li / 917, hj = iceNew[j] / lj / 917;
      const hav = 0.5 * (hi + hj);
      const K = 1.2e-9 * Math.pow(hav / 2000, 2) * YEAR * yr;
      let F = K * (hi - hj);
      F = clamp(F, -0.25 * iceNew[j] * a[j] / a[i], 0.25 * iceNew[i]);
      iceNew[i] -= F; iceNew[j] += F * a[i] / a[j];
    }
    for (let i = 0; i < NB; i++) {
      const lf = 1 - fo[i];
      const Ti = T[i];
      if (lf <= 1e-4) { iceNew[i] = 0; continue; }
      const snowFrac = logistic((271 - Ti) / 3);
      const acc = P[i] * lf * snowFrac * YEAR;                       // kg/m2/yr
      const M0 = lf * 1e4;
      const Mi = Math.max(iceNew[i], 1e-9);
      const cover = 1 - Math.exp(-Mi / M0);
      // melt, plus sublimation of exposed ice into a dry atmosphere (moves ice to cold traps)
      const subl = 2.5 * psat(Math.min(Ti, 273)) * (1 - (this._rh ?? 0.5));                // kg/m2/yr
      const meltRate = (1000 * Math.exp(Math.min(30, (Ti - 273) / 4.5)) + subl) * lf * cover / Mi;   // 1/yr
      const calveRate = Math.min(1, 3 * fo[i]) / 1e4 * smooth(200, 2000, Mi / lf);      // 1/yr
      iceNew[i] = (Mi + acc * yr) / (1 + (meltRate + calveRate) * yr);
      if (iceNew[i] < 1e-6) iceNew[i] = 0;
    }
    s.ice = iceNew;

    // ---------------- carbonate–silicate cycle
    const tect = p.tectonics === 'stagnant' ? 0.25 : 1.0;
    const hp = this.hpIce ? 0.15 : 1.0;
    const outgas = OUTGAS_EARTH * p.outgassing * p.massE * tect * hp / this.area * (this.ageFactor ? this.ageFactor() : 1); // mol/m2/yr
    let weath = 0;
    if (p.weathering) {
      const life = s.lifeOn ? 1 : 0.35;
      // weathering ∝ pCO2^0.3, becoming ~linear (carbonic-acid limited) below ~10 ppm
      const pfac = Math.pow(Math.max(pCO2bar, 1e-12) / PCO2_REF, 0.3) * (pCO2bar / (pCO2bar + 1e-5)) / (PCO2_REF / (PCO2_REF + 1e-5));
      for (let i = 0; i < NB; i++) {
        const lf = 1 - fo[i];
        if (lf <= 0) continue;
        const cover = 1 - Math.exp(-s.ice[i] / (lf * 1e4));
        const free = lf * (1 - cover) * (1 - this._snowLand(T[i]) * 0.7);
        const liq = smooth(258, 276, T[i]);
        const Pr = Math.min(4, Math.pow(P[i] * YEAR / 1000 / 0.8 + 1e-6, 0.65));
        const arr = Math.exp(6050 * (1 / 288 - 1 / Math.min(T[i], 400)));
        let w = TUNE.W0 * free * liq * Pr * arr * pfac * life;
        w = Math.min(w, 40 * TUNE.W0 * lf);        // supply limit
        weath += a[i] * w;
      }
      if (this._liquid > 1 && !this.hpIce) {
        const sf = TUNE.seafloorFrac * OUTGAS_EARTH / 5.1e14 * Math.pow(Math.max(pCO2bar, 1e-9) / PCO2_REF, 0.23) *
          Math.exp(4930 * (1 / 275 - 1 / Math.max(s.Td, 250))) * Math.min(1, this._oceanCover() / 0.7) * (s.Td < 400 ? 1 : 0);
        weath += sf;
      }
    }
    // carbonate decomposition on hot surfaces
    const Tm = d.Tmean;
    const decomp = s.Ccrust / 3e6 * smooth(650, 950, Tm);
    // implicit update: weathering evaluated at the end-of-step carbon pool, W ∝ C^0.3
    // (unconditionally stable; long steps relax straight to the weathering–outgassing balance)
    const C0 = Math.max(s.Cexo, 1e-9), src = (outgas + decomp) * yr;
    let Cn;
    if (weath <= 0) Cn = C0 + src;
    else {
      let lo = 0, hi = C0 + src;
      for (let it = 0; it < 60; it++) {
        const x = 0.5 * (lo + hi);
        const f = x - C0 - src + weath * yr * Math.pow(x / C0, 0.3);
        if (f > 0) hi = x; else lo = x;
      }
      Cn = 0.5 * (lo + hi);
    }
    const weathered = C0 + src - Cn;
    s.Cexo = Cn;
    s.Ccrust = Math.max(0, s.Ccrust + weathered - decomp * yr);
    d.weath = weath; d.outgas = outgas; d.decomp = decomp;

    // ---------------- hydrogen escape & water loss
    const xs = d.xStrat;
    const Ntot = (s.nCO2 + Object.values(s.n).reduce((u, v) => u + v, 0)) + d.vapor / MOLAR.H2O;
    const xH2 = s.n.H2 / Math.max(Ntot, 1e-12), xCH4 = s.n.CH4 / Math.max(Ntot, 1e-12);
    const fH = Math.min(1, 2 * xs + 2 * xH2 + 4 * xCH4);
    const Mup = Math.max(0.004, pp.M);
    const phiDL = 2.5e17 * fH * (this.g / G_EARTH) * ((Mup - 0.002) / 0.027);
    const Fxuv = this.xuvFlux();
    const phiEL = 0.15 * Fxuv * this.R / (4 * G_GRAV * this.M * 1.674e-27);
    const phi = Math.min(phiDL, phiEL);
    d.escH = phi; d.escLimit = phiDL < phiEL ? 'diffusion' : 'energy';
    let Hlost = phi * yr * YEAR / N_A; // mol H / m2 over the step
    // allocate: H2 first, then CH4, then H2O
    const useH2 = Math.min(s.n.H2, Hlost / 2); s.n.H2 -= useH2; Hlost -= 2 * useH2;
    const useCH4 = Math.min(s.n.CH4, Hlost / 4); s.n.CH4 -= useCH4; Hlost -= 4 * useCH4;
    let waterLoss = 0;
    if (Hlost > 0) {
      waterLoss = Math.min(s.W, Hlost / 2 * MOLAR.H2O);
      s.W -= waterLoss;
      s.n.O2 += waterLoss / MOLAR.H2O * 0.5;
    }
    s.lostWater += waterLoss * this.area;
    d.waterLossRate = waterLoss / Math.max(yr, 1e-9);

    // ---------------- bulk atmospheric escape (cosmic-shoreline scaling, Zahnle & Catling 2017)
    const kb = (Fxuv / XUV_EARTH) / (3e11 * Math.pow(this.vesc / 11186, 6)); // 1/yr
    const fb = 1 - Math.exp(-kb * yr);
    if (fb > 0) {
      for (const k in s.n) s.n[k] *= 1 - fb;
      const lossC = s.nCO2 * fb;
      s.Cexo = Math.max(0, s.Cexo - lossC);
      const vapLoss = Math.min(s.W, d.vapor * fb);
      s.W -= vapLoss;
    }

    // ---------------- biosphere, O2, CH4, H2, SO2
    const habitable = this._habitableArea() > 0.02 && this._liquid > 10 && Tm < 330;
    s.lifeOn = p.biosphere && habitable;
    const relax = (cur, tgt, tau) => tgt + (cur - tgt) * Math.exp(-yr / tau);
    const molFromBar = (bar, M) => bar * 1e5 / (this.g * Math.max(pp.M, 0.002)); // approx
    // O2
    const tauOx = 3e7 * Math.exp(-Math.max(0, Tm - 300) / 80);
    if (s.lifeOn && s.o2Target > 0) s.n.O2 = relax(s.n.O2, molFromBar(s.o2Target), 5e5);
    else s.n.O2 = relax(s.n.O2, 0, tauOx);
    // CH4
    const pO2bar = pp.O2 / 1e5;
    const tauCH4 = 12 + 2e4 / (1 + pO2bar / 1e-4);
    if (s.lifeOn && s.ch4Target > 0) s.n.CH4 = relax(s.n.CH4, molFromBar(s.ch4Target), 1e4);
    else s.n.CH4 = relax(s.n.CH4, 0, tauCH4);
    // H2: volcanic source vs escape (escape handled above)
    s.n.H2 += 0.01 * outgas * yr;
    // SO2: volcanic source; rained out by liquid water, slowly absorbed by dry surfaces
    const so2src = 0.04 * outgas;
    const tauSO2 = this._liquid > 1 && Tm < 500 ? 3 : 5e6;
    const so2eq = so2src * tauSO2;
    s.n.SO2 = so2eq + (s.n.SO2 - so2eq) * Math.exp(-yr / tauSO2);

    // re-partition carbon and update hydrology
    this._partitionCarbon();
    this._refreshHydro();
    // wetness and RH for the next step
    let wet = 0;
    for (let i = 0; i < NB; i++) {
      const si = this._seaIce(T[i]);
      wet += a[i] * (fo[i] * (1 - si) + 0.25 * fo[i] * si + 0.15 * (1 - fo[i]) * clamp(P[i] * YEAR / 1000 / 0.5, 0, 1));
    }
    if (this._liquid <= 1) wet = Math.min(wet, 0.05 * clamp(this._avail / 100, 0, 1));
    const rhT = clamp(0.1 + 0.67 * Math.sqrt(clamp(wet / 0.6, 0, 1)), 0.05, 0.77) * (this._avail > 0.01 ? 1 : 0.2);
    this._wet = this._wet === undefined ? wet : this._wet + (wet - this._wet) * rlx;
    this._rh = this._rh === undefined ? rhT : this._rh + (rhT - this._rh) * rlx;
  }

  _habitableArea() {
    const T = this.s.T;
    let h = 0;
    for (let i = 0; i < NB; i++) if (T[i] > 273 && T[i] < 320) h += this.a[i];
    return h;
  }

  ageFactor() {
    // radiogenic decline of outgassing when the planet is allowed to age
    if (!this.p.stellarEvolution) return 1;
    return Math.exp(-(this.s.age - this.p.ageGyr) / 3.0);
  }

  // ------------------------------------------------------------------ driver
  /**
   * Advance the model by `years`, using adaptive internal steps. Returns the simulated
   * time actually covered (may be less if `budgetMs` ran out).
   */
  advance(years, budgetMs = 1e9) {
    const t0 = performance.now();
    let done = 0;
    let guard = 0;
    let rejected = false;
    while (done < years - 1e-9 && guard++ < 20000) {
      if (guard % 2000 === 0 && typeof process !== 'undefined' && process.env && process.env.SIMDEBUG) {
        console.error('advance guard', guard, 'dtLast', this.dtLast, 't', this.s.t, 'Tm', this.diag.Tmean, 'rejected', rejected);
      }
      let dt = Math.min(rejected ? this.dtLast : this.dtLast * 1.5, years - done, this._dtMax());
      rejected = false;
      dt = Math.max(dt, Math.min(1e-3, years - done));
      const snap = this._snapshot();
      const maxdT = this._fastStep(dt);
      const lim = this.diag.Tmean > 450 ? 15 : this.diag.Tmean > 330 ? 6 : 3;
      if (maxdT > lim && dt > 0.25) {
        this._restore(snap);
        this.dtLast = dt * Math.max(0.1, 0.7 * lim / maxdT);
        rejected = true;
        continue;
      }
      this._slowStep(dt);
      const lim2 = this._slowLimit(snap);
      if (lim2 > 2.0 && dt > 0.25) {
        this._restore(snap);
        this.dtLast = dt / lim2;
        rejected = true;
        continue;
      }
      this.s.t += dt;
      this.s.age += dt * 1e-9;
      done += dt;
      this.dtLast = dt * (maxdT < lim * 0.3 ? 1.0 : maxdT < lim * 0.7 ? 0.8 : 0.6) * (lim2 > 1 ? 0.67 / lim2 : 1);
      if (performance.now() - t0 > budgetMs) break;
    }
    return done;
  }

  _dtMax() { return 2e5; }

  /** Ratio of relative inventory changes to the allowed 5% per step (>1 means too big). */
  _slowLimit(snap) {
    const s = this.s;
    const rel = (a, b, floor) => Math.abs(a - b) / Math.max(Math.abs(b), floor);
    let r = 0;
    r = Math.max(r, rel(s.Cexo, snap.s.Cexo, 5) / 0.05);   // floor ~ a few ppm: smaller pools are radiatively irrelevant
    r = Math.max(r, rel(s.W, snap.s.W, 1) / 0.05);
    r = Math.max(r, rel(s.n.O2, snap.s.n.O2, 1) / 0.2);
    let iceA = 0, iceB = 0;
    for (let i = 0; i < NB; i++) { iceA += this.a[i] * s.ice[i]; iceB += this.a[i] * snap.s.ice[i]; }
    r = Math.max(r, Math.abs(iceA - iceB) / Math.max(iceB, 2e3) / 0.1);
    return r;
  }

  _snapshot() {
    const s = this.s;
    return {
      s: {
        ...s, T: Float64Array.from(s.T), ice: Float64Array.from(s.ice), co2ice: Float64Array.from(s.co2ice),
        n: { ...s.n },
      },
      liquid: this._liquid, avail: this._avail, rh: this._rh, wet: this._wet, fOcean: Float64Array.from(this.fOcean),
    };
  }
  _restore(sn) {
    this.s = { ...sn.s, T: Float64Array.from(sn.s.T), ice: Float64Array.from(sn.s.ice), co2ice: Float64Array.from(sn.s.co2ice), n: { ...sn.s.n } };
    this._liquid = sn.liquid; this._avail = sn.avail; this._rh = sn.rh; this._wet = sn.wet; this.fOcean = Float64Array.from(sn.fOcean);
  }
}
