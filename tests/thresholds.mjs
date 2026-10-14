import { ClimateModel, NB } from '../js/sim/model.js';
const fmt = (m) => { const d=m.diag, pp=m.partials(); return `Tm=${d.Tmean.toFixed(1)} [${d.Tmin.toFixed(0)}-${d.Tmax.toFixed(0)}] alb=${d.albedo.toFixed(3)} xs=${d.xStrat.toExponential(1)} pS=${(d.pS/1e5).toFixed(2)} ocean=${m._oceanCover().toFixed(2)} W=${(m.s.W/2.745e6).toFixed(3)} imb=${d.imbalance.toFixed(1)}`; };
const which = process.argv[2] || 'all';
import { TUNE } from '../js/sim/model.js';
for (const a of process.argv.slice(3)) { const [k,v]=a.split('='); TUNE[k]=+v; }
if (which==='all'||which==='ecs') {
  const a = new ClimateModel({weathering:false}); a.advance(6000);
  const b = new ClimateModel({weathering:false, pCO2:560e-6}); b.advance(6000);
  console.log('ECS (2xCO2, fixed):', (b.diag.Tmean-a.diag.Tmean).toFixed(2),'K', fmt(a));
}
if (which==='all'||which==='cold') {
  for (const S of [0.97,0.95,0.93,0.92,0.91,0.90,0.88]) {
    const m = new ClimateModel({weathering:false}); m.advance(3000);
    m.p.instellation = S; m.advance(10000);
    console.log('S',S, fmt(m));
  }
}
if (which==='all'||which==='hot') {
  for (const S of (process.env.SL||'1.04,1.07,1.10,1.12,1.14,1.17,1.20,1.25').split(',').map(Number)) {
    const m = new ClimateModel({weathering:false}); m.advance(3000);
    m.p.instellation = S; m.advance(5000);
    console.log('S',S, fmt(m));
  }
}
