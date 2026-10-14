// Longwave (thermal) radiative transfer for a single atmospheric column.
//
// Approach (after Jeevanjee & Fueglistaler 2020; Jeevanjee et al. 2021; Boukrouche et al. 2021):
//  * Line absorption of each gas is represented by smooth "band envelopes" kappa(nu) that
//    decay exponentially away from band centres. Sorting a line-by-line spectrum gives
//    almost exactly this shape, and it reproduces the logarithmic CO2 forcing and the
//    Simpson–Nakajima (runaway) limit of a saturated steam atmosphere.
//  * Pressure broadening: kappa ∝ p_broad / p_ref, with self-broadening enhancement.
//  * Water vapour self/foreign continuum (MT_CKD-like shape and T dependence) and
//    collision-induced absorption for CO2–CO2, N2–N2, H2–N2 and H2–H2.
//  * Temperature profile: dry adiabat to the lifting condensation level, then the
//    non-dilute pseudo-adiabat of water (valid all the way to a pure-steam atmosphere),
//    then an isothermal stratosphere at T_strat.
//  * Two-stream emission with diffusivity factor 1.66 and a source function linear in
//    optical depth (accurate for optically thick layers, essential for steam atmospheres).

import { MOLAR, CP, R_GAS } from './constants.js';
import { psat, latentEff, dlnPsatDlnT } from './thermo.js';

const DIFF = 1.66;
const P_REF = 1e5;
const RV = R_GAS / MOLAR.H2O;

// ---------------------------------------------------------------------------
// Tunable coefficients (calibrated in tests/calibrate.mjs against literature targets)
export const RAD = {
  h2oRot: 60,     // m2/kg at 150 cm-1
  h2oRotL: 40.07,     // e-folding width (cm-1)
  h2oVR: 10,       // 6.3 um band peak
  h2oVRL: 54.32,
  h2oScale: 1.0,
  h2oSelfBroad: 8,
  contSelf: 0.9194,   // m2/kg per atm of vapour at 1000 cm-1, 296 K
  contForeignRatio: 0.06,
  contTexp: 2201,
  co2_15: 60.11,
  co2_15L: 11.53,
  co2Wing: 0.0,
  co2CIA: 1.0,
  ch4Scale: 1.0,
  n2CIA: 1.0,
  h2CIA: 1.0,
  broadCap: 1e9,
  mwCut: 0.02,
  satLo: 0.015,
  satSpan: 0.12,
};

// ---------------------------------------------------------------------------
// Spectral grid (cm-1). Finer in the thermal IR, coarse in the near IR.
const nuArr = [];
const dnuArr = [];
(function buildGrid() {
  const push = (a, b, step) => {
    for (let n = a + step / 2; n < b; n += step) { nuArr.push(n); dnuArr.push(step); }
  };
  push(0, 2600, 10);
  push(2600, 4400, 30);
  push(4400, 30000, 200);
})();
export const NU = Float64Array.from(nuArr);
export const DNU = Float64Array.from(dnuArr);
export const NK = NU.length;

function env(nu, center, peak, width) {
  return peak * Math.exp(-Math.abs(nu - center) / width);
}

// log-linear interpolation helper on (nu, value) pairs
function logInterp(table, nu) {
  if (nu <= table[0][0]) return table[0][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i], [x1, y1] = table[i + 1];
    if (nu <= x1) {
      const f = (nu - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) * (1 - f) + Math.log(y1) * f);
    }
  }
  return table[table.length - 1][1];
}

// Self continuum shape relative to 1000 cm-1 (MT_CKD-like, 296 K)
const SELF_SHAPE = [
  [0, 300], [300, 30], [500, 8], [600, 4.5], [800, 1.8], [1000, 1.0], [1200, 1.2],
  [1400, 4], [1600, 12], [1800, 4], [2000, 0.6], [2200, 0.06], [2400, 0.012],
  [2600, 0.01], [2900, 0.03], [3300, 0.4], [3700, 2.5], [4100, 0.15], [4500, 0.01],
  [5000, 0.05], [5300, 0.4], [5800, 0.004], [6300, 0.003], [7200, 0.12], [7900, 0.001],
  [8800, 0.02], [9600, 3e-4], [10600, 0.006], [11500, 1e-4], [12200, 1e-3],
  [14000, 2e-5], [30000, 1e-6],
];

