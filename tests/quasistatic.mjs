import { ClimateModel, NB, TUNE } from '../js/sim/model.js';
for (const a of process.argv.slice(2)) { const [k,v]=a.split('='); TUNE[k]=+v; }
const m=new ClimateModel({weathering:false}); m.advance(4000);
const edge=()=>{ for(let i=NB/2;i<NB;i++){ if(m._seaIce(m.s.T[i])>0.5) return m.lat[i]*57.3; } return 90; };
const dir = +(process.env.DIR||-1);
for (let S=1.0; S>0.85 && S<1.3; S+=0.005*dir) {
  m.p.instellation=S; m.advance(3000);
  let D=0; for(let k=1;k<NB;k++) D+=m.diag.D[k]/(NB-1);
  console.log(`S=${S.toFixed(3)} Tm=${m.diag.Tmean.toFixed(1)} edge=${edge().toFixed(0)} alb=${m.diag.albedo.toFixed(3)} Dmean=${D.toFixed(3)} Tpole=${m.s.T[NB-1].toFixed(0)} Teq=${m.s.T[NB/2].toFixed(0)} fcPole=${m.diag.fc[NB-1].toFixed(2)} rh=${m._rh.toFixed(2)}`);
  if (m.diag.Tmean<240 || m.diag.Tmean>400) break;
}
