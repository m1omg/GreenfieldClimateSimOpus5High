// Shortwave (stellar) radiative transfer: planetary albedo for each surface tile type.
//
// The atmosphere is split into 9 pressure layers. Each layer holds Rayleigh scattering,
// band-envelope gas absorption (same coefficients as the thermal model), the water-vapour
// continuum and CO2 CIA, plus optionally a cloud deck, a sulfuric-acid deck or organic haze.
// Each layer is solved with the delta-Eddington two-stream approximation (Joseph et al. 1976;
// Meador & Weaver 1980) and the stack is combined with the adding method, tracking direct and
// diffuse light separately. Because the scheme is vertically resolved, thick Rayleigh-scattering
// atmospheres (steam, CO2) correctly reflect visible light before it reaches deep absorbers.
//
// The stellar spectrum is a blackbody at the star's Teff, so cool stars automatically give
// lower snow/ice albedo and weaker Rayleigh scattering (Joshi & Haberle 2012; Kopparapu 2013).
// Results are tabulated on (cos zenith, cloud optical depth, surface type) for fast lookup.

import { h2oLineKappa, co2LineKappa, ch4LineKappa, selfContinuum, co2CIA, RAD } from './radiation.js';
import { MOLAR, N_A, R_GAS } from './constants.js';

const NU_MIN = 2000, NU_MAX = 45000, NMAIN = 36, NSUB = 6;
export const SW = { nu: [], dnu: [], kH2O: [], kCO2: [], kCH4: [], kSelf: [], kCIA: [], lam: [] };
(function build() {
  const lmin = Math.log(NU_MIN), lmax = Math.log(NU_MAX);
  for (let i = 0; i < NMAIN; i++) {
    const a = Math.exp(lmin + (lmax - lmin) * i / NMAIN), b = Math.exp(lmin + (lmax - lmin) * (i + 1) / NMAIN);
    for (let s = 0; s < NSUB; s++) {
      const nu = a + (b - a) * (s + 0.5) / NSUB;
      SW.nu.push(nu); SW.dnu.push((b - a) / NSUB);
      SW.kH2O.push(h2oLineKappa(nu)); SW.kCO2.push(co2LineKappa(nu)); SW.kCH4.push(ch4LineKappa(nu));
      SW.kSelf.push(selfContinuum(nu)); SW.kCIA.push(co2CIA(nu));
      SW.lam.push(1e4 / nu);
    }
  }
})();
export const NSW = SW.nu.length;

/** Stellar spectral weights (blackbody at Teff, normalised over the full spectrum). */
export function stellarWeights(Teff) {
  const w = new Float64Array(NSW);
  const c2 = 1.438777;
  let full = 0;
  for (let nu = 5; nu < 90000; nu += 10) {
    const x = c2 * nu / Teff;
    if (x < 80) full += nu * nu * nu / Math.expm1(x) * 10;
  }
  let tot = 0;
  for (let k = 0; k < NSW; k++) {
    const nu = SW.nu[k], x = c2 * nu / Teff;
    w[k] = (x > 80 ? 0 : nu * nu * nu / Math.expm1(x)) * SW.dnu[k] / full;
    tot += w[k];
  }
  return { w, covered: tot };
}

