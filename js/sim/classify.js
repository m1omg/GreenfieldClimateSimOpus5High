// Climate-state classification with literature-based criteria.

export const STATES = {
  temperate: {
    name: 'Temperate · Habitable',
    color: '#4fc3a1',
    desc: 'Liquid oceans with modest polar ice; the carbonate–silicate cycle can regulate CO₂. Like the Holocene Earth.',
  },
  glacial: {
    name: 'Glacial (large ice caps)',
    color: '#9cc9e8',
    desc: 'Ice margins have advanced to mid-latitudes, as in Pleistocene ice ages. Still habitable, but close to the ice-albedo instability.',
  },
  waterbelt: {
    name: 'Waterbelt (Jormungand)',
    color: '#8fd3ff',
    desc: 'Ice reaches the subtropics, but a strip of open tropical ocean survives because bare sea ice in evaporative zones is darker than snow (Abbot et al. 2011).',
  },
  snowball: {
    name: 'Snowball',
    color: '#e8f4ff',
    desc: 'Global ice cover. Silicate weathering stops, so volcanic CO₂ slowly builds up until the ice melts back, which takes millions of years (Hoffman et al. 1998).',
  },
  eyeball: {
    name: 'Eyeball planet',
    color: '#7fd7e0',
    desc: 'A tidally locked world with open ocean only beneath its star. Thick substellar clouds keep the day side stable (Yang et al. 2013).',
  },
  hothouse: {
    name: 'Hothouse (ice-free)',
    color: '#e8b04f',
    desc: 'No permanent ice and a warm, humid climate, but the stratosphere is still dry enough that water loss is slow. Like the Cretaceous or the early Eocene.',
  },
  moistGreenhouse: {
    name: 'Moist greenhouse',
    color: '#f08a4b',
    desc: 'Stratospheric H₂O exceeds ~3×10⁻³, so hydrogen escapes fast enough to lose an Earth ocean in under ~1 Gyr (Kasting et al. 1993; Wolf & Toon 2015).',
  },
  runaway: {
    name: 'Runaway greenhouse · ocean boiling off',
    color: '#ff5a36',
    desc: 'Absorbed sunlight exceeds the ~282 W/m² limit a saturated steam atmosphere can radiate (Simpson–Nakajima limit). The ocean evaporates at a pace set by the energy imbalance, which takes kyr to Myr, then the surface heats rapidly.',
  },
  steam: {
    name: 'Wet runaway · steam atmosphere',
    color: '#ff8e5e',
    desc: 'The whole ocean is now a hot, dense steam atmosphere over a scorching (possibly molten) surface. It cools only once hydrogen escape strips the water (Hamano et al. 2013; Boukrouche et al. 2021).',
  },
  magma: {
    name: 'Magma ocean',
    color: '#ff3b1f',
    desc: 'The surface is hot enough to melt silicate rock (above ~1400 K), so the mantle exchanges volatiles directly with the atmosphere.',
  },
  venus: {
    name: 'Dry runaway · Venus-like',
    color: '#e6c27a',
    desc: 'Water has been lost to space. With no liquid water there is no silicate weathering, so outgassed and decomposed carbonate CO₂ builds a crushing, scorching atmosphere.',
  },
  hotDesert: {
    name: 'Hot desert / dry hothouse',
    color: '#d9a066',
    desc: 'A hot surface with too little water for oceans. Dry planets radiate efficiently and resist runaway (Abe et al. 2011; Kodama et al. 2018).',
  },
  desert: {
    name: 'Desert planet (land planet)',
    color: '#d6b37a',
    desc: 'Little surface water, mostly cold-trapped as polar or nightside ice. Low humidity widens the habitable zone in both directions (Abe et al. 2011).',
  },
  coldTrap: {
    name: 'Cold-trapped (collapsed) water',
    color: '#b8d0e6',
    desc: 'Water is locked in permanent ice caps on the night side or poles, leaving a dry day side. This is the "moist bistability" of close-in land planets (Leconte et al. 2013).',
  },
  marsLike: {
    name: 'Mars-like cold desert',
    color: '#c9774a',
    desc: 'A thin atmosphere with weak heat transport and greenhouse effect. Water survives only as ice, or as briny films near the triple point.',
  },
  collapse: {
    name: 'Atmospheric collapse (CO₂ frost)',
    color: '#d7e3f0',
    desc: 'CO₂ condenses onto the coldest surfaces, setting the maximum-greenhouse (outer-edge) limit of the habitable zone (Kasting et al. 1993; Kopparapu et al. 2013).',
  },
  airless: {
    name: 'Airless / barren',
    color: '#9a9a9a',
    desc: 'The atmosphere is gone, eroded by stellar activity and escape (cosmic-shoreline scaling, Zahnle & Catling 2017).',
  },
  waterworld: {
    name: 'Waterworld',
    color: '#3f8fd6',
    desc: 'A global ocean with no exposed land. Seafloor weathering alone regulates CO₂. Beyond ~1 GPa, high-pressure ice seals the seafloor and the carbon cycle stalls (Kite & Ford 2018).',
  },
  hazy: {
    name: 'Hazy (Titan-like)',
    color: '#d99a4a',
    desc: 'When CH₄/CO₂ exceeds ~0.1, organic haze forms. It absorbs sunlight high up and creates an anti-greenhouse effect (Haqq-Misra et al. 2008).',
  },
  h2greenhouse: {
    name: 'Hydrogen greenhouse',
    color: '#b48cf0',
    desc: 'H₂ collision-induced absorption keeps a planet warm far beyond the usual outer edge (Pierrehumbert & Gaidos 2011).',
  },
};

