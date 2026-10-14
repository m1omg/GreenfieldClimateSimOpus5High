// Calibrates the longwave band-envelope coefficients against literature targets.
import { columnOLR, RAD, rebuildKappa } from '../js/sim/radiation.js';
const earth = (co2=280e-6, rh=0.8) => ({ g:9.81, pd:{N2:0.78e5, O2:0.21e5, CO2:co2*1e5, CH4:1.8e-6*1e5}, pvCap:1e12, rh, Tstrat:200 });
const steam = { g:9.81, pd:{N2:1}, pvCap:270e5, rh:1, Tstrat:180 };
const BOUNDS = { h2oRot:[60,400], h2oRotL:[40,70], h2oVR:[10,120], h2oVRL:[30,65], contSelf:[0.2,1.0], contTexp:[1200,2600], co2_15L:[8,14], co2_15:[60,250], h2oSelfBroad:[3,8] };
const keys = Object.keys(BOUNDS);
function evaluate(verbose=false){
  rebuildKappa();
  const o = T => columnOLR(T, earth()).olr;
  const o288=o(288), o300=o(300), o270=o(270), o250=o(250);
  let omax=0; for (const T of [310,320,330,340,350,360,380]) omax=Math.max(omax,o(T));
  let st=0; const sts=[450,600,800,1000]; for(const T of sts) st+=columnOLR(T,steam).olr/sts.length;
  const st1800=columnOLR(1800,steam).olr, st1500=columnOLR(1500,steam).olr;
  const f2 = o288 - columnOLR(288, earth(560e-6)).olr;
  const terms = [
    [(o288-265)/2, 'OLR288', o288],
    [(o300-o288-22)/3, 'dOLR 288-300', o300-o288],
    [(o270-229)/4, 'OLR270', o270],
    [(o250-190)/6, 'OLR250', o250],
    [(st-282)/1.0, 'steam lim', st],
    [(omax-310)/8, 'Earth max', omax],
    [(f2-3.8)/0.3, '2xCO2', f2],
    [(st1800-st-6)/5, 'steam1800 rise', st1800-st],
    [(st1500-st)/3, 'steam1500 rise', st1500-st],
  ];
  if (verbose) for (const t of terms) console.log(t[1].padEnd(16), t[2].toFixed(2), ' err', t[0].toFixed(2));
  return terms.reduce((a,t)=>a+t[0]*t[0],0);
}
const sig=z=>1/(1+Math.exp(-z));
function setP(x){ keys.forEach((k,i)=>{const [a,b]=BOUNDS[k]; RAD[k]=a*Math.pow(b/a, sig(x[i]));}); }
let x0 = keys.map(k=>{const [a,b]=BOUNDS[k]; const f=Math.log(RAD[k]/a)/Math.log(b/a); const c=Math.min(0.95,Math.max(0.05,f)); return Math.log(c/(1-c));});
// Nelder-Mead
function nm(f, x0, iters=400, step=0.25){
  const n=x0.length; let S=[x0.slice()]; for(let i=0;i<n;i++){const x=x0.slice(); x[i]+=step; S.push(x);}
  let F=S.map(f);
  for(let it=0;it<iters;it++){
    const idx=[...F.keys()].sort((a,b)=>F[a]-F[b]); S=idx.map(i=>S[i]); F=idx.map(i=>F[i]);
    const c=new Array(n).fill(0); for(let i=0;i<n;i++) for(let j=0;j<n;j++) c[j]+=S[i][j]/n;
    const xr=c.map((v,j)=>v+(v-S[n][j])); const fr=f(xr);
    if(fr<F[0]){ const xe=c.map((v,j)=>v+2*(v-S[n][j])); const fe=f(xe); if(fe<fr){S[n]=xe;F[n]=fe;} else {S[n]=xr;F[n]=fr;} }
    else if(fr<F[n-1]){S[n]=xr;F[n]=fr;}
    else { const xc=c.map((v,j)=>v+0.5*(S[n][j]-v)); const fc=f(xc); if(fc<F[n]){S[n]=xc;F[n]=fc;} else { for(let i=1;i<=n;i++){S[i]=S[i].map((v,j)=>S[0][j]+0.5*(v-S[0][j])); F[i]=f(S[i]);} } }
    if(it%50===0) console.log('it',it,'best',F[0].toFixed(3));
  }
  return S[0];
}
console.log('initial'); setP(x0); evaluate(true);
const best = nm(x=>{setP(x); return evaluate();}, x0, +process.argv[2]||300, 1.0);
setP(best); console.log('final'); evaluate(true);
console.log(JSON.stringify(Object.fromEntries(keys.map(k=>[k, +RAD[k].toPrecision(4)]))));