// --- surface spectral albedos vs wavelength (micron)
function lerpTable(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 0; i < tab.length - 1; i++) {
    if (x <= tab[i + 1][0]) {
      const f = (x - tab[i][0]) / (tab[i + 1][0] - tab[i][0]);
      return tab[i][1] * (1 - f) + tab[i + 1][1] * f;
    }
  }
  return tab[tab.length - 1][1];
}
const ALB = {
  // snow (Wiscombe & Warren 1980), slightly aged
  snow: [[0.3, 0.85], [0.6, 0.9], [0.8, 0.86], [1.0, 0.72], [1.2, 0.55], [1.4, 0.25], [1.6, 0.15], [1.8, 0.3], [2.0, 0.08], [2.3, 0.12], [3, 0.02], [5, 0.02]],
  // bare sea ice / glacier ice (Brandt et al. 2005)
  seaice: [[0.3, 0.64], [0.6, 0.62], [0.8, 0.52], [1.0, 0.36], [1.2, 0.2], [1.5, 0.06], [3, 0.03], [5, 0.03]],
  // soil / sparse vegetation
  land: [[0.3, 0.07], [0.5, 0.11], [0.7, 0.2], [1.0, 0.3], [1.6, 0.32], [2.2, 0.25], [3, 0.08], [5, 0.05]],
  // sand desert
  desert: [[0.3, 0.12], [0.5, 0.3], [0.7, 0.42], [1.0, 0.48], [1.6, 0.55], [2.2, 0.5], [3, 0.15], [5, 0.1]],
  // oxidised dusty regolith of water-poor worlds (Mars bright/dark terrain mix, broadband ~0.25)
  regolith: [[0.3, 0.05], [0.45, 0.08], [0.55, 0.14], [0.65, 0.24], [0.75, 0.29], [1.0, 0.32], [1.6, 0.33], [2.2, 0.3], [3, 0.1], [5, 0.08]],
  // hot basaltic crust / lava
  lava: [[0.3, 0.06], [1, 0.08], [5, 0.08]],
};
export const TILES = ['ocean', 'seaice', 'snow', 'land', 'desert', 'lava', 'regolith'];
export const TILE = { ocean: 0, seaice: 1, snow: 2, land: 3, desert: 4, lava: 5, regolith: 6 };
const SURF = {};
for (const k in ALB) {
  const a = new Float64Array(NSW);
  for (let i = 0; i < NSW; i++) a[i] = lerpTable(ALB[k], SW.lam[i]);
  SURF[k] = a;
}

/** Ocean albedo for a direct beam (Briegleb et al. 1986). */
export function oceanAlbedo(mu) {
  mu = Math.max(0.05, mu);
  return Math.min(0.6, 0.026 / (Math.pow(mu, 1.7) + 0.065) + 0.15 * (mu - 0.1) * (mu - 0.5) * (mu - 1.0));
}

// Rayleigh cross sections at 0.55 um relative to N2 (Bates 1984; Kopparapu et al. 2013)
const RAY_REL = { N2: 1.0, O2: 0.86, CO2: 2.45, CH4: 2.0, H2: 0.21, H2O: 0.76, SO2: 3.0 };
const SIG_N2_055 = 4.53e-31; // m2/molecule

// --- delta-Eddington for one homogeneous layer: fills out.R, out.T (total), out.E (direct)
function deltaEdd(tau, om, g, mu0, out) {
  const f = g * g;
  const tp = (1 - om * f) * tau;
  let wp = (1 - f) * om / (1 - om * f);
  if (wp > 0.999999) wp = 0.999999;
  const gp = g / (1 + g);
  if (tp < 1e-8) { out.R = 0; out.T = 1; out.E = 1; return; }
  const g1 = (7 - wp * (4 + 3 * gp)) / 4;
  const g2 = -(1 - wp * (4 - 3 * gp)) / 4;
  const g3 = (2 - 3 * gp * mu0) / 4;
  const g4 = 1 - g3;
  const lam = Math.sqrt(Math.max(1e-14, g1 * g1 - g2 * g2));
  let m = mu0;
  if (Math.abs(lam * m - 1) < 1e-3) m *= 1.003;
  const et = Math.exp(-Math.min(tp / m, 300));
  if (lam * tp > 60) {
    // semi-infinite layer limit
    const a2s = g1 * g3 + g2 * g4;
    const Rinf = wp * (a2s + lam * g3) / ((lam + g1) * (1 + lam * m));
    out.R = Math.min(1, Math.max(0, Rinf)); out.T = 0; out.E = 0; return;
  }
  const a1 = g1 * g4 + g2 * g3;
  const a2 = g1 * g3 + g2 * g4;
  const ep = Math.exp(lam * tp), em = 1 / ep;
  const den = (1 - lam * lam * m * m) * ((lam + g1) * ep + (lam - g1) * em);
  let R = wp / den * ((1 - lam * m) * (a2 + lam * g3) * ep - (1 + lam * m) * (a2 - lam * g3) * em - 2 * lam * (g3 - a2 * m) * et);
  let Td = et * (1 - wp / den * ((1 + lam * m) * (a1 + lam * g4) * ep - (1 - lam * m) * (a1 - lam * g4) * em - 2 * lam * (g4 + a1 * m) / et));
  if (!(R >= 0)) R = 0;
  if (R > 1) R = 1;
  if (!(Td >= 0)) Td = 0;
  let T = Td + et;
  if (R + T > 1) T = 1 - R;
  out.R = R; out.T = T; out.E = et;
}

