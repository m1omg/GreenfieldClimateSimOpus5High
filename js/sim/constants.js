// Physical and planetary constants (SI unless noted).

export const SIGMA = 5.670374419e-8;      // Stefan-Boltzmann
export const G_GRAV = 6.674e-11;
export const R_GAS = 8.314462618;          // J/mol/K
export const K_B = 1.380649e-23;
export const N_A = 6.02214076e23;
export const H_PLANCK = 6.62607015e-34;
export const C_LIGHT = 2.99792458e8;
export const C2 = 1.438777e-2;             // hc/k [m K]

export const YEAR = 3.15576e7;             // s
export const S_EARTH = 1361.0;             // W/m2, present solar constant

export const M_EARTH = 5.972e24;
export const R_EARTH = 6.371e6;
export const G_EARTH = 9.81;
export const A_EARTH = 4 * Math.PI * R_EARTH * R_EARTH;
export const OCEAN_EARTH = 1.4e21;         // kg, one "Earth ocean" (EO)
export const OMEGA_EARTH = 7.2921e-5;      // rad/s

// Molar masses (kg/mol)
export const MOLAR = {
  N2: 0.0280134,
  O2: 0.0319988,
  CO2: 0.0440095,
  CH4: 0.0160425,
  H2: 0.00201588,
  H2O: 0.01801528,
  SO2: 0.0640638,
  Ar: 0.039948,
};

// Isobaric heat capacities of ideal gases (J/kg/K), ~300 K values with
// a mild temperature dependence applied in thermo.js for hot atmospheres.
export const CP = {
  N2: 1040,
  O2: 918,
  CO2: 846,
  CH4: 2226,
  H2: 14300,
  H2O: 1864,
  SO2: 640,
};

// Water
export const T_TRIPLE = 273.16;
export const T_CRIT = 647.096;
export const P_CRIT = 22.064e6;
export const L_FUSION = 3.34e5;            // J/kg
export const C_WATER = 4184;               // J/kg/K liquid water
export const RHO_WATER = 1000;

// Rock
export const C_ROCK = 1000;                // J/kg/K
export const RHO_ROCK = 3000;
export const L_ROCK = 4.0e5;               // J/kg latent heat of silicate melting
export const T_SOLIDUS = 1400;             // K (surface pressure basalt solidus, approx)
export const T_LIQUIDUS = 1850;            // K

// Present-day Earth carbon cycle reference values
export const OUTGAS_EARTH = 7.5e12;        // mol CO2 / yr (whole planet)
export const PCO2_REF = 280e-6;            // bar, preindustrial
export const T_REF = 288.0;                // K

export const BAR = 1e5;
