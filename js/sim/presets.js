// Starting configurations. Values are literature-based where a real world is named.

const EARTH = {
  massE: 1.0, waterEO: 1.0, instellation: 1.0, starType: 'G', ageGyr: 4.57, stellarEvolution: false,
  rotationHours: 24, tidallyLocked: false, obliquity: 23.44,
  pN2: 0.78, pO2: 0.21, pCO2: 280e-6, pCH4: 1.8e-6, pH2: 0, pSO2: 0,
  outgassing: 1.0, tectonics: 'plate', weathering: true, biosphere: true, relief: 1.0, seed: 7,
  crustCarbonBar: 60,
};

export const PRESETS = [
  {
    id: 'earth', name: 'Modern Earth', speed: 1e4,
    note: 'Pre-industrial Earth. The carbonate–silicate cycle keeps it stable over millions of years.',
    params: { ...EARTH },
  },
  {
    id: 'futureEarth', name: 'Future Earth (aging Sun)', speed: 3e6,
    note: 'Stellar evolution is on. Weathering draws CO₂ down as the Sun brightens until it can no longer compensate: then come the moist greenhouse and runaway in ~1–2 Gyr.',
    params: { ...EARTH, stellarEvolution: true },
  },
  {
    id: 'snowball', name: 'Neoproterozoic Snowball', speed: 2e5,
    note: 'A 6% fainter Sun, low CO₂ and no land plants. The planet freezes over, then volcanic CO₂ builds up for millions of years until it melts back out.',
    params: { ...EARTH, instellation: 0.935, pCO2: 40e-6, pCH4: 1e-6, pO2: 0.05, biosphere: false, ageGyr: 3.9 },
  },
  {
    id: 'archean', name: 'Archean Earth', speed: 1e5,
    note: 'Faint young Sun (~80%) kept warm by abundant CO₂ and CH₄ (Kasting 2010). Raise CH₄/CO₂ above ~0.1 to get organic haze.',
    params: { ...EARTH, instellation: 0.8, ageGyr: 1.0, pCO2: 0.03, pCH4: 1e-3, pO2: 1e-6, pN2: 1.0, biosphere: true, outgassing: 2.5 },
  },
  {
    id: 'runaway', name: 'Runaway greenhouse (Earth at 1.3 S⊕)', speed: 1e3,
    note: 'An Earth moved to 1.3× today\'s insolation. Watch the ocean boil off over kyr, the steam atmosphere heat the surface to magma, then carbonates release CO₂.',
    params: { ...EARTH, instellation: 1.3 },
  },
  {
    id: 'earlyVenus', name: 'Early Venus (wet)', speed: 5e4,
    note: 'Venus 4 Gyr ago with an Earth-like ocean and a young, active Sun. Whether it ever had oceans is debated (Way et al. 2016; Turbet et al. 2021).',
    params: { ...EARTH, massE: 0.815, instellation: 1.91 * 0.75, ageGyr: 0.6, rotationHours: 2802, obliquity: 2.6, pO2: 0, pCH4: 0, biosphere: false, stellarEvolution: true },
  },
  {
    id: 'venus', name: 'Venus today', speed: 1e5,
    note: '92 bar of CO₂, almost no water, sulfuric-acid clouds and a 737 K surface: the end state of a dry runaway greenhouse.',
    params: { ...EARTH, massE: 0.815, waterEO: 2e-5, instellation: 1.91, rotationHours: 2802, obliquity: 2.6, pN2: 3.2, pO2: 0, pCO2: 89, pCH4: 0, pSO2: 0.014, weathering: false, biosphere: false, crustCarbonBar: 0, tectonics: 'stagnant' },
  },
  {
    id: 'mars', name: 'Mars today', speed: 1e5,
    note: 'A 0.0063 bar CO₂ atmosphere on a small planet. Weak greenhouse, frozen water and CO₂ frost caps.',
    params: { ...EARTH, massE: 0.107, waterEO: 0.0015, instellation: 0.431, rotationHours: 24.62, obliquity: 25.2, pN2: 0.00012, pO2: 0, pCO2: 0.0061, pCH4: 0, biosphere: false, tectonics: 'stagnant', outgassing: 0.02, crustCarbonBar: 0 },
  },
  {
    id: 'earlyMars', name: 'Early Mars (1 bar CO₂)', speed: 1e5,
    note: 'Faint young Sun plus a thick CO₂ atmosphere. CO₂ alone cannot get the global mean above freezing (Kasting 1991; Wordsworth 2016); try adding H₂. Below ~30° obliquity the poles drop under the CO₂ frost point and the atmosphere collapses onto the caps (Forget et al. 2013).',
    params: { ...EARTH, massE: 0.107, waterEO: 0.02, instellation: 0.431 * 0.75, ageGyr: 0.8, rotationHours: 24.62, obliquity: 40, pN2: 0.01, pO2: 0, pCO2: 1.0, pCH4: 0, biosphere: false, tectonics: 'stagnant', outgassing: 0.1 },
  },
  {
    id: 'proxima', name: 'Proxima b (eyeball)', speed: 1e4,
    note: 'A tidally locked aquaplanet around a late M dwarf, 0.65 S⊕. Open ocean survives only under the star (Turbet et al. 2016). Intense XUV drives water loss.',
    params: { ...EARTH, massE: 1.07, instellation: 0.65, starType: 'Mlate', tidallyLocked: true, rotationHours: 11.19 * 24, obliquity: 0, pCO2: 400e-6, pO2: 0, pCH4: 0, pN2: 1.0, biosphere: false, waterEO: 1.0, ageGyr: 4.8 },
  },
  {
    id: 'trappist', name: 'TRAPPIST-1e-like', speed: 1e4,
    note: 'A 0.69 M⊕ tidally locked world at 0.66 S⊕ around an ultracool dwarf. Its climate hinges on CO₂ and heat transport.',
    params: { ...EARTH, massE: 0.69, instellation: 0.66, starType: 'Mlate', tidallyLocked: true, rotationHours: 6.1 * 24, obliquity: 0, pCO2: 0.01, pO2: 0, pCH4: 0, pN2: 1.0, biosphere: false, waterEO: 1, ageGyr: 7.6 },
  },
  {
    id: 'dune', name: 'Desert planet (land planet)', speed: 1e4,
    note: 'Only 0.3% of an Earth ocean. Water collects in polar caps and the dry air resists runaway well past Earth\'s limit (Abe et al. 2011).',
    params: { ...EARTH, waterEO: 0.003, instellation: 1.25, pCO2: 600e-6, biosphere: false, pO2: 0.05 },
  },
  {
    id: 'waterworld', name: 'Deep waterworld (50 oceans)', speed: 1e5,
    note: 'No land at all. High-pressure ice seals the seafloor, so silicate weathering stops and CO₂ is no longer regulated (Kite & Ford 2018).',
    params: { ...EARTH, waterEO: 50, massE: 1.5 },
  },
  {
    id: 'superEarth', name: 'Super-Earth (5 M⊕)', speed: 1e4,
    note: 'Stronger gravity gives a thinner water column per unit area and pushes the runaway threshold to higher insolation (Kopparapu et al. 2014).',
    params: { ...EARTH, massE: 5, waterEO: 3, pN2: 2.5 },
  },
  {
    id: 'slowRotator', name: 'Slow rotator (100 d day)', speed: 1e4,
    note: 'Slow rotation builds a dayside cloud shield that keeps the planet habitable at higher insolation (Yang et al. 2014).',
    params: { ...EARTH, instellation: 1.25, rotationHours: 2400 },
  },
  {
    id: 'h2', name: 'Hydrogen greenhouse (cold orbit)', speed: 1e3,
    note: 'A super-Earth at 0.12 S⊕ warmed by H₂ collision-induced absorption (Pierrehumbert & Gaidos 2011). H₂ escapes over time unless resupplied.',
    params: { ...EARTH, massE: 4, instellation: 0.12, pH2: 7, pN2: 2, pO2: 0, pCO2: 0.01, pCH4: 0, biosphere: false, starType: 'K' },
  },
];