// layer pressure boundaries (fractions of surface pressure)
const PB = [0, 0.01, 0.04, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1.0];
export const NSL = PB.length - 1;
export const MU_CLASSES = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 1.0];
export const TAU_CLASSES = [0, 1, 3, 7, 15, 30, 60];
const MU_DIFF = 0.6;

/**
 * Absorber amounts per shortwave layer from a column structure (radiation.buildColumn).
 */
function layerAmounts(col, pd, g) {
  const L = [];
  for (let i = 0; i < NSL; i++) L.push({ mol: {}, uH2O: 0, uCO2: 0, uCH4: 0, cont: 0, cia: 0, ray: 0 });
  const { P, T, XV, dry } = col;
  const pS = P[0];
  const pdTot = dry.p > 0 ? dry.p : 1;
  const gases = Object.keys(pd).filter(k => pd[k] > 0 && MOLAR[k]);
  // integrate finely between levels (sub-divide each LW layer into 4)
  for (let j = 0; j < P.length - 1; j++) {
    for (let s = 0; s < 4; s++) {
      const pa = P[j] * Math.pow(P[j + 1] / P[j], s / 4), pb = P[j] * Math.pow(P[j + 1] / P[j], (s + 1) / 4);
      const pm = Math.sqrt(pa * pb), dp = pa - pb;
      const fr = pm / pS;
      let li = NSL - 1;
      for (let q = 0; q < NSL; q++) if (fr >= PB[q] && fr < PB[q + 1]) { li = q; break; }
      const t = (s + 0.5) / 4;
      const Tm = T[j] * (1 - t) + T[j + 1] * t;
      const xv = XV[j] * (1 - t) + XV[j + 1] * t;
      const xd = 1 - xv;
      const Mm = xv * MOLAR.H2O + xd * dry.M;
      const molCol = dp / (g * Mm); // mol/m2
      const lay = L[li];
      lay.mol.H2O = (lay.mol.H2O || 0) + molCol * xv * N_A;
      let ray = molCol * xv * N_A * RAY_REL.H2O;
      for (const gname of gases) {
        const n = molCol * xd * (pd[gname] / pdTot) * N_A;
        lay.mol[gname] = (lay.mol[gname] || 0) + n;
        ray += n * (RAY_REL[gname] ?? 1);
      }
      lay.ray += ray;
      const uv = molCol * xv * MOLAR.H2O;
      const pv = xv * pm, pdl = xd * pm;
      lay.uH2O += uv * Math.min(RAD.broadCap, (pdl + RAD.h2oSelfBroad * pv) / 1e5);
      lay.cont += uv * (pv / 101325) * Math.exp(RAD.contTexp * (1 / Tm - 1 / 296)) + uv * (pdl / 101325) * RAD.contForeignRatio;
      const fCO2 = (pd.CO2 || 0) / pdTot, fCH4 = (pd.CH4 || 0) / pdTot;
      lay.uCO2 += molCol * xd * fCO2 * MOLAR.CO2 * (pm / 1e5) * (1 + 0.3 * fCO2);
      lay.uCH4 += molCol * xd * fCH4 * MOLAR.CH4 * (pm / 1e5);
      const amag = (pdl * fCO2 / 101325) * (273.15 / Tm);
      const dzcm = 100 * (R_GAS * Tm / (Mm * g)) * (dp / pm);
      lay.cia += amag * amag * dzcm;
    }
  }
  return L;
}

const tmp = { R: 0, T: 0, E: 0 };

/**
 * Build the albedo lookup table for the current atmosphere.
 * @param {object} o { col, pd, g, Teff, tauS (sulfuric deck), tauH (haze), cloudLayer }
 */
