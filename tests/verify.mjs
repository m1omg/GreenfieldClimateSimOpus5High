// Verification suite: runs the climate model headlessly and checks it against literature targets.
// Usage: node tests/verify.mjs            (takes a few minutes)
import { ClimateModel, NB } from '../js/sim/model.js';
import { PRESETS } from '../js/sim/presets.js';
import { classify } from '../js/sim/classify.js';
import { columnOLR } from '../js/sim/radiation.js';

const results = [];
function check(name, value, lo, hi, unit = '', ref = '') {
  const ok = value >= lo && value <= hi;
  results.push({ name, value, lo, hi, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${typeof value === 'number' ? value.toPrecision(4) : value} ${unit}  [${lo}–${hi}] ${ref}`);
}
const preset = (id) => PRESETS.find(p => p.id === id).params;
const earthCol = (Ts, co2 = 280e-6) => ({ g: 9.81, pd: { N2: 0.78e5, O2: 0.21e5, CO2: co2 * 1e5, CH4: 0.18 }, pvCap: 1e12, rh: 0.77, Tstrat: 200 });

console.log('--- Radiative transfer (clear sky, 1D column)');
check('Earth clear-sky OLR at 288 K', columnOLR(288, earthCol()).olr, 255, 275, 'W/m²', 'CERES ~265');
check('CO2 doubling forcing (clear sky)', columnOLR(288, earthCol()).olr - columnOLR(288, earthCol(288, 560e-6)).olr, 3.0, 4.5, 'W/m²', 'Myhre 1998: 3.7');
{ let s = 0; for (const T of [450, 600, 800, 1000]) s += columnOLR(T, { g: 9.81, pd: { N2: 1 }, pvCap: 270e5, rh: 1, Tstrat: 180 }).olr / 4;
  check('Steam-atmosphere radiation limit', s, 275, 290, 'W/m²', 'Goldblatt 2013: 282'); }

console.log('--- Modern Earth');
const e = new ClimateModel(preset('earth')); e.advance(1e6);
check('Global mean surface temperature', e.diag.Tmean, 285, 290.5, 'K', '288');
check('Bond albedo', e.diag.albedo, 0.28, 0.34, '', '0.29–0.31');
check('Equator–pole temperature difference', e.diag.Tmax - e.diag.Tmin, 45, 70, 'K');
check('Weathering balances outgassing (CO2 ppm)', e.partials().CO2 / 1e5 * 1e6, 150, 600, 'ppm', '280');
check('State is temperate', classify(e).key === 'temperate' ? 1 : 0, 1, 1);
e.advance(1e8);
check('Still temperate after 100 Myr (T)', e.diag.Tmean, 284, 291, 'K');

console.log('--- Climate sensitivity');
const a = new ClimateModel({ ...preset('earth'), weathering: false }); a.advance(8000);
const b = new ClimateModel({ ...preset('earth'), weathering: false, pCO2: 560e-6 }); b.advance(8000);
check('Equilibrium climate sensitivity (2xCO2)', b.diag.Tmean - a.diag.Tmean, 2.0, 4.5, 'K', 'IPCC AR6 2.5–4');

console.log('--- Cold side');
{ let snowAt = null;
  const m = new ClimateModel({ ...preset('earth'), weathering: false }); m.advance(4000);
  for (let S = 1.0; S > 0.85; S -= 0.01) { m.p.instellation = S; m.advance(3000); if (m.diag.Tmean < 245) { snowAt = S; break; } }
  check('Snowball onset (fixed CO2, quasi-static)', snowAt ?? 0, 0.90, 0.96, 'S⊕', 'GCMs ~0.91–0.96'); }
{ const m = new ClimateModel(preset('snowball'));
  let frozeAt = null, thawAt = null, co2Thaw = 0;
  while (m.s.t < 3e7) { m.advance(5e4); const k = classify(m).key; if (!frozeAt && (k === 'snowball')) frozeAt = m.s.t; if (frozeAt && !thawAt && (k === 'temperate' || k === 'hothouse')) { thawAt = m.s.t; co2Thaw = m.partials().CO2 / 1e5; } }
  check('Snowball forms', frozeAt !== null ? 1 : 0, 1, 1);
  check('Snowball duration before thaw', thawAt && frozeAt ? (thawAt - frozeAt) / 1e6 : 0, 0.5, 30, 'Myr', 'Hoffman: Myr');
  check('CO2 at deglaciation', co2Thaw, 0.01, 0.5, 'bar', '0.01–0.3'); }

console.log('--- Hot side');
{ const m = new ClimateModel({ ...preset('earth'), weathering: false }); m.advance(3000); m.p.instellation = 1.1; m.advance(5000);
  check('1.10 S⊕: no runaway (T)', m.diag.Tmean, 295, 335, 'K'); }
{ const m = new ClimateModel({ ...preset('earth'), weathering: false }); m.advance(3000); m.p.instellation = 1.3;
  const t0 = m.s.t; let tGone = null;
  while (m.s.t - t0 < 2e5) { m.advance(500); if (tGone === null && m._liquid < 0.001 * 2.745e6) tGone = m.s.t - t0; }
  check('1.30 S⊕: ocean fully evaporates', tGone !== null ? 1 : 0, 1, 1);
  check('Time to evaporate the ocean at 1.3 S⊕', tGone ?? 1e9, 1e3, 2e5, 'yr', 'energy budget: kyr');
  check('Post-runaway surface temperature', m.diag.Tmean, 1300, 2600, 'K', 'Boukrouche 2021: >~1500');
  check('Steam surface pressure', m.diag.pS / 1e5, 250, 320, 'bar', '~270'); }

console.log('--- Solar-system planets');
{ const m = new ClimateModel(preset('venus')); m.advance(1e5);
  check('Venus surface temperature', m.diag.Tmean, 690, 790, 'K', '737'); check('Venus Bond albedo', m.diag.albedo, 0.65, 0.8, '', '0.76'); }
{ const m = new ClimateModel(preset('mars')); m.advance(1e5);
  check('Mars mean surface temperature', m.diag.Tmean, 195, 225, 'K', '~210'); check('Mars surface pressure', m.diag.pS / 1e5 * 1000, 3, 9, 'mbar', '6'); }

console.log('--- Other regimes');
{ const m = new ClimateModel(preset('proxima')); m.advance(3e4); check('Proxima b: eyeball state', classify(m).key === 'eyeball' ? 1 : 0, 1, 1); }
{ const m = new ClimateModel(preset('dune')); m.advance(1e5); check('Desert planet at 1.25 S⊕ stays below runaway', m.diag.Tmean, 270, 340, 'K', 'Abe 2011'); }
{ const m = new ClimateModel(preset('waterworld')); m.advance(1e5); check('Waterworld: HP-ice seals seafloor', m.hpIce ? 1 : 0, 1, 1, '', 'Kite & Ford 2018'); }

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
