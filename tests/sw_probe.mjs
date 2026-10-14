import { buildSWTable, lookupAlbedo, TILE, stellarWeights } from '../js/sim/shortwave.js';
import { buildColumn } from '../js/sim/radiation.js';
function run(name, Ts, c, Teff, extra={}) {
  const col = buildColumn(Ts, c, 40);
  const t0=performance.now();
  const tab = buildSWTable({ col, pd:c.pd, g:c.g, Teff, cloudLayer: 6, ...extra });
  const ms=performance.now()-t0;
  const f=(mu,tau,s)=>lookupAlbedo(tab,mu,tau,s).toFixed(3);
  console.log(name.padEnd(14), 'ms',ms.toFixed(1),'| mu.6: ocean',f(0.6,0,TILE.ocean),'land',f(0.6,0,TILE.land),'snow',f(0.6,0,TILE.snow),'seaice',f(0.6,0,TILE.seaice),'| cloud7 ocean',f(0.6,7,TILE.ocean),'| mu.3 ocean',f(0.3,0,0),'| rgb',tab.rgbAtm.map(v=>v.toFixed(3)).join(','));
}
const earth = { g:9.81, pd:{N2:0.78e5, O2:0.21e5, CO2:28, CH4:0.18}, pvCap:1e12, rh:0.8, Tstrat:200 };
run('Earth G', 288, earth, 5780);
run('Earth M3300', 288, earth, 3300);
run('Earth K4500', 288, earth, 4500);
run('Earth F6500', 288, earth, 6500);
const venus = { g:8.87, pd:{CO2:0.965*92e5, N2:0.035*92e5, SO2:150e-6*92e5}, pvCap:30e-6*92e5, rh:1, Tstrat:170 };
run('Venus clear', 737, venus, 5780);
run('Venus H2SO4', 737, venus, 5780, {tauS:30});
const steam = { g:9.81, pd:{N2:1e5}, pvCap:270e5, rh:1, Tstrat:200 };
run('Steam 270b G', 1500, steam, 5780);
run('Steam 270b M', 1500, steam, 3300);
run('Steam 10b G', 900, {...steam, pvCap:10e5}, 5780);
run('Moist 340K', 340, earth, 5780);
const mars = { g:3.71, pd:{CO2:600, N2:16}, pvCap:1, rh:0.3, Tstrat:140 };
run('Mars', 210, mars, 5780);
run('CO2 8bar', 273, { g:9.81, pd:{CO2:8e5, N2:1e5}, pvCap:1e9, rh:0.8, Tstrat:170 }, 5780);
run('Titan-ish haze', 288, {...earth, pd:{...earth.pd, CH4: 2000}}, 5780, {tauH:3});
