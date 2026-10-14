import { ClimateModel } from '../js/sim/model.js';
import { PRESETS } from '../js/sim/presets.js';
import { classify } from '../js/sim/classify.js';
const P = PRESETS.find(p => p.id === (process.argv[2]||'snowball'));
const m = new ClimateModel(P.params);
let last = '', t0=performance.now();
const end = +(process.argv[3]||6e7);
while (m.s.t < end) {
  m.advance(Math.max(2000, m.s.t*0.05), 30000);
  const c = classify(m).key;
  if (c !== last || m.s.t >= end) { const d=m.diag; console.log(`t=${(m.s.t/1e6).toFixed(3)}Myr ${c} Tm=${d.Tmean.toFixed(1)} CO2=${(m.partials().CO2/1e5).toPrecision(3)}bar w/o=${(d.weath/d.outgas).toFixed(2)} alb=${d.albedo.toFixed(3)} ms=${(performance.now()-t0).toFixed(0)}`); last = c; }
}