// CO2–CO2 CIA (cm-1 amagat-2), translational + dimer/Fermi bands + far-wing continuum.
const CO2CIA = [
  [0, 1.5e-6], [50, 3.0e-6], [100, 2.2e-6], [150, 1.0e-6], [200, 4e-7], [250, 1.5e-7],
  [300, 7e-8], [400, 3e-8], [500, 2e-8], [700, 2e-8], [800, 2.5e-8], [1000, 3e-8],
  [1200, 1.5e-7], [1285, 6e-7], [1340, 2e-7], [1388, 6e-7], [1450, 1.5e-7],
  [1600, 5e-8], [2000, 6e-8], [2500, 3e-8], [2800, 6e-8], [3200, 4e-8], [3600, 6e-8],
  [4000, 1.5e-8], [4350, 2.5e-9], [4700, 1e-8], [5200, 8e-9], [5750, 1.2e-9],
  [6300, 6e-9], [7000, 5e-9], [7800, 6e-10], [8700, 3e-10], [9500, 2e-9],
  [10000, 3e-10], [30000, 1e-12],
];

// N2–N2 CIA (cm-1 amagat-2)
const N2CIA = [
  [0, 1.2e-7], [50, 1.4e-7], [100, 1.0e-7], [150, 5e-8], [200, 2e-8], [300, 4e-9],
  [400, 6e-10], [600, 1e-11], [2300, 1e-11], [2330, 3e-9], [2400, 1e-11], [30000, 1e-14],
];

// H2–N2 CIA (cm-1 amagat-2); rotational S(0),S(1) and fundamental band.
const H2N2CIA = [
  [0, 3e-7], [100, 5e-7], [250, 6e-7], [354, 1.4e-6], [450, 8e-7], [587, 1.3e-6],
  [700, 5e-7], [900, 1.5e-7], [1100, 5e-8], [1400, 1e-8], [2000, 1e-9], [3500, 2e-9],
  [4160, 4e-8], [4500, 3e-8], [5000, 4e-9], [6000, 1e-10], [30000, 1e-13],
];
// H2–H2 CIA (cm-1 amagat-2)
const H2H2CIA = [
  [0, 4e-7], [100, 6e-7], [250, 8e-7], [354, 2.2e-6], [450, 1.4e-6], [587, 2.2e-6],
  [700, 9e-7], [900, 3e-7], [1100, 1e-7], [1400, 2.5e-8], [2000, 2e-9], [3500, 3e-9],
  [4160, 6e-8], [4500, 4e-8], [5000, 6e-9], [6000, 2e-10], [30000, 1e-13],
];

// Per-k arrays of absorption coefficients (rebuilt when RAD changes)
export const KAP = {
  h2o: new Float64Array(NK), co2: new Float64Array(NK), ch4: new Float64Array(NK),
  so2: new Float64Array(NK), self: new Float64Array(NK), cia_co2: new Float64Array(NK),
  cia_n2: new Float64Array(NK), cia_h2n2: new Float64Array(NK), cia_h2h2: new Float64Array(NK),
};

export function h2oLineKappa(nu) {
  let k = 0;
  // pure rotation band (flat below 150 cm-1)
  k += nu < 150 ? RAD.h2oRot : env(nu, 150, RAD.h2oRot, RAD.h2oRotL);
  k += env(nu, 1595, RAD.h2oVR, RAD.h2oVRL);           // 6.3 um
  k += env(nu, 3755, RAD.h2oVR * 0.8, 62);             // 2.7 um
  k += env(nu, 5330, 3.5, 95);                          // 1.87 um
  k += env(nu, 7250, 2.2, 115);                         // 1.38 um
  k += env(nu, 8800, 0.35, 110);                        // 1.13 um
  k += env(nu, 10600, 0.18, 110);                       // 0.94 um
  k += env(nu, 12150, 0.025, 100);                      // 0.82 um
  k += env(nu, 13800, 0.006, 90);                       // 0.72 um
  k += env(nu, 16900, 0.0006, 90);                      // 0.59 um
  return k * RAD.h2oScale;
}

