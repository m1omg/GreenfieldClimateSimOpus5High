import { columnOLR } from '../js/sim/radiation.js';
const SIG=5.670374419e-8;
// Venus: 92 bar CO2, 3.5% N2, 30 ppm H2O (inventory-limited), 150 ppm SO2, g=8.87; Ts=737
const pv = 30e-6*92e5;
for (const Ts of [500,600,700,737,800]) {
  const r=columnOLR(Ts,{g:8.87,pd:{CO2:0.965*92e5,N2:0.035*92e5,SO2:150e-6*92e5},pvCap:pv,rh:1,Tstrat:170});
  console.log('Venus',Ts,'OLR',r.olr.toFixed(1));
}
// Mars today: 6 mbar CO2, g=3.71, Ts=210
for (const Ts of [200,210,220]) { const r=columnOLR(Ts,{g:3.71,pd:{CO2:600,N2:16},pvCap:1,rh:0.3,Tstrat:140}); console.log('Mars',Ts,r.olr.toFixed(1),'bb',(SIG*Ts**4).toFixed(1)); }
// Early Mars: 1-3 bar CO2 at 273 K
for (const pc of [0.5,1,2,3]) { const r=columnOLR(273,{g:3.71,pd:{CO2:pc*1e5},pvCap:1e9,rh:0.8,Tstrat:160}); console.log('EarlyMars',pc,'bar OLR@273',r.olr.toFixed(1)); }
// Outer edge (Kopparapu): 8 bar CO2 at Earth g, 273 K
for (const pc of [1,3,8,15]) { const r=columnOLR(273,{g:9.81,pd:{CO2:pc*1e5,N2:1e5},pvCap:1e9,rh:0.8,Tstrat:170}); console.log('OuterEdge',pc,'bar OLR@273',r.olr.toFixed(1)); }
// CH4: Earth + 1000 ppm CH4
const e=(ch4,co2=280e-6,h2=0)=>({g:9.81,pd:{N2:0.78e5,O2:0.21e5,CO2:co2*1e5,CH4:ch4*1e5,H2:h2*1e5},pvCap:1e12,rh:0.8,Tstrat:200});
const b0=columnOLR(288,e(0)).olr;
for (const c of [1.8e-6,1e-4,1e-3,1e-2]) console.log('CH4',c,'forcing',(b0-columnOLR(288,e(c)).olr).toFixed(2));
for (const h of [0.01,0.1,0.3]) console.log('H2',h,'bar forcing',(b0-columnOLR(288,e(0,280e-6,h)).olr).toFixed(2));
for (const c of [1e-5, 1e-3,1e-2,0.1,0.3,1]) console.log('CO2',c,'forcing',(b0-columnOLR(288,e(0,c)).olr).toFixed(2));
// Snowball-like cold
for (const c of [280e-6,0.01,0.1,0.2]) console.log('cold 240K CO2',c,columnOLR(240,{...e(0,c),Tstrat:190}).olr.toFixed(1));