export function buildSWTable(o) {
  const { w } = stellarWeights(o.Teff);
  const lay = layerAmounts(o.col, o.pd, o.g);
  const nMu = MU_CLASSES.length, nTau = TAU_CLASSES.length, nT = TILES.length;
  const A = new Float64Array(nMu * nTau * nT);
  const Ahi = new Float64Array(nMu * nTau * nT);
  const cl = Math.max(0, Math.min(NSL - 1, o.cloudLayer ?? 5));
  const clHi = 2; // high cloud deck (steam-rich atmospheres: clouds rise above most of the vapour)
  // per-layer optical properties for each spectral point
  const nL = NSL;
  // arrays [layer][mu index or diffuse] for clear layers
  const Rb = [], Tb = [], Eb = [], Rd = [], Td = [];
  for (let l = 0; l < nL; l++) {
    Rb.push(new Float64Array(nMu * NSW)); Tb.push(new Float64Array(nMu * NSW)); Eb.push(new Float64Array(nMu * NSW));
    Rd.push(new Float64Array(NSW)); Td.push(new Float64Array(NSW));
  }
  // cloud layer variants (low and high placement)
  const mk = () => { const o2 = { Rb: [], Tb: [], Eb: [], Rd: [], Td: [] }; for (let t = 0; t < nTau; t++) { o2.Rb.push(new Float64Array(nMu * NSW)); o2.Tb.push(new Float64Array(nMu * NSW)); o2.Eb.push(new Float64Array(nMu * NSW)); o2.Rd.push(new Float64Array(NSW)); o2.Td.push(new Float64Array(NSW)); } return o2; };
  const CL = { [cl]: mk(), [clHi]: mk() };
  const tauS = o.tauS || 0, tauH = o.tauH || 0;
  for (let k = 0; k < NSW; k++) {
    const lam = SW.lam[k];
    const sr = SIG_N2_055 * Math.pow(0.55 / lam, 4) * (1 + 0.0113 / (lam * lam));
    for (let l = 0; l < nL; l++) {
      const L = lay[l];
      const tR = L.ray * sr;
      const tA = SW.kH2O[k] * L.uH2O + SW.kCO2[k] * L.uCO2 + SW.kCH4[k] * L.uCH4 + SW.kSelf[k] * L.cont + SW.kCIA[k] * L.cia;
      let tScat = tR, tTot = tR + tA, gNum = 0;
      if (l === 0) {
        // sulfuric acid deck and organic haze live at the top of the atmosphere
        const ws = lam < 0.4 ? 0.96 : lam < 0.5 ? 0.995 : lam < 2.0 ? 0.99995 : 0.9;
        const th = tauH * Math.pow(0.55 / lam, 1.6);
        const wh = lam < 0.45 ? 0.6 : lam < 0.8 ? 0.85 : 0.95;
        tScat += tauS * ws + th * wh; tTot += tauS + th;
        gNum += tauS * ws * 0.75 + th * wh * 0.6;
      }
      const om = tTot > 0 ? tScat / tTot : 0;
      const gA = tScat > 0 ? gNum / tScat : 0;
      for (let m = 0; m < nMu; m++) {
        deltaEdd(tTot, om, gA, MU_CLASSES[m], tmp);
        Rb[l][m * NSW + k] = tmp.R; Tb[l][m * NSW + k] = tmp.T; Eb[l][m * NSW + k] = tmp.E;
      }
      deltaEdd(tTot, om, gA, MU_DIFF, tmp);
      Rd[l][k] = tmp.R; Td[l][k] = tmp.T;
      if (l === cl || l === clHi) {
        const V = CL[l];
        const wc = lam < 0.9 ? 0.99999 : lam < 1.3 ? 0.9997 : lam < 2.0 ? 0.995 : lam < 2.8 ? 0.97 : 0.6;
        for (let t = 0; t < nTau; t++) {
          const tc = TAU_CLASSES[t];
          const s2 = tScat + tc * wc, tt = tTot + tc;
          const om2 = tt > 0 ? s2 / tt : 0;
          const g2 = s2 > 0 ? (gNum + tc * wc * 0.85) / s2 : 0;
          for (let m = 0; m < nMu; m++) {
            deltaEdd(tt, om2, g2, MU_CLASSES[m], tmp);
            V.Rb[t][m * NSW + k] = tmp.R; V.Tb[t][m * NSW + k] = tmp.T; V.Eb[t][m * NSW + k] = tmp.E;
          }
          deltaEdd(tt, om2, g2, MU_DIFF, tmp);
          V.Rd[t][k] = tmp.R; V.Td[t][k] = tmp.T;
        }
      }
    }
  }
  // adding: for each (mu, tau) and spectral point, stack layers top -> bottom
  const surf = TILES.map(name => name === 'ocean' ? null : SURF[name]);
  const rgbAtm = [0, 0, 0];
  const chan = [[0.6, 0.7], [0.5, 0.6], [0.4, 0.5]];
  const chanN = [0, 0, 0];
  for (const [cLay, Aout] of [[cl, A], [clHi, Ahi]]) {
    const V = CL[cLay];
    for (let m = 0; m < nMu; m++) {
      const aOcean = oceanAlbedo(MU_CLASSES[m]);
      for (let t = 0; t < nTau; t++) {
        if (cLay === clHi && t === 0) {
          // clear sky is identical for both placements
          for (let s2 = 0; s2 < nT; s2++) Aout[(m * nTau) * nT + s2] = A[(m * nTau) * nT + s2];
          continue;
        }
        const base = (m * nTau + t) * nT;
        for (let k = 0; k < NSW; k++) {
          let R = 0, Tt = 1, E = 1, Rbar = 0, Tbar = 1, Rstar = 0;
          const idx = m * NSW + k;
          for (let l = 0; l < nL; l++) {
            let rL, tL, eL, rdL, tdL;
            if (l === cLay) { rL = V.Rb[t][idx]; tL = V.Tb[t][idx]; eL = V.Eb[t][idx]; rdL = V.Rd[t][k]; tdL = V.Td[t][k]; }
            else { rL = Rb[l][idx]; tL = Tb[l][idx]; eL = Eb[l][idx]; rdL = Rd[l][k]; tdL = Td[l][k]; }
            const d = 1 / (1 - Rstar * rdL);
            const diffDown = Tt - E;
            const Rn = R + (E * rL + diffDown * rdL) * Tbar * d;
            const Tn = E * tL + (diffDown + E * rL * Rstar) * tdL * d;
            const Rbn = Rbar + Tbar * rdL * Tbar * d;
            const Tbn = Tbar * tdL * d;
            const Rsn = rdL + tdL * Rstar * tdL * d;
            R = Rn; Tt = Tn; E = E * eL; Rbar = Rbn; Tbar = Tbn; Rstar = Rsn;
          }
          const wk = w[k];
          for (let s2 = 0; s2 < nT; s2++) {
            const as = s2 === 0 ? aOcean : surf[s2][k];
            Aout[base + s2] += wk * (R + Tt * as * Tbar / (1 - Rstar * as));
          }
          if (cLay === cl && m === 4 && t === 0) {
            const l2 = SW.lam[k];
            for (let c = 0; c < 3; c++) if (l2 >= chan[c][0] && l2 < chan[c][1]) { rgbAtm[c] += R; chanN[c]++; }
          }
        }
      }
    }
  }
  for (let c = 0; c < 3; c++) rgbAtm[c] = chanN[c] ? rgbAtm[c] / chanN[c] : 0;
  return { A, Ahi, nMu, nTau, nT, rgbAtm };
}

