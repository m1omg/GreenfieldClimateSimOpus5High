import { ClimateModel } from '../js/sim/model.js';
const m = new ClimateModel({}); m.advance(3000); m.p.instellation = +(process.env.S||1.17); m.advance(2e6);
const of=m._fastStep.bind(m), ol=m._slowLimit.bind(m); let nf=0, rej=0, lims={}; const lw0=m.lw.builds, sw0=m.sw.builds;
m._fastStep=(dt,e)=>{ nf++; return of(dt,e); };
let lastDt=[];
const t0=performance.now(); m.advance(2e6, 60000); const ms=performance.now()-t0;
console.log(`2 Myr in ${ms.toFixed(0)} ms, steps ${nf}, dtLast ${m.dtLast.toExponential(2)}, LW builds ${m.lw.builds-lw0}, SW ${m.sw.builds-sw0}, Tm ${m.diag.Tmean.toFixed(1)} xs ${m.diag.xStrat.toExponential(1)} CO2 ${(m.partials().CO2/1e5*1e6).toPrecision(3)}ppm`);
// what limits dt? sample one step
const snap=m._snapshot(); const dt=1e5; const maxdT=of(dt); m._slowStep(dt); console.log('trial dt=1e5 maxdT', maxdT.toFixed(2), 'slowLimit', ol(snap).toFixed(2), 'C', m.s.Cexo.toExponential(3), snap.s.Cexo.toExponential(3), 'O2', m.s.n.O2.toExponential(3), snap.s.n.O2.toExponential(3), 'W', m.s.W.toExponential(4), snap.s.W.toExponential(4));
