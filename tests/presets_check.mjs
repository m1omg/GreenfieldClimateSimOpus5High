import { ClimateModel } from '../js/sim/model.js';
import { PRESETS } from '../js/sim/presets.js';
import { classify } from '../js/sim/classify.js';
const ids = process.argv.slice(2);
for (const spec of ids) {
  const [id, yrs] = spec.split(':');
  const P = PRESETS.find(p => p.id === id);
  const m = new ClimateModel(P.params);
  const t0 = performance.now();
  const marks = [1e3, 1e4, 1e5, 1e6, +yrs].filter(x => x <= +yrs);
  let prev = 0;
  for (const t of marks) {
    m.advance(t - prev, 60000); prev = t;
    const d = m.diag, pp = m.partials();
    console.log(`${id.padEnd(12)} t=${m.s.t.toExponential(1)} Tm=${d.Tmean.toFixed(1)} [${d.Tmin.toFixed(0)}-${d.Tmax.toFixed(0)}] pS=${(d.pS/1e5).toPrecision(3)}bar CO2=${(pp.CO2/1e5).toPrecision(3)} alb=${d.albedo.toFixed(3)} liq=${(m._liquid/2.745e6*m.area/5.1e14).toPrecision(3)}EO ocean=${m._oceanCover().toFixed(2)} co2ice=${(m.co2iceTot||0).toFixed(1)} state=${classify(m).key} ms=${(performance.now()-t0).toFixed(0)}`);
  }
}
