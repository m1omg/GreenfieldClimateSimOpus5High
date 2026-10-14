// Lazily-filled lookup tables of column radiative properties vs surface temperature,
// keyed on (quantised) atmospheric composition. Lets the climate model evaluate full
// spectral radiative transfer at thousands of steps per second.

import { columnOLR, buildColumn } from './radiation.js';
import { buildSWTable } from './shortwave.js';

const T0 = 90, RATIO = 1.022, NGRID = 190; // 90 K .. ~5600 K
const GRID = new Float64Array(NGRID);
for (let k = 0; k < NGRID; k++) GRID[k] = T0 * Math.pow(RATIO, k);
const LNR = Math.log(RATIO);
const NLEV = 32;

function q(x, step) { return Math.round(Math.log(Math.max(x, 1e-30)) / step); }

export function compositionKey(c) {
  const p = c.pd;
  // the vapour inventory cap only matters when it is within reach of saturation
  const capRel = c.pvCapRelevant === false ? 1e30 : c.pvCap;
  // under a steam-dominated atmosphere minor CO2 changes barely matter radiatively
  const co2Step = c.pvCapRelevant !== false && p.CO2 < 0.05 * c.pvCap ? 0.08 : 0.015;
  return [
    // floors ~ where each gas stops mattering radiatively, so trace-level wobbles don't
    // invalidate the table
    q(p.N2 + 300, 0.02), q(p.O2 + 300, 0.05), q(p.CO2 + 0.05, co2Step), q(p.CH4 + 0.01, 0.03),
    q(p.H2 + 20, 0.03), q(p.SO2 + 2, 0.05), q(c.g, 0.01), q(capRel + 1e-6, 0.03),
    Math.round(c.rh * 25), Math.round(c.Tstrat / 2),
  ].join(',');
}

export class LWCache {
  constructor() {
    this.key = '';
    this.comp = null;
    this.olr = new Float64Array(NGRID);
    this.xs = new Float64Array(NGRID);
    this.col = new Float64Array(NGRID);
    this.ttrop = new Float64Array(NGRID);
    this.ttop = new Float64Array(NGRID);
    this.pv = new Float64Array(NGRID);
    this.ps = new Float64Array(NGRID);
    this.have = new Uint8Array(NGRID);
    this.builds = 0;
    this.columns = 0;
  }
  setComposition(c) {
    const key = compositionKey(c);
    if (key === this.key) return false;
    this.key = key;
    this.comp = { ...c, pd: { ...c.pd } };
    this.have.fill(0);
    this.builds++;
    return true;
  }
  _fill(k) {
    const T = GRID[k];
    const r = columnOLR(T, this.comp, NLEV);
    this.olr[k] = r.olr;
    this.xs[k] = r.xvStrat;
    this.col[k] = r.colH2O;
    this.ttrop[k] = r.Ttrop;
    this.pv[k] = r.pv;
    this.ps[k] = r.pS;
    // thermal emission level of a Venus-like sulfuric cloud deck. Above the clouds the real
    // atmosphere is shallower than our adiabat (solar heating in the clouds), so the ~235 K
    // emission level (65-70 km on Venus, VIRA) maps to ~0.15 bar on the adiabatic profile.
    const PD = 30000;
    let tt = r.T[r.T.length - 1];
    for (let j = 0; j < r.P.length - 1; j++) {
      if (r.P[j] >= PD && r.P[j + 1] < PD) {
        const f = Math.log(r.P[j] / PD) / Math.log(r.P[j] / r.P[j + 1]);
        tt = r.T[j] * (1 - f) + r.T[j + 1] * f; break;
      }
    }
    if (r.P[0] < PD) tt = r.T[0];
    this.ttop[k] = tt;
    this.have[k] = 1;
    this.columns++;
  }
  /** Interpolated properties at surface temperature T. Writes into out. */
  eval(T, out) {
    let x = Math.log(T / T0) / LNR;
    if (x < 0) x = 0;
    if (x > NGRID - 1.001) x = NGRID - 1.001;
    const k = Math.floor(x), f = x - k;
    if (!this.have[k]) this._fill(k);
    if (!this.have[k + 1]) this._fill(k + 1);
    const g = 1 - f;
    out.olr = this.olr[k] * g + this.olr[k + 1] * f;
    out.dolr = (this.olr[k + 1] - this.olr[k]) / (GRID[k + 1] - GRID[k]);
    out.xs = Math.exp(Math.log(this.xs[k] + 1e-30) * g + Math.log(this.xs[k + 1] + 1e-30) * f);
    out.col = this.col[k] * g + this.col[k + 1] * f;
    out.dcol = (this.col[k + 1] - this.col[k]) / (GRID[k + 1] - GRID[k]);
    out.ttrop = this.ttrop[k] * g + this.ttrop[k + 1] * f;
    out.ttop = this.ttop[k] * g + this.ttop[k + 1] * f;
    out.pv = this.pv[k] * g + this.pv[k + 1] * f;
    out.ps = this.ps[k] * g + this.ps[k + 1] * f;
    return out;
  }
}

export class SWCache {
  constructor() { this.key = ''; this.tab = null; this.builds = 0; }
  /** Rebuild if needed. o: { comp, Tglob, Teff, tauS, tauH, cloudLayer } */
  update(o, lwKey) {
    const key = [lwKey, Math.round(Math.log(o.Tglob) / 0.015), o.Teff, Math.round(o.tauS * 4), Math.round(o.tauH * 8), o.cloudLayer].join('|');
    if (key === this.key && this.tab) return this.tab;
    this.key = key;
    const col = buildColumn(o.Tglob, o.comp, 30);
    this.tab = buildSWTable({ col, pd: o.comp.pd, g: o.comp.g, Teff: o.Teff, tauS: o.tauS, tauH: o.tauH, cloudLayer: o.cloudLayer });
    this.builds++;
    return this.tab;
  }
}
