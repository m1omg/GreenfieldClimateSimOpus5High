import { ClimateModel, NB } from '../js/sim/model.js';
import { classify } from '../js/sim/classify.js';
import { TUNE } from '../js/sim/model.js';
for (const a of process.argv.slice(2)) { const [k,v]=a.split('='); TUNE[k]=+v; }
const S=+(process.env.S||1.2);
const m=new ClimateModel({weathering: process.env.W==='1'}); m.advance(3000); m.p.instellation=S;
let E=0, last=m.s.t;
const EO=2.745e6;
let next=1;
const t0=m.s.t;
const pr=()=>{ const d=m.diag; console.log(`t+${(m.s.t-t0).toExponential(2)}yr Tm=${d.Tmean.toFixed(0)} liquid=${(m._liquid/EO).toFixed(3)}EO vapor=${(d.vapor/EO).toFixed(3)}EO pS=${(d.pS/1e5).toFixed(1)}bar imb=${d.imbalance.toFixed(1)} ASR=${d.asr.toFixed(0)} OLR=${d.olr.toFixed(0)} alb=${d.albedo.toFixed(3)} xs=${d.xStrat.toExponential(1)} W=${(m.s.W/EO).toFixed(3)} CO2=${(m.partials().CO2/1e5).toExponential(2)} state=${classify(m).key} dt=${m.dtLast.toExponential(1)} ∫imb=${(E/1e12).toFixed(2)}TJ/m2`); };
pr();
while (m.s.t - t0 < +(process.env.T||2e5)) {
  const before=m.s.t; const imb=m.diag.imbalance;
  m.advance(Math.max(10, (m.s.t-t0)*0.25), 20000);
  E += imb*(m.s.t-before)*3.156e7;
  if (m.s.t-t0 >= next) { pr(); next*=2.5; }
}
pr();
