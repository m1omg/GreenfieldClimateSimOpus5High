// Thermodynamics of water and CO2 phase equilibria.
import { T_TRIPLE, T_CRIT, P_CRIT, R_GAS, MOLAR } from './constants.js';

const RV = R_GAS / MOLAR.H2O;
const WP = [-7.85951783, 1.84408259, -11.7866497, 22.6807411, -15.9618719, 1.80122502];

// Wagner & Pruss (2002) saturation vapour pressure over liquid water, valid T_triple..T_crit.
function psatLiquid(T) {
  const tau = 1 - T / T_CRIT;
  const s = WP[0] * tau + WP[1] * Math.pow(tau, 1.5) + WP[2] * tau ** 3 +
    WP[3] * Math.pow(tau, 3.5) + WP[4] * tau ** 4 + WP[5] * Math.pow(tau, 7.5);
  return P_CRIT * Math.exp((T_CRIT / T) * s);
}

// Murphy & Koop (2005) over ice, valid down to ~110 K.
function psatIce(T) {
  return Math.exp(9.550426 - 5723.265 / T + 3.53068 * Math.log(T) - 0.00728332 * T);
}

// Slope d ln p / d ln T at the critical point, used to extend the curve above T_crit
// (supercritical water: no phase boundary; the extension just keeps the ocean fully
// "evaporated" in a smooth, monotonic way).
const T_EXT = T_CRIT - 0.5;
const P_EXT = psatLiquid(T_EXT);
const SLOPE_EXT = (Math.log(psatLiquid(T_EXT)) - Math.log(psatLiquid(T_EXT - 2))) /
  (Math.log(T_EXT) - Math.log(T_EXT - 2));

/** Saturation vapour pressure of water [Pa]. */
export function psat(T) {
  if (T < 100) T = 100;
  if (T < T_TRIPLE) return psatIce(T);
  if (T < T_EXT) return psatLiquid(T);
  return P_EXT * Math.pow(T / T_EXT, SLOPE_EXT);
}

/** d ln psat / d ln T (dimensionless), numerically. */
export function dlnPsatDlnT(T) {
  const h = 0.25;
  return (Math.log(psat(T + h)) - Math.log(psat(T - h))) / (Math.log(T + h) - Math.log(T - h));
}

/** Effective latent heat (J/kg) consistent with the saturation curve via Clausius–Clapeyron. */
export function latentEff(T) {
  return RV * T * dlnPsatDlnT(T);
}

/** Latent heat of vaporisation (Watson correlation), J/kg; goes to 0 at the critical point. */
export function latentVap(T) {
  if (T >= T_CRIT) return 0;
  if (T < T_TRIPLE) return 2.834e6; // sublimation
  return 2.501e6 * Math.pow((T_CRIT - T) / (T_CRIT - T_TRIPLE), 0.38);
}

/** CO2 frost point [K] for a CO2 partial pressure p [Pa] (sublimation curve). */
export function co2FrostPoint(p) {
  if (p <= 1e-3) return 0;
  // ln(p/p0) = (L/R)(1/T0 - 1/T), L/R = 3030 K, T0 = 194.7 K at 1 atm.
  const inv = 1 / 194.7 - Math.log(p / 101325) / 3030;
  return 1 / inv;
}

/** Saturation CO2 pressure (Pa) over CO2 ice at temperature T. */
export function co2Psat(T) {
  return 101325 * Math.exp(3030 * (1 / 194.7 - 1 / T));
}

export const RV_WATER = RV;