export function co2LineKappa(nu) {
  let k = 0;
  k += env(nu, 667.5, RAD.co2_15, RAD.co2_15L);  // 15 um
  k += env(nu, 667.5, RAD.co2Wing, 60);          // far wings / hot bands (pressure-induced)
  k += env(nu, 961, 0.004, 12);                  // 10.4 um laser band
  k += env(nu, 1064, 0.004, 12);                 // 9.4 um laser band
  k += env(nu, 1932, 0.05, 15);                  // 5.2 um
  k += env(nu, 2076, 0.05, 15);
  k += env(nu, 2349, 1100, 11);                  // 4.3 um
  k += env(nu, 3660, 22, 25);                    // 2.7 um doublet
  k += env(nu, 4980, 0.7, 25);                   // 2.0 um
  k += env(nu, 6350, 0.05, 30);                  // 1.6 um
  k += env(nu, 6970, 0.02, 30);                  // 1.43 um
  return k;
}

export function ch4LineKappa(nu) {
  let k = 0;
  k += env(nu, 1306, 80, 24);       // 7.7 um
  k += env(nu, 1533, 6, 25);
  k += env(nu, 3019, 130, 30);      // 3.3 um
  k += env(nu, 4300, 5, 60);        // 2.3 um
  k += env(nu, 5900, 1.2, 70);      // 1.7 um
  k += env(nu, 7500, 0.25, 80);     // 1.33 um
  k += env(nu, 8700, 0.25, 80);     // 1.15 um
  k += env(nu, 11200, 0.06, 90);    // 0.89 um
  k += env(nu, 13750, 0.015, 80);   // 0.727 um
  k += env(nu, 16150, 0.004, 80);   // 0.619 um
  return k * RAD.ch4Scale;
}

export function so2LineKappa(nu) {
  return env(nu, 1362, 60, 20) + env(nu, 1151, 25, 18) + env(nu, 518, 15, 20) + env(nu, 2500, 1, 30);
}

/** Water vapour self-continuum coefficient (m2/kg per atm of vapour, 296 K) at nu. */
export function selfContinuum(nu) { return RAD.contSelf * logInterp(SELF_SHAPE, nu); }
/** CO2–CO2 CIA (cm-1 amagat-2) at nu. */
export function co2CIA(nu) { return RAD.co2CIA * logInterp(CO2CIA, nu); }

export function rebuildKappa() {
  for (let k = 0; k < NK; k++) {
    const nu = NU[k];
    KAP.h2o[k] = h2oLineKappa(nu);
    KAP.co2[k] = co2LineKappa(nu);
    KAP.ch4[k] = ch4LineKappa(nu);
    KAP.so2[k] = so2LineKappa(nu);
    KAP.self[k] = RAD.contSelf * logInterp(SELF_SHAPE, nu);
    KAP.cia_co2[k] = RAD.co2CIA * logInterp(CO2CIA, nu);
    KAP.cia_n2[k] = RAD.n2CIA * logInterp(N2CIA, nu);
    KAP.cia_h2n2[k] = RAD.h2CIA * logInterp(H2N2CIA, nu);
    KAP.cia_h2h2[k] = RAD.h2CIA * logInterp(H2H2CIA, nu);
  }
}
rebuildKappa();

// Planck spectral flux density pi*B_nu [W m-2 (cm-1)-1] at wavenumber nu [cm-1].
const C1F = Math.PI * 2 * 6.62607015e-34 * (2.99792458e8) ** 2 * 1e8; // with nu in cm-1 -> per cm-1
const C2CM = 1.438777; // cm K
export function planckFlux(nu, T) {
  const x = C2CM * nu / T;
  if (x > 80) return 0;
  return C1F * nu * nu * nu / Math.expm1(x);
}

// ---------------------------------------------------------------------------
// Gas mixture helpers

/** Temperature-dependent isobaric heat capacity (J/kg/K), fits to NIST data 150–1500 K. */
export function cpGas(g, T) {
  const t = Math.min(Math.max(T, 120), 2000);
  switch (g) {
    case 'CO2': return Math.min(1250, 600 + 0.98 * t - 4.2e-4 * t * t);
    case 'H2O': return 1700 + 0.5 * Math.min(t, 1500);
    case 'N2': return 1000 + 0.12 * t;
    case 'O2': return 880 + 0.13 * t;
    case 'CH4': return 1500 + 2.4 * t;
    case 'SO2': return 520 + 0.4 * t;
    default: return CP[g] || 1000;
  }
}

