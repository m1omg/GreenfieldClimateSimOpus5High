// Main thread: UI, charts and rendering. The simulation runs in a Web Worker.
import { PlanetScene } from './render/scene.js';
import { PRESETS } from './sim/presets.js';
import { STAR_TYPES } from './sim/star.js';

// ------------------------------------------------------------------ formatting
const fmtTime = (y) => {
  const a = Math.abs(y);
  if (a < 1e3) return `${y.toFixed(a < 10 ? 1 : 0)} yr`;
  if (a < 1e6) return `${(y / 1e3).toFixed(a < 1e4 ? 2 : 1)} kyr`;
  if (a < 1e9) return `${(y / 1e6).toFixed(a < 1e7 ? 2 : 1)} Myr`;
  return `${(y / 1e9).toFixed(3)} Gyr`;
};
const fmtRate = (r) => r >= 1e6 ? `${(r / 1e6).toPrecision(3)} Myr/s` : r >= 1e3 ? `${(r / 1e3).toPrecision(3)} kyr/s` : `${r.toPrecision(3)} yr/s`;
const fmtBar = (b) => {
  if (b <= 0) return '0';
  if (b >= 1) return `${b.toPrecision(3)} bar`;
  if (b >= 1e-3) return `${(b * 1e3).toPrecision(3)} mbar`;
  if (b >= 1e-6) return `${(b * 1e6).toPrecision(3)} µbar`;
  return `${(b * 1e5).toExponential(1)} Pa`;
};
const fmtSci = (v, d = 2) => {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 0.01 && a < 1e4) return v.toPrecision(d + 1);
  return v.toExponential(d);
};
const fmtHours = (h) => h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(h < 240 ? 1 : 0)} d`;
const fmtEO = (v) => v === 0 ? '0' : v >= 0.01 ? `${v.toPrecision(3)}` : v.toExponential(1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ------------------------------------------------------------------ worker
const worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
let snap = null;
let paused = true;
let speed = 1e4;

const scene = new PlanetScene(document.getElementById('scene'));
window.__scene = scene;

worker.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'terrain') {
    scene.setHeightMap({ W: m.W, H: m.H, data: m.data });
  } else if (m.type === 'state') {
    snap = m;
    scene.update(m);
    if (!loaded) { loaded = true; document.getElementById('loading').classList.add('done'); }
    uiDirty = true;
  } else if (m.type === 'error') {
    console.error(m.message);
    showAlert('Simulation error: ' + m.message.split('\n')[0]);
  }
};
let loaded = false;
let uiDirty = false;

// ------------------------------------------------------------------ controls
const CONTROLS = [
  {
    group: 'Star', items: [
      { key: 'starType', type: 'select', label: 'Spectral type', options: Object.entries(STAR_TYPES).map(([k, v]) => [k, v.name]) },
      { key: 'instellation', type: 'log', label: 'Instellation', min: 0.01, max: 4, fmt: v => `${v.toFixed(3)} S⊕`, live: s => s.instellation, note: 'Stellar flux at the planet; Earth = 1 (1361 W/m²).' },
      { key: 'stellarEvolution', type: 'toggle', label: 'Stellar evolution', note: 'Main-sequence brightening (Gough 1981) and fading XUV activity.' },
      { key: 'ageGyr', type: 'lin', label: 'Star age', min: 0.02, max: 10, step: 0.01, fmt: v => `${v.toFixed(2)} Gyr`, live: s => s.age },
    ],
  },
  {
    group: 'Orbit & rotation', items: [
      { key: 'rotationHours', type: 'log', label: 'Day length', min: 4, max: 6000, fmt: fmtHours },
      { key: 'tidallyLocked', type: 'toggle', label: 'Tidally locked', note: 'Permanent day side; climate computed in substellar coordinates.' },
      { key: 'obliquity', type: 'lin', label: 'Obliquity', min: 0, max: 90, step: 0.5, fmt: v => `${v.toFixed(1)}°` },
    ],
  },
  {
    group: 'Planet', items: [
      { key: 'massE', type: 'log', label: 'Mass', min: 0.05, max: 8, fmt: v => `${v.toFixed(2)} M⊕`, extra: s => `R ${(s.R / 6.371e6).toFixed(2)} R⊕ · g ${(s.g / 9.81).toFixed(2)} g⊕` },
      { key: 'waterEO', type: 'log0', label: 'Water inventory', min: 1e-5, max: 100, fmt: v => v === 0 ? 'none' : `${fmtEO(v)} oceans`, live: s => s.waterEO, note: '1 = Earth\'s oceans (1.4×10²¹ kg).' },
      { key: 'relief', type: 'lin', label: 'Topographic relief', min: 0.3, max: 3, step: 0.05, fmt: v => `${v.toFixed(2)}×` },
    ],
  },
  {
    group: 'Atmosphere', items: [
      { key: 'pN2', type: 'log0', label: 'N₂', min: 1e-4, max: 100, fmt: fmtBar, live: s => s.partials.N2 / 1e5 },
      { key: 'pCO2', type: 'log0', label: 'CO₂', min: 1e-7, max: 100, fmt: fmtBar, live: s => s.partials.CO2 / 1e5, note: 'Atmospheric CO₂ evolves with weathering, outgassing and the oceans.' },
      { key: 'pO2', type: 'log0', label: 'O₂', min: 1e-7, max: 5, fmt: fmtBar, live: s => s.partials.O2 / 1e5 },
      { key: 'pCH4', type: 'log0', label: 'CH₄', min: 1e-9, max: 0.1, fmt: fmtBar, live: s => s.partials.CH4 / 1e5, note: 'Needs a biosphere (or a source) to persist.' },
      { key: 'pH2', type: 'log0', label: 'H₂', min: 1e-6, max: 50, fmt: fmtBar, live: s => s.partials.H2 / 1e5 },
    ],
  },
  {
    group: 'Geology & life', items: [
      { key: 'outgassing', type: 'log', label: 'Volcanic outgassing', min: 0.01, max: 100, fmt: v => `${v.toPrecision(2)}× Earth` },
      { key: 'tectonics', type: 'select', label: 'Tectonic regime', options: [['plate', 'Plate tectonics'], ['stagnant', 'Stagnant lid']] },
      { key: 'weathering', type: 'toggle', label: 'Silicate weathering', note: 'The carbonate–silicate thermostat (Walker et al. 1981).' },
      { key: 'biosphere', type: 'toggle', label: 'Biosphere', note: 'When habitable: maintains O₂ and CH₄ and speeds weathering.' },
    ],
  },
];

const ctlEls = {};
let params = {};
const dragging = new Set();

function sliderToVal(c, u) {
  if (c.type === 'lin') return c.min + (c.max - c.min) * u;
  if (c.type === 'log0' && u <= 0.001) return 0;
  return c.min * Math.pow(c.max / c.min, u);
}
function valToSlider(c, v) {
  if (c.type === 'lin') return (v - c.min) / (c.max - c.min);
  if (c.type === 'log0' && v <= 0) return 0;
  return clamp(Math.log(Math.max(v, 1e-30) / c.min) / Math.log(c.max / c.min), c.type === 'log0' ? 0.002 : 0, 1);
}

function buildControls() {
  const root = document.getElementById('controlsBody');
  root.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'preset-note';
  note.id = 'presetNote';
  root.appendChild(note);
  for (const g of CONTROLS) {
    const grp = document.createElement('div');
    grp.className = 'group';
    grp.innerHTML = `<div class="group-head"><h3>${g.group}</h3><span class="chev">▾</span></div><div class="group-body"></div>`;
    grp.querySelector('.group-head').onclick = () => grp.classList.toggle('collapsed');
    const body = grp.querySelector('.group-body');
    for (const c of g.items) {
      const el = document.createElement('div');
      if (c.type === 'toggle') {
        el.className = 'ctl';
        el.innerHTML = `<div class="toggle"><span class="ctl-label">${c.label}</span><button class="switch" aria-label="${c.label}"></button></div>${c.note ? `<div class="ctl-note">${c.note}</div>` : ''}`;
        const sw = el.querySelector('.switch');
        sw.onclick = () => { const v = !params[c.key]; params[c.key] = v; sw.classList.toggle('on', v); send(c.key, v); };
        ctlEls[c.key] = { c, el, sw };
      } else if (c.type === 'select') {
        el.className = 'ctl ctl-select';
        el.innerHTML = `<div class="ctl-top"><span class="ctl-label">${c.label}</span></div><select>${c.options.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>`;
        const sel = el.querySelector('select');
        sel.onchange = () => { params[c.key] = sel.value; send(c.key, sel.value); };
        ctlEls[c.key] = { c, el, sel };
      } else {
        el.className = 'ctl';
        el.innerHTML = `<div class="ctl-top"><span class="ctl-label">${c.label}</span><span class="ctl-val"></span></div><input type="range" min="0" max="1000" step="1">${c.extra ? '<div class="ctl-note extra"></div>' : ''}${c.note ? `<div class="ctl-note">${c.note}</div>` : ''}`;
        const rng = el.querySelector('input'), val = el.querySelector('.ctl-val');
        let tmr = null;
        rng.addEventListener('pointerdown', () => dragging.add(c.key));
        const end = () => { dragging.delete(c.key); };
        rng.addEventListener('pointerup', end); rng.addEventListener('pointercancel', end); rng.addEventListener('blur', end);
        rng.addEventListener('input', () => {
          const v = sliderToVal(c, rng.value / 1000);
          params[c.key] = v;
          val.textContent = c.fmt(v); val._v = undefined;
          val.classList.remove('live');
          setFill(rng);
          clearTimeout(tmr);
          tmr = setTimeout(() => send(c.key, v), 90);
        });
        ctlEls[c.key] = { c, el, rng, val, extra: el.querySelector('.extra') };
      }
      body.appendChild(el);
    }
    root.appendChild(grp);
  }
}
function setFill(rng) { rng.style.setProperty('--fill', `${rng.value / 10}%`); }

function syncControls(fromParams = true) {
  for (const k in ctlEls) {
    const { c, sw, sel, rng, val } = ctlEls[k];
    if (sw) sw.classList.toggle('on', !!params[k]);
    else if (sel) sel.value = params[k];
    else if (rng && fromParams) {
      rng.value = Math.round(valToSlider(c, params[k]) * 1000);
      val.textContent = c.fmt(params[k]); val._v = undefined;
      setFill(rng);
    }
  }
}

/** Live controls follow the evolving simulation state (gases, water, age). */
function syncLive(sum) {
  for (const k in ctlEls) {
    const { c, rng, val, extra } = ctlEls[k];
    if (extra && c.extra) setText(extra, c.extra(sum));
    if (!rng || !c.live || dragging.has(k)) continue;
    const v = c.live(sum);
    if (!isFinite(v)) continue;
    const pos = String(Math.round(valToSlider(c, v) * 1000));
    if (rng.value !== pos) { rng.value = pos; setFill(rng); }
    setText(val, c.fmt(v));
    if (!val.classList.contains('live')) val.classList.add('live');
  }
}

function send(key, value) { worker.postMessage({ type: 'set', key, value }); }

// ------------------------------------------------------------------ presets & time
const presetSel = document.getElementById('preset');
presetSel.innerHTML = PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
function loadPreset(id, keepPause = false) {
  const p = PRESETS.find(x => x.id === id) || PRESETS[0];
  params = { ...p.params };
  syncControls();
  document.getElementById('presetNote').textContent = p.note;
  setSpeed(p.speed);
  history = []; lastHistT = -1;
  worker.postMessage({ type: 'reset', params });
  if (!keepPause) setPaused(false);
}
presetSel.onchange = () => loadPreset(presetSel.value);
document.getElementById('btnReset').onclick = () => {
  history = []; lastHistT = -1;
  worker.postMessage({ type: 'reset', params });
};

const speedEl = document.getElementById('speed');
function setSpeed(v) {
  speed = clamp(v, 1, 1e8);
  speedEl.value = Math.log10(speed);
  speedEl.style.setProperty('--fill', `${Math.log10(speed) / 8 * 100}%`);
  document.getElementById('speedLabel').textContent = fmtRate(speed);
  worker.postMessage({ type: 'speed', value: speed });
}
speedEl.addEventListener('input', () => setSpeed(Math.pow(10, +speedEl.value)));
document.querySelectorAll('.speed-presets button').forEach(b => b.onclick = () => setSpeed(+b.dataset.s));
const playBtn = document.getElementById('btnPlay');
function setPaused(p) {
  paused = p;
  playBtn.textContent = p ? '▶' : '❚❚';
  playBtn.classList.toggle('running', !p);
  worker.postMessage({ type: 'pause', value: p });
}
playBtn.onclick = () => setPaused(!paused);
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
  if (e.key === ']') setSpeed(speed * 3.1623);
  if (e.key === '[') setSpeed(speed / 3.1623);
});
const help = document.getElementById('help');
document.getElementById('btnHelp').onclick = () => help.hidden = false;
document.getElementById('helpClose').onclick = () => help.hidden = true;
help.onclick = (e) => { if (e.target === help) help.hidden = true; };

// ------------------------------------------------------------------ drawers (touch / narrow screens)
const $ = (id) => document.getElementById(id);
const drawerMQ = window.matchMedia('(max-width: 1100px), (pointer: coarse)');
const phoneMQ = window.matchMedia('(max-width: 760px)');
const body = document.body;
function applyDrawerMode() {
  body.classList.toggle('drawers', drawerMQ.matches);
  $('hud').hidden = !drawerMQ.matches;
  uiDirty = true;
  requestAnimationFrame(() => scene._resize());
}
drawerMQ.addEventListener('change', applyDrawerMode);
applyDrawerMode();
function setDrawer(side, open) {
  const cls = side === 'left' ? 'open-left' : 'open-right';
  open = open ?? !body.classList.contains(cls);
  // on a phone the two drawers would overlap: show one at a time
  if (open && phoneMQ.matches) body.classList.remove(side === 'left' ? 'open-right' : 'open-left');
  body.classList.toggle(cls, open);
  $('tabControls').setAttribute('aria-expanded', body.classList.contains('open-left'));
  $('tabStatus').setAttribute('aria-expanded', body.classList.contains('open-right'));
  uiDirty = true;
}
$('tabControls').onclick = () => setDrawer('left');
$('tabStatus').onclick = () => setDrawer('right');
$('hud').onclick = () => setDrawer('right', true);
// a tap (not a drag) on the planet closes open drawers
{
  const cv = $('scene');
  let down = null;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', (e) => {
    if (!down || !body.classList.contains('drawers')) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 8 && performance.now() - down.t < 350) { setDrawer('left', false); setDrawer('right', false); }
    down = null;
  });
}
const statusVisible = () => !body.classList.contains('drawers') || body.classList.contains('open-right');

// ------------------------------------------------------------------ status panel
// DOM writes only when the text actually changes (avoids layout work every update)
const setText = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
const setHTML = (el, v) => { if (el._v !== v) { el._v = v; el.innerHTML = v; } };
let history = [];
let lastHistT = -1;
let chartKey = 'T';
document.querySelectorAll('#chartTabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#chartTabs button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); chartKey = b.dataset.k;
});

function showAlert(text) {
  const a = $('alertBox');
  if (!text) { a.hidden = true; return; }
  a.hidden = false; a.textContent = text;
}

function updateStatus() {
  if (!snap) return;
  const s = snap.summary;
  // history (client side; independent of worker sampling)
  if (s.t !== lastHistT) {
    history.push({ t: s.t, T: s.Tmean, Tmin: s.Tmin, Tmax: s.Tmax, co2: s.partials.CO2 / 1e5, water: s.waterEO, liquid: s.liquidEO, pS: s.pS / 1e5, alb: s.albedo });
    lastHistT = s.t;
    if (history.length > 2400) history = history.filter((_, i) => i % 2 === 0 || i > history.length - 600);
  }
  // time bar and HUD (always visible)
  setText($('simTime'), fmtTime(s.t));
  setText($('simAge'), `star age ${s.age.toFixed(3)} Gyr · ${STAR_TYPES[snap.params.starType]?.name.split(' (')[0] || ''}`);
  setText($('speedActual'), paused ? 'paused' : `achieved ${fmtRate(Math.max(0, snap.achieved))}${snap.achieved < speed * 0.7 ? ' (CPU-limited)' : ''}`);
  if (body.classList.contains('drawers')) {
    setText($('hudState'), s.stateName);
    if ($('hudState')._c !== s.stateColor) { $('hudState')._c = s.stateColor; $('hudState').style.color = s.stateColor; }
    setText($('hudT'), `${s.Tmean.toFixed(0)} K`);
  }
  if (body.classList.contains('open-left') || !body.classList.contains('drawers')) syncLive(s);
  if (!statusVisible()) return;

  setText($('stateName'), s.stateName);
  if ($('stateName')._c !== s.stateColor) { $('stateName')._c = s.stateColor; $('stateName').style.color = s.stateColor; }
  setText($('stateDesc'), s.stateDesc);
  setHTML($('stateTags'), s.tags.map(t => `<span>${t}</span>`).join(''));
  setText($('stateSince'), `since ${fmtTime(s.stateSince)} · now ${fmtTime(s.t)}`);
  // alerts
  let alert = '';
  if (s.state === 'runaway' && s.evapETA) alert = `Ocean is boiling off: ~${fmtTime(s.evapETA)} until it is gone at the current imbalance (+${s.imbalance.toFixed(1)} W/m²).`;
  else if (s.state === 'snowball') alert = `Weathering has stopped. Volcanic CO₂ is accumulating (${fmtBar(s.partials.CO2 / 1e5)} now); the ice should break once it reaches roughly 0.1–0.3 bar.`;
  else if (s.waterLossETA && s.waterLossETA < 5e9 && s.waterEO > 1e-4) alert = `Hydrogen escape (${s.escLimit}-limited) will remove the remaining water in ~${fmtTime(s.waterLossETA)}.`;
  showAlert(alert);

  const C = s.Tmean - 273.15;
  const ro = [
    ['big', 'Global mean surface', `${s.Tmean.toFixed(1)} K <small>${C >= 0 ? '+' : ''}${C.toFixed(1)} °C</small>`],
    ['', 'Range (bands)', `${s.Tmin.toFixed(0)}–${s.Tmax.toFixed(0)} K`],
    ['', 'Surface pressure', fmtBar(s.pS / 1e5)],
    ['', 'Bond albedo', s.albedo.toFixed(3)],
    ['', 'Instellation', `${s.instellation.toFixed(3)} S⊕`],
    ['', 'Liquid water', `${fmtEO(s.liquidEO)} <small>oceans</small>`],
    ['', 'Ice sheets', `${fmtEO(s.iceEO)} <small>oceans</small>`],
    ['', 'Ocean cover', `${(s.oceanCover * 100).toFixed(1)}%`],
    ['', 'Water vapour', `${fmtBar(s.pv / 1e5)}`],
    ['', 'Strat. H₂O', `${fmtSci(s.xStrat, 1)}`],
    ['', 'H escape', `${fmtSci(s.escH / 1e4, 1)} <small>cm⁻²s⁻¹</small>`],
    ['', 'Weathering / outgas', s.outgas > 0 ? (s.weath / s.outgas).toFixed(2) : '—'],
    ['', 'Deep ocean', s.liquidEO > 1e-4 ? `${s.Td.toFixed(1)} K` : '—'],
    ['', 'Gravity · v_esc', `${(s.g / 9.81).toFixed(2)} g · ${(s.vesc / 1000).toFixed(1)} km/s`],
    ['', 'Water lost to space', `${fmtEO(s.lostWaterEO)} <small>oceans</small>`],
    ['', 'Solver step', fmtTime(s.dt)],
  ];
  const roEl = $('readouts');
  if (!roEl._cells) {
    roEl.innerHTML = ro.map(([c, k]) => `<div class="ro ${c}"><span class="k">${k}</span><span class="v"></span></div>`).join('');
    roEl._cells = [...roEl.querySelectorAll('.v')];
  }
  ro.forEach(([, , v], i) => setHTML(roEl._cells[i], v));

  // composition
  const pp = s.partials;
  const gases = [['N₂', pp.N2, '#7fa7ff'], ['O₂', pp.O2, '#9fe0c8'], ['CO₂', pp.CO2, '#ffb35a'], ['H₂O', s.pv, '#6cc4ff'],
    ['CH₄', pp.CH4, '#d6a2ff'], ['H₂', pp.H2, '#ff8fb0'], ['SO₂', pp.SO2, '#f2e27a']];
  const cbEl = $('compBars');
  if (!cbEl._rows) {
    cbEl.innerHTML = gases.map(([n, , col]) => `<div class="cb"><span class="g">${n}</span><div class="bar"><div style="background:${col}"></div></div><span class="p"></span></div>`).join('');
    cbEl._rows = [...cbEl.querySelectorAll('.cb')].map(r => ({ bar: r.querySelector('.bar div'), p: r.querySelector('.p') }));
  }
  gases.forEach(([, p], i) => {
    const b = p / 1e5, row = cbEl._rows[i];
    const w = (b > 0 ? clamp((Math.log10(b) + 8) / 10.5 * 100, 0, 100) : 0).toFixed(1);
    if (row.bar._w !== w) { row.bar._w = w; row.bar.style.width = w + '%'; }
    setText(row.p, b > 0 ? fmtBar(b) : '—');
  });

  // events
  const evs = snap.events;
  const evKey = evs.length + ':' + (evs.length ? evs[evs.length - 1].t + evs[evs.length - 1].text : '');
  if ($('eventLog')._k !== evKey) {
    $('eventLog')._k = evKey;
    $('eventLog').innerHTML = evs.slice().reverse().map(e => `<div class="ev ${e.kind === 'user' ? 'user' : e.kind === 'start' ? '' : 'state'}"><span class="t">${fmtTime(e.t)}</span><span class="x">${e.text}</span></div>`).join('');
  }

  drawBudget(s);
  drawSeries();
  drawProfile();
}

// ------------------------------------------------------------------ charts
function prepCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight || +cv.getAttribute('height');
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function drawBudget(s) {
  const { g, w, h } = prepCanvas($('budgetCanvas'));
  const max = Math.max(350, s.asr * 1.15, s.olr * 1.15);
  const x0 = 64, x1 = w - 8;
  const X = (v) => x0 + (x1 - x0) * clamp(v / max, 0, 1);
  g.font = '11px Inter'; g.textBaseline = 'middle';
  const rows = [['Absorbed', s.asr, '#ffcf7a', s.asrClear], ['Emitted', s.olr, '#7fb8ff', s.olrClear]];
  rows.forEach(([n, v, col, clr], i) => {
    const y = 12 + i * 22;
    g.fillStyle = '#8794ad'; g.fillText(n, 0, y);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x0, y - 6, x1 - x0, 12);
    g.fillStyle = col; g.globalAlpha = 0.85; g.fillRect(x0, y - 6, X(v) - x0, 12); g.globalAlpha = 1;
    if (clr) { g.strokeStyle = 'rgba(255,255,255,.45)'; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(X(clr), y - 7); g.lineTo(X(clr), y + 7); g.stroke(); g.setLineDash([]); }
    g.fillStyle = '#0b0f18'; g.fillText(v.toFixed(0), x0 + 4, y);
  });
  // steam-atmosphere limit marker
  const lx = X(282);
  g.strokeStyle = 'rgba(255,106,77,.8)'; g.beginPath(); g.moveTo(lx, 3); g.lineTo(lx, 44); g.stroke();
  g.fillStyle = 'rgba(255,140,110,.9)'; g.font = '10px Inter'; g.fillText('282 steam limit', Math.min(lx + 3, w - 80), 52);
  g.fillStyle = s.imbalance > 0.5 ? '#ffb35a' : s.imbalance < -0.5 ? '#7fb8ff' : '#9fe0c8';
  g.font = '11px JetBrains Mono';
  g.fillText(`imbalance ${s.imbalance >= 0 ? '+' : ''}${s.imbalance.toFixed(2)}  (dashed = clear sky)`, 0, 66);
}

function drawSeries() {
  const { g, w, h } = prepCanvas($('tsCanvas'));
  const H = history;
  if (H.length < 2) return;
  const pad = { l: 42, r: 6, t: 8, b: 18 };
  const t0 = H[0].t, t1 = H[H.length - 1].t || 1;
  const cfg = {
    T: { get: d => d.T, lo: d => d.Tmin, hi: d => d.Tmax, unit: 'K', log: false, col: '#ffb35a', refs: [[273.15, 'freezing'], [647, 'critical pt']] },
    co2: { get: d => d.co2, unit: 'bar', log: true, col: '#ffcf7a' },
    water: { get: d => d.water, get2: d => d.liquid, unit: 'oceans', log: true, col: '#6cc4ff', col2: '#3f8fd6' },
    pS: { get: d => d.pS, unit: 'bar', log: true, col: '#c9a7ff' },
    alb: { get: d => d.alb, unit: '', log: false, col: '#e8f4ff' },
  }[chartKey];
  let lo = Infinity, hi = -Infinity;
  for (const d of H) {
    const vals = [cfg.get(d), cfg.lo ? cfg.lo(d) : null, cfg.hi ? cfg.hi(d) : null, cfg.get2 ? cfg.get2(d) : null];
    for (const v of vals) if (v !== null && isFinite(v) && (!cfg.log || v > 0)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  if (!isFinite(lo)) return;
  if (cfg.log) { lo = Math.log10(lo); hi = Math.log10(hi); if (hi - lo < 0.5) { lo -= 0.25; hi += 0.25; } }
  else { const m = Math.max(1e-3, (hi - lo) * 0.08); lo -= m; hi += m; if (hi - lo < 2 && chartKey === 'T') { lo -= 1; hi += 1; } }
  const X = (t) => pad.l + (w - pad.l - pad.r) * ((t - t0) / Math.max(1e-9, t1 - t0));
  const Y = (v) => { const vv = cfg.log ? Math.log10(Math.max(v, 1e-30)) : v; return pad.t + (h - pad.t - pad.b) * (1 - (vv - lo) / (hi - lo)); };
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
  g.font = '10px JetBrains Mono'; g.fillStyle = '#5a6680'; g.textBaseline = 'middle';
  for (let i = 0; i <= 3; i++) {
    const vv = lo + (hi - lo) * i / 3;
    const y = pad.t + (h - pad.t - pad.b) * (1 - i / 3);
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
    const lab = cfg.log ? fmtSci(Math.pow(10, vv), 0) : vv.toFixed(chartKey === 'alb' ? 2 : 0);
    g.fillText(lab, 2, y);
  }
  g.textBaseline = 'alphabetic';
  g.fillText(fmtTime(t0), pad.l, h - 3);
  const tl = fmtTime(t1); g.fillText(tl, w - pad.r - g.measureText(tl).width, h - 3);
  if (cfg.refs) for (const [v, n] of cfg.refs) {
    const vv = v; if (vv < lo || vv > hi) continue;
    const y = Y(v); g.strokeStyle = 'rgba(108,196,255,.35)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(108,196,255,.6)'; g.fillText(n, w - pad.r - g.measureText(n).width, y - 3);
  }
  if (cfg.lo) {
    g.fillStyle = 'rgba(255,179,90,.12)'; g.beginPath();
    H.forEach((d, i) => { const x = X(d.t), y = Y(cfg.hi(d)); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    for (let i = H.length - 1; i >= 0; i--) g.lineTo(X(H[i].t), Y(cfg.lo(H[i])));
    g.closePath(); g.fill();
  }
  const line = (get, col) => { g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); H.forEach((d, i) => { const x = X(d.t), y = Y(get(d)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
  if (cfg.get2) line(cfg.get2, cfg.col2);
  line(cfg.get, cfg.col);
  g.fillStyle = '#8794ad'; g.fillText(cfg.unit + (cfg.get2 ? '  (dark = liquid)' : ''), pad.l + 4, pad.t + 10);
}

function drawProfile() {
  const { g, w, h } = prepCanvas($('profCanvas'));
  const b = snap.bands, locked = snap.params.tidallyLocked;
  $('profileTitle').textContent = locked ? 'Surface temperature vs. distance from substellar point' : 'Surface temperature by latitude';
  const n = b.T.length;
  const pad = { l: 34, r: 6, t: 6, b: 16 };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, b.T[i]); hi = Math.max(hi, b.T[i]); }
  lo = Math.min(lo - 5, 260); hi = Math.max(hi + 5, 290);
  const X = (i) => pad.l + (w - pad.l - pad.r) * (i + 0.5) / n;
  const Y = (T) => pad.t + (h - pad.t - pad.b) * (1 - (T - lo) / (hi - lo));
  // background: ocean / ice / cloud strips
  const bw = (w - pad.l - pad.r) / n;
  for (let i = 0; i < n; i++) {
    const x = pad.l + bw * i;
    g.fillStyle = `rgba(40,110,190,${0.35 * b.fo[i]})`; g.fillRect(x, h - pad.b - 5, bw + 0.5, 5);
    const ice = Math.max(b.sea[i] * b.fo[i], Math.max(b.ice[i], b.snow[i]) * (1 - b.fo[i]));
    g.fillStyle = `rgba(230,244,255,${0.7 * ice})`; g.fillRect(x, h - pad.b - 10, bw + 0.5, 5);
    g.fillStyle = `rgba(200,210,230,${0.10 * b.fc[i]})`; g.fillRect(x, pad.t, bw + 0.5, h - pad.t - pad.b - 10);
  }
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.font = '10px JetBrains Mono'; g.fillStyle = '#5a6680';
  for (let i = 0; i <= 3; i++) { const T = lo + (hi - lo) * i / 3; const y = Y(T); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); g.fillText(T.toFixed(0), 2, y + 3); }
  if (273.15 > lo && 273.15 < hi) { g.strokeStyle = 'rgba(108,196,255,.45)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(pad.l, Y(273.15)); g.lineTo(w - pad.r, Y(273.15)); g.stroke(); g.setLineDash([]); }
  const grad = g.createLinearGradient(0, Y(hi), 0, Y(lo));
  grad.addColorStop(0, '#ff6a4d'); grad.addColorStop(0.5, '#ffcf7a'); grad.addColorStop(1, '#7fb8ff');
  g.strokeStyle = grad; g.lineWidth = 2; g.beginPath();
  for (let i = 0; i < n; i++) { const x = X(i), y = Y(b.T[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  g.fillStyle = '#5a6680';
  const labs = locked ? ['night', 'terminator', 'substellar'] : ['90°S', 'equator', '90°N'];
  g.fillText(labs[0], pad.l, h - 3);
  g.fillText(labs[1], pad.l + (w - pad.l - pad.r) / 2 - g.measureText(labs[1]).width / 2, h - 3);
  g.fillText(labs[2], w - pad.r - g.measureText(labs[2]).width, h - 3);
}

// ------------------------------------------------------------------ boot
buildControls();
const initial = PRESETS[0];
params = { ...initial.params };
syncControls();
document.getElementById('presetNote').textContent = initial.note;
worker.postMessage({ type: 'init', params, paused: true, speed: initial.speed });
setSpeed(initial.speed);
setPaused(false);

let last = performance.now();
let lastUI = 0;
// Render at the full device resolution (up to 2x). Only if a device cannot hold ~40 fps
// for several seconds is the resolution stepped down, never below 1 canvas pixel per CSS
// pixel, and it is raised again once there is headroom. Changes are rare because each
// one reallocates the post-processing buffers.
const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
const minDpr = Math.min(1, maxDpr);
let dpr = maxDpr;
let frameAcc = 0, frameN = 0, lastAdapt = performance.now(), lastChange = 0, slowWindows = 0;
function adaptResolution(now, dtMs) {
  if (dtMs > 250) return;                    // tab switch / stall: not a rendering cost
  frameAcc += dtMs; frameN++;
  if (now - lastAdapt < 2000) return;
  const avg = frameAcc / frameN;
  frameAcc = 0; frameN = 0; lastAdapt = now;
  slowWindows = avg > 25 ? slowWindows + 1 : 0;
  let next = dpr;
  if (slowWindows >= 2 && dpr > minDpr) { next = Math.max(minDpr, dpr * 0.85); slowWindows = 0; }
  else if (avg < 12 && dpr < maxDpr && now - lastChange > 10000) next = Math.min(maxDpr, dpr * 1.15);
  if (Math.abs(next - dpr) > 0.02) { dpr = next; lastChange = now; scene.setPixelRatio(dpr); }
}
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  adaptResolution(now, now - last);
  last = now;
  scene.render(dt);
  if (uiDirty && now - lastUI > 100) { uiDirty = false; lastUI = now; updateStatus(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
