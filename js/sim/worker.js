// Simulation worker: advances the climate model against wall-clock time (independent of the
// display refresh rate), keeps history for charts, detects events and posts snapshots.

import { ClimateModel, NB, DEFAULT_PARAMS } from './model.js';
import { classify, STATES } from './classify.js';
import { STAR_TYPES } from './star.js';
import { OCEAN_EARTH, G_EARTH } from './constants.js';
import { buildHeightMap, downsample } from './terrain.js';

let model = null;
let heightMap = null;
let params = { ...DEFAULT_PARAMS };
let speed = 1000;          // simulated years per real second
let paused = true;
let lastWall = performance.now();
let achieved = 0;          // achieved years per second (smoothed)
let history = [];
let lastHistWall = 0;
let lastState = null;
let events = [];
let stateSince = 0;
let budgetMs = 20;

function post(type, data, transfer) { self.postMessage({ type, ...data }, transfer || []); }

function addEvent(text, kind = 'info') {
  events.push({ t: model.s.t, text, kind });
  if (events.length > 200) events.shift();
}

let terrainSeed = -1;
function makeTerrain(seed) {
  if (seed === terrainSeed) return;
  terrainSeed = seed;
  const W = 1024, H = 512;
  const hi = buildHeightMap(seed, W, H);
  heightMap = { W: 192, H: 96, data: downsample(hi, W, H, 192, 96) };
  const copy = hi.slice();
  post('terrain', { W, H, data: copy }, [copy.buffer]);
}

function build(p, keepTime = false) {
  params = { ...DEFAULT_PARAMS, ...p };
  makeTerrain(params.seed || 7);
  model = new ClimateModel(params, heightMap);
  history = [];
  events = [];
  lastState = null;
  addEvent('Simulation started', 'start');
  sample(true);
  snapshot();
}

function summary() {
  const m = model, d = m.diag, s = m.s, pp = m.partials();
  const cls = classify(m);
  const EOarea = OCEAN_EARTH / m.area;
  let iceSheets = 0;
  for (let i = 0; i < NB; i++) iceSheets += m.a[i] * s.ice[i];
  // estimated time to finish evaporating the ocean during a runaway
  let evapETA = null;
  if (cls.key === 'runaway' && d.imbalance > 0.05) {
    const Lremain = (m._liquid || 0) * (2.0e6 + 4184 * Math.max(0, 647 - d.Tmean));
    evapETA = Lremain / d.imbalance / 3.15576e7;
  }
  let waterLossETA = null;
  if (d.waterLossRate > 0 && s.W > 0) waterLossETA = s.W / d.waterLossRate;
  return {
    t: s.t, age: s.age, Tmean: d.Tmean, Tmin: d.Tmin, Tmax: d.Tmax, albedo: d.albedo,
    asr: d.asr, olr: d.olr, imbalance: d.imbalance, pS: d.pS, pv: d.pv, xStrat: d.xStrat,
    vapor: d.vapor, waterEO: s.W / EOarea, liquidEO: (m._liquid || 0) / EOarea,
    iceEO: iceSheets / EOarea, oceanCover: m._oceanCover(), seaLevel: m.seaLevel,
    partials: pp, weath: d.weath, outgas: d.outgas, escH: d.escH, escLimit: d.escLimit,
    waterLossRate: d.waterLossRate / EOarea, waterLossETA, evapETA,
    instellation: m.instellation(), xuv: m.xuvFlux(), Teff: m.Teff, g: m.g, R: m.R, vesc: m.vesc,
    lifeOn: s.lifeOn, tauS: d.tauS, tauH: d.tauH, rgbAtm: d.rgbAtm, Td: s.Td,
    state: cls.key, tags: cls.tags, stateName: STATES[cls.key].name, stateDesc: STATES[cls.key].desc,
    stateColor: STATES[cls.key].color, stateSince, hpIce: m.hpIce, oceanDepth: m.oceanDepth,
    co2ice: m.co2iceTot || 0, Cexo: s.Cexo, Ccrust: s.Ccrust, dt: m.dtLast,
    asrClear: d.asrClear, olrClear: d.olrClear, lostWaterEO: s.lostWater / OCEAN_EARTH,
    seaLevelNorm: m.seaLevel / (1000 * m.p.relief * (G_EARTH / m.g)),
  };
}

function bandData() {
  const m = model, d = m.diag, s = m.s;
  const T = Float32Array.from(s.T), fo = Float32Array.from(m.fOcean);
  const sea = new Float32Array(NB), snow = new Float32Array(NB), ice = new Float32Array(NB);
  const fc = Float32Array.from(d.fc), tc = Float32Array.from(d.tc), pr = new Float32Array(NB);
  const co2 = new Float32Array(NB);
  for (let i = 0; i < NB; i++) {
    sea[i] = m._seaIce(s.T[i]);
    snow[i] = m._snowLand(s.T[i]) * (m._snowSupply ? m._snowSupply[i] : 1);
    const lf = 1 - m.fOcean[i];
    ice[i] = lf > 1e-6 ? 1 - Math.exp(-s.ice[i] / (lf * 1e4)) : 0;
    pr[i] = d.precip[i] * 3.15576e7;
    co2[i] = s.co2ice[i] > 0 ? 1 - Math.exp(-s.co2ice[i] / 50) : 0;
  }
  return { T, fo, sea, snow, ice, fc, tc, pr, co2, lat: Float32Array.from(m.lat) };
}