/** Dry-gas properties from partial pressures (Pa) object. */
export function dryMix(pd) {
  let p = 0, mm = 0, cpm = 0;
  for (const g in pd) {
    if (!(g in MOLAR) || pd[g] <= 0) continue;
    p += pd[g];
  }
  if (p <= 0) return { p: 0, M: MOLAR.N2, cp: CP.N2, R: R_GAS / MOLAR.N2 };
  for (const g in pd) {
    if (!(g in MOLAR) || pd[g] <= 0) continue;
    mm += pd[g] / p * MOLAR[g];
  }
  for (const g in pd) {
    if (!(g in MOLAR) || pd[g] <= 0) continue;
    const massFrac = (pd[g] / p) * MOLAR[g] / mm;
    cpm += massFrac * (CP[g] || 1000);
  }
  const mf = {};
  for (const g in pd) if (g in MOLAR && pd[g] > 0) mf[g] = (pd[g] / p) * MOLAR[g] / mm;
  return { p, M: mm, cp: cpm, R: R_GAS / mm, mf };
}
function dryCp(dry, T) {
  if (!dry.mf) return dry.cp;
  let c = 0;
  for (const g in dry.mf) c += dry.mf[g] * cpGas(g, T);
  return c || dry.cp;
}

// Moist pseudo-adiabatic lapse rate dlnT/dlnp for a saturated parcel at (T, p)
// containing dry gas with properties (Ra, cpa, Ma). Non-dilute, valid to pure steam.
function moistDlnTdlnP(T, p, Ra, cpa, Ma) {
  const ps = psat(T);
  const g = dlnPsatDlnT(T);
  if (ps >= p * 0.999) return 1 / g; // pure steam: follow the saturation curve
  const pa = p - ps;
  const r = (MOLAR.H2O / Ma) * ps / pa;
  const L = RV * T * g;
  const cpv = cpGas('H2O', T);
  const num = cpa + r * cpv - r * L / T + r * L * L / (RV * T * T);
  const den = Ra + r * L / T;
  const dlnpa = num / den;
  const dlnp = (pa / p) * dlnpa + (ps / p) * g;
  return 1 / dlnp;
}

/**
 * Build the vertical structure of a column.
 * @param {number} Ts surface temperature
 * @param {object} c composition: { g, pd: {N2,O2,CO2,CH4,H2,SO2} dry partial pressures [Pa],
 *        pvCap: max surface vapour pressure (inventory), rh: tropospheric relative humidity,
 *        Tstrat: stratospheric temperature }
 * @param {number} nLev number of levels
 */