/**
 * Classify the current model state. Returns { key, tags[] }.
 * @param {ClimateModel} m
 */
export function classify(m) {
  const d = m.diag, s = m.s;
  const pp = m.partials();
  const pS = d.pS / 1e5;
  const Tm = d.Tmean;
  const tags = [];
  const NB = s.T.length;
  const liquid = m._liquid ?? 0;
  const EO = 2.745e6 * (5.1e14 / m.area); // kg/m2 of one Earth ocean on this planet
  const vaporFrac = d.pv / Math.max(d.pS, 1);
  // open (ice-free) ocean fraction
  let openOcean = 0, ocean = 0, iceLatN = 90, iceLatS = -90;
  for (let i = 0; i < NB; i++) {
    const si = m._seaIce(s.T[i]);
    openOcean += m.a[i] * m.fOcean[i] * (1 - si);
    ocean += m.a[i] * m.fOcean[i];
  }
  // ice margin latitudes (rotating planets)
  const latDeg = (i) => m.lat[i] * 180 / Math.PI;
  for (let i = Math.floor(NB / 2); i < NB; i++) if (m._seaIce(s.T[i]) > 0.5) { iceLatN = latDeg(i); break; }
  for (let i = Math.floor(NB / 2) - 1; i >= 0; i--) if (m._seaIce(s.T[i]) > 0.5) { iceLatS = latDeg(i); break; }
  const iceMargin = Math.min(Math.abs(iceLatN), Math.abs(iceLatS));
  const co2iceMol = m.co2iceTot || 0;
  const nCO2 = s.nCO2;
  const hazeTau = d.tauH || 0;
  const xH2 = pp.H2 / Math.max(pp.total, 1);
  const water = s.W;

  if (pS < 1e-4) return { key: 'airless', tags };
  if (Tm > 1400) {
    if (vaporFrac > 0.1) tags.push('steam envelope');
    return { key: 'magma', tags };
  }
  // runaway: liquid ocean, hot, positive imbalance
  if (liquid > 0.002 * EO && Tm > 330 && d.imbalance > 0.5 && vaporFrac > 0.15) {
    return { key: 'runaway', tags };
  }
  if (liquid < 0.001 * EO && vaporFrac > 0.3 && d.vapor > 3000) {
    return { key: 'steam', tags };
  }
  if (liquid < 0.001 * EO && Tm > 450) {
    if (pS > 3) return { key: 'venus', tags };
    return { key: 'hotDesert', tags };
  }
  if (co2iceMol > 0.25 * Math.max(nCO2, 1e-9) && co2iceMol > 1) tags.push('CO₂ ice caps');
  if (co2iceMol > Math.max(nCO2, 1e-9) && co2iceMol > 10) return { key: 'collapse', tags };
  if (pS < 0.05 && Tm < 260) return { key: 'marsLike', tags };
  if (hazeTau > 0.5) tags.push('organic haze');
  if (xH2 > 0.05) tags.push('H₂ greenhouse');

  const ice = ocean > 0.02 ? 1 - openOcean / ocean : 0;
  const totalWaterEO = water / EO;
  // moist greenhouse (water loss regime) while oceans persist
  if (liquid > 0.002 * EO && d.xStrat > 3e-3) {
    return { key: 'moistGreenhouse', tags };
  }
  if (totalWaterEO < 0.05 || ocean < 0.08) {
    // land / desert planets
    let iceSheets = 0;
    for (let i = 0; i < NB; i++) iceSheets += m.a[i] * s.ice[i];
    if (m.locked && iceSheets > 0.6 * water && water > 0) return { key: 'coldTrap', tags };
    if (Tm > 330) return { key: 'hotDesert', tags };
    if (water < 1) tags.push('bone dry');
    if (hazeTau > 1) return { key: 'hazy', tags };
    return { key: 'desert', tags };
  }
  if (m.locked) {
    if (openOcean < 0.002) return { key: 'snowball', tags };
    if (ice > 0.35) return { key: 'eyeball', tags };
  } else {
    if (openOcean < 0.002) return { key: 'snowball', tags };
    if (iceMargin < 28) return { key: 'waterbelt', tags };
    if (iceMargin < 48 && Tm < 283) return { key: 'glacial', tags };
  }
  if (hazeTau > 1 && Tm < 270) return { key: 'hazy', tags };
  if (xH2 > 0.05 && Tm > 260) tags.push('H₂-warmed');
  if (ocean > 0.995) tags.push('global ocean');
  if (m.hpIce) tags.push('HP-ice seafloor');
  if (pp.O2 / 1e5 > 0.05 && !s.lifeOn) tags.push('abiotic O₂');
  if (Tm > 303 && ice < 0.02) return { key: 'hothouse', tags };
  if (ocean > 0.995) return { key: 'waterworld', tags };
  return { key: 'temperate', tags };
}
