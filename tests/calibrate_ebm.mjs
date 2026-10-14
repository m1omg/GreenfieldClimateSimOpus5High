// Earth calibration of the energy-balance model (fixed CO2, weathering off).
import { ClimateModel, NB, TUNE } from '../js/sim/model.js';
for (const a of process.argv.slice(2)) { const [k,v]=a.split('='); TUNE[k]=+v; }
const params = JSON.parse(process.env.P || '{}');
const m = new ClimateModel({ weathering:false, ...params });
const years = +(process.env.Y || 3000);
console.error("start advance"); m.advance(years); console.error("advance done", m.s.t);
const d=m.diag;
const T=m.s.T, lat=i=>m.lat[i]*180/Math.PI;
let iceLat=90; for(let i=NB/2;i<NB;i++){ if(m._seaIce(T[i])>0.5 && m.fOcean[i]>0.1){ iceLat=lat(i); break; } }
const band=(lo,hi)=>{let s=0,w=0; for(let i=0;i<NB;i++){const L=Math.abs(lat(i)); if(L>=lo&&L<hi){s+=m.a[i]*T[i]; w+=m.a[i];}} return s/w;};
console.log(`Tmean ${d.Tmean.toFixed(2)} alb ${d.albedo.toFixed(3)} ASR ${d.asr.toFixed(1)} OLR ${d.olr.toFixed(1)} | clear ASR ${d.asrClear.toFixed(1)} OLR ${d.olrClear.toFixed(1)} | CRE_SW ${(d.asr-d.asrClear).toFixed(1)} CRE_LW ${(d.olrClear-d.olr).toFixed(1)}`);
console.log(`T 0-10: ${band(0,10).toFixed(1)}  30-40: ${band(30,40).toFixed(1)}  50-60: ${band(50,60).toFixed(1)}  60-70: ${band(60,70).toFixed(1)}  80-90: ${band(80,90).toFixed(1)} | seaice edge NH ${iceLat.toFixed(0)} | Td ${m.s.Td.toFixed(1)} vapor ${d.vapor.toFixed(1)} rh ${m._rh.toFixed(2)} Tstrat ${m.s.Tstrat.toFixed(0)} ocean ${m._oceanCover().toFixed(3)} weathering-demand ${(d.weath/d.outgas).toFixed(2)} xs ${d.xStrat.toExponential(2)}`);
m.p.weathering = true;
const st = m._snapshot();
m._slowStep(1e-6);
console.log(`weathering/outgassing at 280 ppm: ${(m.diag.weath/m.diag.outgas).toFixed(3)} -> suggested W0 ${(TUNE.W0*m.diag.outgas/(m.diag.weath)).toFixed(4)} (approx, includes seafloor)`);
