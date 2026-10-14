// Host-star properties: effective temperature, bolometric evolution and XUV activity.

export const STAR_TYPES = {
  F: { name: 'F-type (6500 K)', Teff: 6500, msLife: 4.0, xuvSat: 2.0e-4, tSat: 0.05, color: [1.0, 0.97, 0.93] },
  G: { name: 'G-type, Sun-like (5772 K)', Teff: 5772, msLife: 10.0, xuvSat: 4.0e-4, tSat: 0.1, color: [1.0, 0.95, 0.88] },
  K: { name: 'K-type (4500 K)', Teff: 4500, msLife: 25.0, xuvSat: 8.0e-4, tSat: 0.3, color: [1.0, 0.82, 0.62] },
  M: { name: 'Early M dwarf (3500 K)', Teff: 3500, msLife: 200.0, xuvSat: 1.0e-3, tSat: 1.0, color: [1.0, 0.66, 0.42] },
  Mlate: { name: 'Late M dwarf (2800 K)', Teff: 2800, msLife: 1000.0, xuvSat: 1.0e-3, tSat: 3.0, color: [1.0, 0.55, 0.32] },
};

/**
 * Relative bolometric luminosity L(age)/L(age_ref). Uses Gough (1981) for Sun-like stars,
 * time-scaled by main-sequence lifetime for other types. Clamped before post-MS evolution.
 */
export function lumFactor(type, ageGyr) {
  const st = STAR_TYPES[type] || STAR_TYPES.G;
  // map age onto the solar track
  const tSun = Math.min(ageGyr * (10 / st.msLife), 9.5);
  if (type === 'M' || type === 'Mlate') return 1; // essentially constant on Gyr timescales
  return 1 / (1 + 0.4 * (1 - tSun / 4.57));
}

/** XUV / bolometric flux ratio at a given age (Ribas et al. 2005 power law after saturation). */
export function xuvRatio(type, ageGyr) {
  const st = STAR_TYPES[type] || STAR_TYPES.G;
  const t = Math.max(0.01, ageGyr);
  if (t <= st.tSat) return st.xuvSat;
  return st.xuvSat * Math.pow(t / st.tSat, -1.23);
}