export function buildColumn(Ts, c, nLev = 40) {
  const dry = dryMix(c.pd);
  const pdTot = Math.max(dry.p, 0);
  // surface vapour pressure
  const ps_sat = psat(Ts);
  // effective RH approaches 1 when vapour dominates (cannot be sub-saturated steam with an ocean)
  let pv = c.rh * ps_sat;
  const xvSat = ps_sat / (ps_sat + pdTot + 1e-9);
  const rhEff = c.rh + (1 - c.rh) * Math.min(1, xvSat * 1.5);
  pv = rhEff * ps_sat;
  if (pv > c.pvCap) pv = c.pvCap;
  if (pv < 0) pv = 0;
  const pS = pdTot + pv;
  const pTop = Math.min(1.0, pS * 1e-3);
  const lnS = Math.log(pS), lnT = Math.log(pTop);

  const P = new Float64Array(nLev + 1);
  const T = new Float64Array(nLev + 1);
  const XV = new Float64Array(nLev + 1);
  for (let j = 0; j <= nLev; j++) P[j] = Math.exp(lnS + (lnT - lnS) * j / nLev);

  const xv0 = pv / pS;
  // As vapour becomes a major constituent the whole troposphere moistens toward saturation
  // (3D runaway simulations: Leconte et al. 2013; Chaverot et al. 2023).
  // ...but only if the surface can supply it: on land planets the vapour source is small and
  // the troposphere stays dry (Abe et al. 2011; Leconte et al. 2013)
  const supply = Math.min(1, Math.max(0, (c.rh - 0.1) / 0.6));
  const wSat = Math.min(1, Math.max(0, (xv0 - RAD.satLo) / RAD.satSpan)) * supply;
  // mixture properties of unsaturated air including vapour
  const Mmix0 = xv0 * MOLAR.H2O + (1 - xv0) * dry.M;
  const qv0 = xv0 * MOLAR.H2O / Mmix0;
  const kappaAt = (T) => (R_GAS / Mmix0) / (qv0 * cpGas('H2O', T) + (1 - qv0) * dryCp(dry, T));

  let Tcur = Ts, saturated = false, strat = false;
  let xvTrop = xv0, pTrop = pTop, Ttrop = c.Tstrat;
  T[0] = Ts; XV[0] = xv0;
  const nSub = 4;
  for (let j = 1; j <= nLev; j++) {
    const dln = (Math.log(P[j]) - Math.log(P[j - 1])) / nSub;
    let lnp = Math.log(P[j - 1]);
    for (let s = 0; s < nSub; s++) {
      if (strat) break;
      const p0 = Math.exp(lnp);
      if (!saturated && xv0 * p0 >= psat(Tcur) * 0.999 && xv0 > 0) saturated = true;
      let rate;
      if (!saturated || pv <= 0) rate = kappaAt(Tcur);
      else rate = moistDlnTdlnP(Tcur, p0, dry.R, dryCp(dry, Tcur), dry.M);
      // RK2
      const Tm = Tcur * Math.exp(rate * dln * 0.5);
      const pm = Math.exp(lnp + dln * 0.5);
      let rate2;
      if (!saturated || pv <= 0) rate2 = kappaAt(Tm);
      else rate2 = moistDlnTdlnP(Tm, pm, dry.R, dryCp(dry, Tm), dry.M);
      Tcur = Tcur * Math.exp(rate2 * dln);
      lnp += dln;
      if (Tcur <= c.Tstrat) { Tcur = c.Tstrat; strat = true; }
    }
    T[j] = Tcur;
    if (!strat) {
      // environmental vapour: min(surface mixing, RH * saturation)
      const pj = P[j];
      const ps_j = psat(T[j]);
      const xvSj = ps_j / pj;
      // Manabe–Wetherald (1967) RH profile, blended to saturation where vapour dominates
      const rhMW = c.rh * Math.max(0.02, (pj / pS - RAD.mwCut) / (1 - RAD.mwCut));
      const rhj = rhMW + (1 - rhMW) * Math.max(wSat, Math.min(1, xvSj * 1.5));
      XV[j] = Math.min(xv0, Math.min(0.999999, rhj * xvSj));
      xvTrop = XV[j]; pTrop = pj; Ttrop = T[j];
    } else {
      XV[j] = xvTrop;
    }
  }
  return { P, T, XV, pS, pv, dry, xvTrop, pTrop, Ttrop, nLev };
}

/**
 * Outgoing longwave radiation (clear sky) of a column.
 * Returns { olr, xvStrat, Te, pS, pv, colH2O }.
 * @param {object} c composition
 * @param {Float64Array} [specOut] optional per-wavenumber spectral flux output
 */
