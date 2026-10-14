import { ClimateModel } from '../js/sim/model.js';
import { PRESETS } from '../js/sim/presets.js';
import { classify } from '../js/sim/classify.js';
const m = new ClimateModel(PRESETS.find(p => p.id === 'futureEarth').params);
let last = '', t0 = performance.now();
while (m.s.t < 2.5e9) {
  m.advance(2e7, 120000);
  const k = classify(m).key, d = m.diag;
  const line = `t=+${(m.s.t/1e9).toFixed(2)}Gyr S=${m.instellation().toFixed(3)} ${k} Tm=${d.Tmean.toFixed(1)} CO2=${(m.partials().CO2/1e5*1e6).toPrecision(3)}ppm xs=${d.xStrat.toExponential(1)} water=${(m.s.W/2.745e6).toFixed(3)}EO ms=${(performance.now()-t0).toFixed(0)}`;
  if (k !== last || Math.round(m.s.t/1e7) % 25 === 0) { console.log(line); last = k; }
}
