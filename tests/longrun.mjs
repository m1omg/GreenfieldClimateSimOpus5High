import { ClimateModel, NB, TUNE } from '../js/sim/model.js';
const params = JSON.parse(process.env.P || '{}');
const m = new ClimateModel(params);
const marks = (process.env.M || '1e3,1e4,1e5,1e6,1e7,5e7').split(',').map(Number);
let t0=performance.now(), prev=0;
const hdr = () => {
  const d=m.diag, s=m.s, pp=m.partials();
  const ice = s.ice.reduce((a,b,i)=>a+b*m.a[i],0);
  return `t=${s.t.toExponential(2)} Tm=${d.Tmean.toFixed(1)} [${d.Tmin.toFixed(0)}-${d.Tmax.toFixed(0)}] alb=${d.albedo.toFixed(3)} pCO2=${(pp.CO2/1e5).toExponential(2)}bar pS=${(d.pS/1e5).toFixed(3)} H2O(vap)=${d.vapor.toExponential(2)} W=${(s.W/2.745e6).toFixed(3)}EO ice=${(ice/2.745e6).toFixed(3)}EO ocean=${m._oceanCover().toFixed(2)} xs=${d.xStrat.toExponential(1)} w/o=${(d.weath/d.outgas).toFixed(2)} O2=${(pp.O2/1e5).toExponential(1)} imb=${d.imbalance.toFixed(1)} dt=${m.dtLast.toExponential(1)} ms=${(performance.now()-t0).toFixed(0)}`;
};
console.log(hdr());
for (const t of marks) { m.advance(t - prev); prev = t; console.log(hdr()); }