export function columnOLR(Ts, c, nLev = 40, specOut = null) {
  const col = buildColumn(Ts, c, nLev);
  const { P, T, XV, dry } = col;
  const g = c.g;
  const nL = col.nLev;
  const pd = c.pd;
  const pdTot = dry.p > 0 ? dry.p : 1;
  // per-layer path quantities
  const L_h2o = new Float64Array(nL), L_co2 = new Float64Array(nL), L_ch4 = new Float64Array(nL),
    L_so2 = new Float64Array(nL), L_self = new Float64Array(nL), L_for = new Float64Array(nL),
    L_cco2 = new Float64Array(nL), L_cn2 = new Float64Array(nL), L_ch2n2 = new Float64Array(nL),
    L_ch2h2 = new Float64Array(nL);
  let colH2O = 0;
  const fCO2 = (pd.CO2 || 0) / pdTot, fCH4 = (pd.CH4 || 0) / pdTot, fN2 = ((pd.N2 || 0) + (pd.O2 || 0) * 0.9) / pdTot,
    fH2 = (pd.H2 || 0) / pdTot, fSO2 = (pd.SO2 || 0) / pdTot;
  const cap = RAD.broadCap;
  for (let j = 0; j < nL; j++) {
    const pm = Math.sqrt(P[j] * P[j + 1]);
    const dp = P[j] - P[j + 1];
    const Tm = 0.5 * (T[j] + T[j + 1]);
    const xv = 0.5 * (XV[j] + XV[j + 1]);
    const xd = 1 - xv;
    const Mm = xv * MOLAR.H2O + xd * dry.M;
    const colMass = dp / g;                 // kg/m2 of the layer
    const qv = xv * MOLAR.H2O / Mm;
    const uv = qv * colMass;
    colH2O += uv;
    const pv = xv * pm, pdl = xd * pm;
    // pressure broadening
    const bH2O = Math.min(cap, (pdl + RAD.h2oSelfBroad * pv) / P_REF);
    const bAir = Math.min(cap, pm / P_REF);
    L_h2o[j] = uv * bH2O;
    L_self[j] = uv * (pv / 101325) * Math.exp(RAD.contTexp * (1 / Tm - 1 / 296));
    L_for[j] = uv * (pdl / 101325) * RAD.contForeignRatio;
    const qd = (xd * dry.M / Mm);
    const mu = (gas) => (MOLAR[gas] / dry.M);
    L_co2[j] = qd * fCO2 * mu('CO2') * colMass * bAir * (1 + 0.3 * fCO2);
    L_ch4[j] = qd * fCH4 * mu('CH4') * colMass * bAir;
    L_so2[j] = qd * fSO2 * mu('SO2') * colMass * bAir;
    // CIA: tau = alpha[cm-1 amagat-2] * n_a * n_b * dz[cm]
    const dzcm = 100 * (R_GAS * Tm / (Mm * g)) * (dp / pm);
    const amag = (pp) => (pp / 101325) * (273.15 / Tm);
    const nCO2 = amag(pdl * fCO2), nN2 = amag(pdl * fN2), nH2 = amag(pdl * fH2);
    L_cco2[j] = nCO2 * nCO2 * dzcm;
    L_cn2[j] = nN2 * nN2 * dzcm;
    L_ch2n2[j] = nH2 * nN2 * dzcm;
    L_ch2h2[j] = nH2 * nH2 * dzcm;
  }
  // radiative transfer
  let olr = 0;
  const Bl = new Float64Array(nL + 1);
  for (let k = 0; k < NK; k++) {
    const nu = NU[k];
    const kh = KAP.h2o[k], kc = KAP.co2[k], km = KAP.ch4[k], ks = KAP.so2[k], kself = KAP.self[k];
    const kcc = KAP.cia_co2[k], kcn = KAP.cia_n2[k], kh2n = KAP.cia_h2n2[k], kh2h = KAP.cia_h2h2[k];
    for (let j = 0; j <= nL; j++) Bl[j] = planckFlux(nu, T[j]);
    let I = Bl[0];
    for (let j = 0; j < nL; j++) {
      const tau = DIFF * (kh * L_h2o[j] + kself * (L_self[j] + L_for[j]) + kc * L_co2[j] + km * L_ch4[j] +
        ks * L_so2[j] + kcc * L_cco2[j] + kcn * L_cn2[j] + kh2n * L_ch2n2[j] + kh2h * L_ch2h2[j]);
      const Bb = Bl[j], Bt = Bl[j + 1];
      if (tau < 1e-4) {
        I = I * (1 - tau) + 0.5 * (Bb + Bt) * tau;
      } else {
        const t = Math.exp(-tau);
        I = I * t + Bt * (1 - t) + (Bb - Bt) * ((1 - t) / tau - t);
      }
    }
    const f = I * DNU[k];
    if (specOut) specOut[k] = I;
    olr += f;
  }
  return {
    olr, xvStrat: col.xvTrop, pS: col.pS, pv: col.pv, colH2O, Ttrop: col.Ttrop, pTrop: col.pTrop,
    T: col.T, P: col.P,
  };
}