/** Bilinear lookup of planetary albedo for tile s at (mu, tauCloud). */
export function lookupAlbedo(tab, mu, tau, s, high = false) {
  const M = MU_CLASSES, Tc = TAU_CLASSES;
  let i = 0;
  while (i < M.length - 2 && mu > M[i + 1]) i++;
  let fm = (mu - M[i]) / (M[i + 1] - M[i]);
  fm = Math.max(0, Math.min(1, fm));
  let j = 0;
  while (j < Tc.length - 2 && tau > Tc[j + 1]) j++;
  // interpolate in sqrt(tau) for smoothness
  let ft = (Math.sqrt(tau) - Math.sqrt(Tc[j])) / (Math.sqrt(Tc[j + 1]) - Math.sqrt(Tc[j]));
  ft = Math.max(0, Math.min(1, ft));
  const nT = tab.nT, nTau = tab.nTau, A = high ? tab.Ahi : tab.A;
  const a00 = A[(i * nTau + j) * nT + s], a01 = A[(i * nTau + j + 1) * nT + s];
  const a10 = A[((i + 1) * nTau + j) * nT + s], a11 = A[((i + 1) * nTau + j + 1) * nT + s];
  return (a00 * (1 - ft) + a01 * ft) * (1 - fm) + (a10 * (1 - ft) + a11 * ft) * fm;
}