function sample(force = false) {
  const now = performance.now();
  if (!force && now - lastHistWall < 100) return;
  lastHistWall = now;
  const d = model.diag, pp = model.partials();
  const EOarea = OCEAN_EARTH / model.area;
  history.push({
    t: model.s.t, T: d.Tmean, Tmin: d.Tmin, Tmax: d.Tmax, co2: pp.CO2 / 1e5, pS: d.pS / 1e5,
    water: model.s.W / EOarea, liquid: (model._liquid || 0) / EOarea, alb: d.albedo,
    xs: d.xStrat, imb: d.imbalance, S: model.instellation(),
  });
  if (history.length > 1600) {
    // decimate older half
    const keep = [];
    for (let i = 0; i < history.length; i++) if (i % 2 === 0 || i > history.length - 400) keep.push(history[i]);
    history = keep;
  }
}

function detectEvents(sum) {
  if (lastState !== sum.state) {
    if (lastState) addEvent(`${STATES[lastState].name} → ${sum.stateName}`, sum.state);
    lastState = sum.state;
    stateSince = sum.t;
  }
}

function snapshot() {
  const sum = summary();
  detectEvents(sum);
  sum.stateSince = stateSince;
  post('state', { summary: sum, bands: bandData(), achieved, speed, paused, events: events.slice(-40), params });
}

function tick() {
  const now = performance.now();
  let wallDt = (now - lastWall) / 1000;
  lastWall = now;
  if (wallDt > 0.25) wallDt = 0.25; // tab was hidden / stalled: don't try to catch up
  if (model && !paused) {
    const want = speed * wallDt;
    const t0 = performance.now();
    let got = 0;
    try {
      got = model.advance(want, budgetMs);
    } catch (e) {
      post('error', { message: String(e && e.stack || e) });
      paused = true;
    }
    const used = performance.now() - t0;
    const rate = wallDt > 0 ? got / wallDt : 0;
    achieved = achieved * 0.85 + rate * 0.15;
    sample();
    if (used > 60) budgetMs = Math.max(8, budgetMs * 0.9); else if (budgetMs < 20) budgetMs += 0.5;
  }
  if (model) snapshot();
}

self.onmessage = (ev) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      const seed = (msg.params && msg.params.seed) || 7;
      makeTerrain(seed);
      build(msg.params || {});
      paused = msg.paused ?? true;
      speed = msg.speed ?? speed;
      lastWall = performance.now();
      setInterval(tick, 33);
      break;
    }
    case 'reset':
      build(msg.params || params);
      break;
    case 'speed': speed = msg.value; break;
    case 'pause': paused = !!msg.value; lastWall = performance.now(); break;
    case 'set': {
      applyParam(msg.key, msg.value);
      snapshot();
      break;
    }
    case 'history':
      post('history', { history });
      break;
    case 'heightmap':
      heightMap = msg.heightMap;
      break;
  }
};

function applyParam(key, value) {
  const m = model;
  params[key] = value;
  m.p[key] = value;
  const gasMap = { pN2: 'N2', pO2: 'O2', pCO2: 'CO2', pCH4: 'CH4', pH2: 'H2', pSO2: 'SO2' };
  if (key in gasMap) {
    m.setGases({ [gasMap[key]]: value });
    addEvent(`Set ${gasMap[key]} to ${fmtBar(value)}`, 'user');
    return;
  }
  switch (key) {
    case 'instellation':
      if (m.p.stellarEvolution) m.p.ageGyr = m.s.age; // re-anchor the luminosity evolution
      addEvent(`Instellation set to ${value.toFixed(3)} S⊕`, 'user');
      break;
    case 'waterEO': {
      const EOarea = OCEAN_EARTH / m.area;
      m.s.W = Math.max(0, value * EOarea);
      m._refreshHydro();
      addEvent(`Water inventory set to ${value.toPrecision(3)} Earth oceans`, 'user');
      break;
    }
    case 'massE': {
      // keep total water and surface partial pressures; rebuild geometry
      const EOtot = m.s.W * m.area / OCEAN_EARTH;
      const pp = m.partials();
      m._setPlanet(); m._setTerrain();
      m.s.W = EOtot * OCEAN_EARTH / m.area;
      m.setGases({ N2: pp.N2 / 1e5, O2: pp.O2 / 1e5, CO2: pp.CO2 / 1e5, CH4: pp.CH4 / 1e5, H2: pp.H2 / 1e5, SO2: pp.SO2 / 1e5 }, true);
      m._refreshHydro();
      addEvent(`Planet mass set to ${value.toFixed(2)} M⊕`, 'user');
      break;
    }
    case 'starType':
      m._setPlanet();
      addEvent(`Star changed to ${STAR_TYPES[value].name}`, 'user');
      break;
    case 'obliquity':
    case 'tidallyLocked': {
      m._setGrid(); m._setTerrain(); m._refreshHydro();
      addEvent(key === 'tidallyLocked' ? (value ? 'Planet tidally locked' : 'Planet spinning freely') : `Obliquity set to ${value}°`, 'user');
      break;
    }
    case 'rotationHours':
      addEvent(`Rotation period set to ${fmtHours(value)}`, 'user');
      break;
    case 'relief':
      m._setTerrain(); m._refreshHydro();
      break;
    case 'stellarEvolution':
      if (value) m.p.ageGyr = m.s.age;
      addEvent(value ? 'Stellar evolution on' : 'Stellar evolution off', 'user');
      break;
    case 'ageGyr':
      m.s.age = value; m.p.ageGyr = value;
      break;
    default:
      break;
  }
  m.lw.key = '';
}

function fmtBar(b) {
  if (b >= 0.1) return b.toFixed(2) + ' bar';
  if (b >= 1e-4) return (b * 1e3).toFixed(2) + ' mbar';
  return (b * 1e6).toFixed(1) + ' ppm·bar';
}
function fmtHours(h) { return h < 48 ? h.toFixed(1) + ' h' : (h / 24).toFixed(1) + ' d'; }
