// Scores a TUNE set against: Earth T, ECS, snowball threshold, ice edge.
import { ClimateModel, NB, TUNE } from '../js/sim/model.js';
for (const a of process.argv.slice(2)) { const [k,v]=a.split('='); TUNE[k]=+v; }
const iceEdge=(m)=>{ for(let i=NB/2;i<NB;i++){ if(m._seaIce(m.s.T[i])>0.5 && m.fOcean[i]>0.1) return m.lat[i]*57.3; } return 90; };
const a=new ClimateModel({weathering:false}); a.advance(6000);
const b=new ClimateModel({weathering:false, pCO2:560e-6}); b.advance(6000);
let snow=null;
for (const S of [0.98,0.96,0.95,0.94,0.93,0.92,0.91,0.90,0.88,0.86]) {
  const m=new ClimateModel({weathering:false}); m.advance(2000); m.p.instellation=S; m.advance(6000);
  if (m.diag.Tmean<250) { snow=S; break; }
}
const T=a.diag.Tmean, ecs=b.diag.Tmean-T;
const score = Math.abs(T-288)/1 + Math.abs(ecs-3.3)/0.5 + Math.abs((snow??0.85)-0.925)/0.01 + Math.max(0, Math.abs(iceEdge(a)-66)-6)/3;
console.log(process.argv.slice(2).join(' ').padEnd(50), `T=${T.toFixed(2)} ECS=${ecs.toFixed(2)} snowballAt=${snow} edge=${iceEdge(a).toFixed(0)} alb=${a.diag.albedo.toFixed(3)} score=${score.toFixed(2)}`);
