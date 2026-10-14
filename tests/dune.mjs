import { ClimateModel, NB } from '../js/sim/model.js';
import { PRESETS } from '../js/sim/presets.js';
import { classify } from '../js/sim/classify.js';
const P = PRESETS.find(p => p.id === 'dune');
const m = new ClimateModel({ ...P.params, ...(JSON.parse(process.env.P||'{}')) });
const EO=2.745e6;
for (const t of [0, 10, 100, 1000, 1e4, 3e4, 1e5]) {
  if (t) m.advance(t - m.s.t, 30000);
  const d=m.diag; let ice=0; for(let i=0;i<NB;i++) ice+=m.a[i]*m.s.ice[i];
  console.log(`t=${m.s.t.toExponential(1)} Tm=${d.Tmean.toFixed(1)} [${d.Tmin.toFixed(0)}-${d.Tmax.toFixed(0)}] rh=${(m._rh??0).toFixed(3)} wet=${(m._wet??0).toFixed(3)} vapor=${(d.vapor/EO).toExponential(2)} liquid=${(m._liquid/EO).toExponential(2)} ice=${(ice/EO).toExponential(2)} ocean=${m._oceanCover().toFixed(3)} alb=${d.albedo.toFixed(3)} OLR=${d.olr.toFixed(0)} state=${classify(m).key}`);
}
