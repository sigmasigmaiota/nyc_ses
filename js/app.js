/* NYC SES Diversity Explorer
 * Recomputes three income-diversity methods (ICE, income entropy, low x high classes)
 * and Theil's H from ACS tract counts, so the income thresholds can be changed live.
 * Data: window.SES_DATA, written by R/export_app_data.R.
 */
(function () {
  'use strict';

  const D = window.SES_DATA;
  if (!D) {
    document.querySelector('main').innerHTML =
      '<div class="panel" style="padding:16px">Data file <code>data/ses_app_data.js</code> was not found. ' +
      'Run <code>R/export_app_data.R</code> or knit <code>ses_diversity_maps.Rmd</code> to create it.</div>';
    return;
  }
  const META = D.meta, T = D.tracts, N = T.length;
  const LB = META.brackets;                 // lower bound of each of the 16 B19001 brackets
  const COUNTIES = META.counties;
  const RACE = META.race_groups;
  const BORO_PREFIX = ['BX', 'BK', 'MN', 'QN', 'SI'];
  const FOCUS_NAMES = { 1: 'Northern Manhattan', 2: 'South Bronx' };

  // ------------------------------------------------------------------ colors
  const SEQ = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
  const DIV = ['#9e2a2b', '#e34948', '#f3a59f', '#f0efec', '#9ec5f4', '#3987e5', '#1c5cab'];
  const DIV_BREAKS = [-0.4, -0.2, -0.05, 0.05, 0.2, 0.4];
  const BIV = { '1-1': '#e8e8e8', '2-1': '#ace4e4', '3-1': '#5ac8c8',
                '1-2': '#dfb0d6', '2-2': '#a5add3', '3-2': '#5698b9',
                '1-3': '#be64ac', '2-3': '#8c62aa', '3-3': '#3b4994' };
  const BIV_NAMES = { '1-1': 'Middle-income', '2-1': 'Fewer high-income', '3-1': 'Concentrated low income',
                      '1-2': 'Fewer low-income', '2-2': 'Close to the US mix', '3-2': 'More low-income',
                      '1-3': 'Concentrated high income', '2-3': 'More high-income', '3-3': 'Mixed' };
  const RACE_COL = ['#eb6834', '#2a78d6', '#e87ba4', '#1baf7a', '#7a7a75'];
  const RACE_COL_LIGHT = RACE_COL.map(c => mix(c, '#ffffff', 0.55));
  const NA_COL = '#cfcdc7';
  const FOCUS_COL = { 1: '#2a78d6', 2: '#eb6834' };

  function mix(a, b, t) {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  // ------------------------------------------------------------------ formatting
  const ok = x => x !== null && x !== undefined && isFinite(x);
  const pct = (x, d = 0) => ok(x) ? (x * 100).toFixed(d) + '%' : '–';
  const num = (x, d = 2) => ok(x) ? x.toFixed(d).replace('-', '−') : '–';
  const signed = (x, d = 2) => ok(x) ? (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) : '–';
  const usd = x => ok(x) ? '$' + Math.round(x).toLocaleString('en-US') : '–';
  const usdk = x => ok(x) ? '$' + Math.round(x / 1000) + 'k' : '–';
  const int = x => ok(x) ? Math.round(x).toLocaleString('en-US') : '–';
  const kLabel = v => '$' + (v / 1000) + 'k';
  const cdtaLabel = code => { const n = META.cdta_names[code] || ''; return n.startsWith(code) ? n : (code + ' ' + n).trim(); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------------ state
  const LOW_OPTS = [10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 60000, 75000];
  const HIGH_OPTS = [75000, 100000, 125000, 150000, 200000];
  const DEFAULTS = { low: 30000, high: 150000, tier: 5, eg: 'q5', flag: true, basemap: true,
                     layout: 'compare', area: 'focus', ma: 'ice_inc', mb: 'bivar',
                     scy: 'ice_inc', scx: 'log_med_inc', lh: 'focus', tab: 'scatter' };
  const S = Object.assign({}, DEFAULTS);
  let selected = -1;

  function readHash() {
    try {
      const h = new URLSearchParams(location.hash.slice(1));
      for (const [k, v] of h) {
        if (!(k in DEFAULTS)) continue;
        const d = DEFAULTS[k];
        S[k] = typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? v === '1' : v;
      }
    } catch (e) { /* ignore malformed hash */ }
    if (!LOW_OPTS.includes(S.low)) S.low = DEFAULTS.low;
    if (!HIGH_OPTS.includes(S.high) || S.high <= S.low) S.high = DEFAULTS.high;
    if (!(S.tier >= 2 && S.tier <= 10)) S.tier = DEFAULTS.tier;
  }
  function writeHash() {
    const h = new URLSearchParams();
    for (const k in DEFAULTS) {
      if (S[k] === DEFAULTS[k]) continue;
      h.set(k, typeof S[k] === 'boolean' ? (S[k] ? '1' : '0') : S[k]);
    }
    const s = h.toString();
    try { history.replaceState(null, '', s ? '#' + s : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }

  // ------------------------------------------------------------------ computation
  const sum = (a, i0 = 0, i1 = a.length) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i]; return s; };
  const sumSq = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return s; };

  function moeProp(x, y, mx, my) {     // ACS handbook ch. 8, proportion (falls back to ratio formula)
    if (!(y > 0)) return null;
    const p = x / y;
    let rad = mx * mx - p * p * my * my;
    if (rad < 0) rad = mx * mx + p * p * my * my;
    return Math.sqrt(rad) / y;
  }
  function entropyRaw(counts) {
    const tot = sum(counts);
    if (!(tot > 0)) return null;
    let h = 0;
    for (const c of counts) if (c > 0) { const p = c / tot; h -= p * Math.log(p); }
    return h;
  }
  function entropyNorm(counts) {
    const h = entropyRaw(counts);
    return h === null ? null : h / Math.log(counts.length);
  }
  function theilH(rows) {               // rows: array of count vectors, one per tract
    rows = rows.filter(r => sum(r) > 0);
    if (rows.length < 2) return null;
    const K = rows[0].length, tot = new Array(K).fill(0);
    let T_all = 0;
    for (const r of rows) { for (let k = 0; k < K; k++) tot[k] += r[k]; }
    T_all = sum(tot);
    const E = entropyRaw(tot);
    if (!(E > 0)) return null;
    let acc = 0;
    for (const r of rows) acc += sum(r) * (E - entropyRaw(r));
    return acc / (T_all * E);
  }
  function groupsFor(eg, lowIdx, highIdx) {
    if (eg === 'all16') return Array.from({ length: 16 }, (_, i) => [i, i + 1]);
    if (eg === 'lmh') return [[0, lowIdx], [lowIdx, highIdx], [highIdx, 16]];
    return [[0, 5], [5, 10], [10, 12], [12, 14], [14, 16]];   // Rmd default (~US quintiles)
  }
  function groupLabels(eg, lowIdx, highIdx) {
    const lab = ([a, b]) => b >= 16 ? kLabel(LB[a]) + '+' : a === 0 ? '< ' + kLabel(LB[b]) : kLabel(LB[a]) + '–' + kLabel(LB[b]);
    return groupsFor(eg, lowIdx, highIdx).map(lab);
  }

  let C = [];          // computed values per tract
  let NAT = {};        // national shares under current cut points
  let G = [];          // entropy group index ranges

  function compute() {
    const lowIdx = LB.indexOf(S.low), highIdx = LB.indexOf(S.high);
    G = groupsFor(S.eg, lowIdx, highIdx);
    const tier = S.tier / 100;
    const usTot = sum(META.us_bins);
    NAT = { low: sum(META.us_bins, 0, lowIdx) / usTot, high: sum(META.us_bins, highIdx) / usTot, lowIdx, highIdx };
    NAT.lowBreaks = [NAT.low - tier, NAT.low + tier];
    NAT.highBreaks = [NAT.high - tier, NAT.high + tier];
    const tierOf = (p, b) => p < b[0] ? 1 : p < b[1] ? 2 : 3;

    C = T.map(t => {
      const hh = t.hh;
      const lo = sum(t.b, 0, lowIdx), hi = sum(t.b, highIdx);
      const loW = sum(t.w, 0, lowIdx), hiW = sum(t.w, highIdx);
      const p_low = lo / hh, p_high = hi / hh;
      const m_lo = moeProp(lo, hh, Math.sqrt(sumSq(t.bm, 0, lowIdx)), t.hhm);
      const m_hi = moeProp(hi, hh, Math.sqrt(sumSq(t.bm, highIdx, 16)), t.hhm);
      const gc = G.map(([a, b]) => sum(t.b, a, b));
      const rs = t.r.map(v => t.rt > 0 ? v / t.rt : null);
      let li = 0; for (let k = 1; k < 5; k++) if (t.r[k] > t.r[li]) li = k;
      const bi = tierOf(p_low, NAT.lowBreaks) + '-' + tierOf(p_high, NAT.highBreaks);
      return {
        lo, hi, p_low, p_high, m_lo, m_hi, gc,
        ice_inc: p_high - p_low,
        ice_race: (hiW - (lo - loW)) / hh,
        entropy: entropyNorm(gc),
        bivar: bi,
        unrel_lh: (m_lo > 0.10) || (m_hi > 0.10),
        unrel_mi: ok(t.mi) && ok(t.mim) ? (t.mim / 1.645) / t.mi > 0.30 : false,
        race_largest: t.rt > 0 ? li : null,
        race_major: t.rt > 0 ? rs[li] >= 0.5 : false,
        rs,
        med_inc: ok(t.mi) ? t.mi : null,
        log_med_inc: ok(t.mi) ? Math.log10(t.mi) : null,
        pov200: t.o[1], ba: t.o[2], rentb: t.o[3], crowd: t.o[4], gini: t.o[0]
      };
    });
    MEASURES.forEach(m => { if (m.breaksMode === 'quantile') m.breaks = quantileBreaks(m.value); });
  }

  function quantileBreaks(valueFn, n = 5) {
    const v = [];
    for (let i = 0; i < N; i++) { const x = valueFn(i); if (ok(x)) v.push(x); }
    v.sort((a, b) => a - b);
    const out = [];
    for (let k = 1; k < n; k++) {
      const pos = (v.length - 1) * k / n, lo = Math.floor(pos);
      out.push(v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (pos - lo));
    }
    return out;
  }
  const classOf = (x, breaks) => { let c = 0; while (c < breaks.length && x >= breaks[c]) c++; return c; };

  // ------------------------------------------------------------------ measures
  const lowTxt = () => 'under ' + kLabel(S.low);
  const highTxt = () => kLabel(S.high) + ' or more';
  const MEASURES = [
    { key: 'ice_inc', label: 'M1: ICE, income', group: 'Diversity methods', type: 'div',
      value: i => C[i].ice_inc, fmt: x => signed(x), unrel: i => C[i].unrel_lh },
    { key: 'entropy', label: 'M2: Income entropy', group: 'Diversity methods', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].entropy, fmt: x => num(x, 2) },
    { key: 'bivar', label: 'M3: Low × high income', group: 'Diversity methods', type: 'bivar',
      value: i => C[i].bivar, fmt: x => BIV_NAMES[x] || ('Class ' + x), unrel: i => C[i].unrel_lh },
    { key: 'ice_race', label: 'ICE, race + income', group: 'Diversity methods', type: 'div',
      value: i => C[i].ice_race, fmt: x => signed(x) },
    { key: 'med_inc', label: 'Median household income', group: 'Income', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].med_inc, fmt: usdk, unrel: i => C[i].unrel_mi },
    { key: 'p_low', label: 'Share of households: low income', group: 'Income', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].p_low, fmt: x => pct(x), unrel: i => C[i].m_lo > 0.10 },
    { key: 'p_high', label: 'Share of households: high income', group: 'Income', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].p_high, fmt: x => pct(x), unrel: i => C[i].m_hi > 0.10 },
    { key: 'race_largest', label: 'Largest race/ethnic group', group: 'Race/ethnicity', type: 'cat',
      value: i => C[i].race_largest, fmt: x => ok(x) ? RACE[x] : '–' },
    ...RACE.map((g, k) => ({ key: 'race_' + k, label: 'Share: ' + g, group: 'Race/ethnicity', type: 'seq',
      breaks: [0.1, 0.25, 0.5, 0.75], value: i => C[i].rs[k], fmt: x => pct(x) })),
    { key: 'pov200', label: 'Below 200% of poverty', group: 'Other SES', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].pov200, fmt: x => pct(x) },
    { key: 'ba', label: "Bachelor's degree or higher (25+)", group: 'Other SES', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].ba, fmt: x => pct(x) },
    { key: 'rentb', label: 'Renters paying 30%+ of income', group: 'Other SES', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].rentb, fmt: x => pct(x) },
    { key: 'crowd', label: 'Crowded housing (>1 person/room)', group: 'Other SES', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].crowd, fmt: x => pct(x, 1) },
    { key: 'gini', label: 'Gini index (within tract)', group: 'Other SES', type: 'seq', breaksMode: 'quantile',
      value: i => C[i].gini, fmt: x => num(x, 2) }
  ];
  const MBY = Object.fromEntries(MEASURES.map(m => [m.key, m]));

  function colorFor(m, i) {
    const x = m.value(i);
    if (m.type === 'bivar') return BIV[x] || NA_COL;
    if (!ok(x)) return NA_COL;
    if (m.type === 'cat') return C[i].race_major ? RACE_COL[x] : RACE_COL_LIGHT[x];
    if (m.type === 'div') return DIV[classOf(x, DIV_BREAKS)];
    return SEQ[classOf(x, m.breaks)];
  }

  // ------------------------------------------------------------------ areas
  const AREAS = [
    { key: 'all', label: 'All 8 counties', test: () => true },
    ...COUNTIES.map((c, k) => ({ key: 'c' + k, label: c, test: t => t.c === k })),
    { key: 'focus', label: 'Northern Manhattan + South Bronx', test: t => t.f > 0 },
    { key: 'nm', label: 'Northern Manhattan (MN09–MN12)', test: t => t.f === 1 },
    { key: 'sb', label: 'South Bronx (BX01–BX06)', test: t => t.f === 2 }
  ];
  const ABY = Object.fromEntries(AREAS.map(a => [a.key, a]));
  const inArea = (i, key = S.area) => ABY[key].test(T[i]);
  const areaIdx = key => { const o = []; for (let i = 0; i < N; i++) if (inArea(i, key)) o.push(i); return o; };

  function summarize(idx) {
    const hh = sum(idx.map(i => T[i].hh));
    const lo = sum(idx.map(i => C[i].lo)), hi = sum(idx.map(i => C[i].hi));
    const lowIdx = NAT.lowIdx, highIdx = NAT.highIdx;
    const loW = sum(idx.map(i => sum(T[i].w, 0, lowIdx))), hiW = sum(idx.map(i => sum(T[i].w, highIdx)));
    const gTot = G.map((_, k) => sum(idx.map(i => C[i].gc[k])));
    const rTot = [0, 1, 2, 3, 4].map(k => sum(idx.map(i => T[i].r[k])));
    const mis = idx.map(i => C[i].med_inc).filter(ok).sort((a, b) => a - b);
    const q = p => { if (!mis.length) return null; const pos = (mis.length - 1) * p, l = Math.floor(pos); return mis[l] + (mis[Math.min(l + 1, mis.length - 1)] - mis[l]) * (pos - l); };
    const share = cls => sum(idx.filter(i => C[i].bivar === cls).map(i => T[i].hh)) / hh;
    return {
      n: idx.length, hh, pop: sum(idx.map(i => T[i].rt)),
      inc_p50: q(0.5), p90p10: q(0.9) / q(0.1),
      p_low: lo / hh, p_high: hi / hh, ice: (hi - lo) / hh,
      ice_race: (hiW - (lo - loW)) / hh,
      ent_area: entropyNorm(gTot),
      ent_mean: sum(idx.map(i => (C[i].entropy || 0) * T[i].hh)) / hh,
      h_inc: theilH(idx.map(i => C[i].gc)),
      h_race: theilH(idx.map(i => T[i].r)),
      mixed: share('3-3'), middle: share('1-1'), conc_low: share('3-1'), conc_high: share('1-3'),
      race: rTot.map(r => r / sum(rTot))
    };
  }

  // ------------------------------------------------------------------ maps
  const maps = [], tractLayers = [], tractRefs = [[], []], labelLayers = [], tileLayers = [], areaOutline = [];
  const idxById = new Map(T.map((t, i) => [t.id, i]));
  let syncing = false;
  const cdtaCenters = [];

  function makeMap(elId, side) {
    const map = L.map(elId, { preferCanvas: true, zoomSnap: 1, zoomDelta: 1, minZoom: 8, maxZoom: 16 }).setView([40.78, -73.4], 9);
    const renderer = L.canvas({ padding: 0.3 });
    const tiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxZoom: 16 });
    if (S.basemap) tiles.addTo(map);
    tileLayers[side] = tiles;

    const layer = L.geoJSON(D.geo.tracts, {
      renderer,
      style: () => ({}),
      onEachFeature: (f, lyr) => {
        const i = idxById.get(f.properties.id);
        tractRefs[side][i] = lyr;
        lyr.on('click', () => selectTract(i, false));
        lyr.bindTooltip(() => tipHtml(i, side === 0 ? S.ma : S.mb), { sticky: true, className: 'tract-tip', direction: 'top', offset: [0, -6] });
      }
    }).addTo(map);
    tractLayers[side] = layer;
    if (D.geo.cdtas) L.geoJSON(D.geo.cdtas, { renderer, interactive: false, style: { color: '#444', weight: 0.6, opacity: 0.7, fill: false } }).addTo(map);
    L.geoJSON(D.geo.counties, { renderer, interactive: false, style: { color: '#222', weight: 1.4, opacity: 0.9, fill: false } }).addTo(map);
    areaOutline[side] = L.layerGroup().addTo(map);
    labelLayers[side] = L.layerGroup().addTo(map);

    map.on('zoomend', () => { if (tractLayers[side]) tractLayers[side].setStyle(styleFn(side)); });
    map.on('move', () => {
      if (syncing || S.layout !== 'compare') return;
      const other = maps[1 - side];
      if (!other) return;
      syncing = true;
      other.setView(map.getCenter(), map.getZoom(), { animate: false });
      syncing = false;
    });
    maps[side] = map;
  }

  function tipHtml(i, key) {
    const t = T[i], m = MBY[key];
    const where = COUNTIES[t.c] + (t.d ? ' · ' + cdtaLabel(t.d) : '');
    return '<b>' + esc(t.n) + '</b><br>' + esc(where) + '<br>' + esc(m.label) + ': <b>' + esc(m.fmt(m.value(i))) + '</b>';
  }

  function styleFn(side) {
    const m = MBY[side === 0 ? S.ma : S.mb];
    const all = S.area === 'all';
    const zoomOk = !maps[side] || maps[side].getZoom() >= 11;
    return f => {
      const i = idxById.get(f.properties.id);
      const inside = all || inArea(i);
      const st = { fillColor: colorFor(m, i), fillOpacity: inside ? 0.88 : 0.18,
                   color: '#ffffff', weight: 0.3, opacity: inside ? 0.6 : 0, dashArray: null };
      if (inside && S.flag && zoomOk && m.unrel && m.unrel(i)) { st.color = '#1b1b1a'; st.weight = 0.7; st.opacity = 0.55; st.dashArray = '2 3'; }
      if (i === selected) { st.color = '#000000'; st.weight = 2.6; st.opacity = 1; st.dashArray = null; }
      return st;
    };
  }

  function restyle() {
    [0, 1].forEach(s => { if (tractLayers[s]) tractLayers[s].setStyle(styleFn(s)); });
    if (selected >= 0) [0, 1].forEach(s => { const l = tractRefs[s][selected]; if (l) l.bringToFront(); });
  }

  function areaBounds(key) {
    let b = null;
    for (let i = 0; i < N; i++) {
      if (!inArea(i, key)) continue;
      const l = tractRefs[0][i];
      if (!l) continue;
      b = b ? b.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast());
    }
    return b;
  }

  function updateAreaDecor(fit) {
    const key = S.area;
    // CDTA labels
    let codes = [];
    if (key === 'focus') codes = META.focus.nm.concat(META.focus.sb);
    else if (key === 'nm') codes = META.focus.nm;
    else if (key === 'sb') codes = META.focus.sb;
    else if (/^c[0-4]$/.test(key)) { const p = BORO_PREFIX[+key.slice(1)]; codes = cdtaCenters.filter(c => c.code.startsWith(p)).map(c => c.code); }
    [0, 1].forEach(s => {
      labelLayers[s].clearLayers();
      cdtaCenters.filter(c => codes.includes(c.code)).forEach(c =>
        L.marker(c.ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'cdta-label', html: c.code, iconSize: null }) }).addTo(labelLayers[s]));
    });
    if (fit) {
      const b = areaBounds(key);
      if (b) maps[0].fitBounds(b, { padding: [12, 12] });
      if (S.layout === 'compare' && maps[1]) maps[1].setView(maps[0].getCenter(), maps[0].getZoom(), { animate: false });
    }
  }

  // ------------------------------------------------------------------ legends
  function legendHtml(key) {
    const m = MBY[key];
    if (m.type === 'bivar') {
      const lb = NAT.lowBreaks, hb = NAT.highBreaks;
      let cells = '';
      for (let y = 3; y >= 1; y--) for (let x = 1; x <= 3; x++) cells += '<i style="background:' + BIV[x + '-' + y] + '" title="' + (BIV_NAMES[x + '-' + y] || '') + '"></i>';
      return '<div class="bivar-legend"><div class="bivar-key"><span class="bivar-y">high income ' + highTxt() + ' →</span>' +
        '<div class="bivar-grid">' + cells + '</div><span class="bivar-x">low income ' + lowTxt() + ' →</span></div>' +
        '<div class="bivar-axis"><b>Upper right:</b> mixed<br><b>Lower right:</b> concentrated low income<br><b>Upper left:</b> concentrated high income<br><b>Lower left:</b> middle-income' +
        '<br><span class="muted">Tier cut points: low ' + pct(lb[0]) + ' / ' + pct(lb[1]) + ', high ' + pct(hb[0]) + ' / ' + pct(hb[1]) + '</span></div></div>' +
        '<div class="note">' + flagNote(m) + '</div>';
    }
    if (m.type === 'cat') {
      return '<div class="cats">' + RACE.map((g, k) => '<span class="cat"><i style="background:' + RACE_COL[k] + '"></i>' + esc(g) + '</span>').join('') +
        '</div><div class="note">Full color = majority (50%+); pale = largest group but under 50%. Hover a tract to see its group named.</div>';
    }
    const breaks = m.type === 'div' ? DIV_BREAKS : m.breaks;
    const cols = m.type === 'div' ? DIV : SEQ;
    const n = cols.length;
    const note = m.type === 'div' ? 'Red = more low- than high-income households; blue = the reverse; gray ≈ balanced.'
      : m.breaksMode === 'quantile' ? 'Classes are fifths of all tracts in the 8 counties, so colors match across areas.' : '';
    return '<div class="ramp"><div class="ramp-sw">' + cols.map(c => '<i style="background:' + c + '"></i>').join('') + '</div>' +
      '<div class="ramp-ticks">' + breaks.map((b, k) => '<span style="left:' + (100 * (k + 1) / n) + '%">' + esc(m.fmt(b)) + '</span>').join('') + '</div></div>' +
      '<div class="note">' + note + ' ' + flagNote(m) + '</div>';
  }
  const flagNote = m => (m.unrel && S.flag) ? '<span>Dashed outline = unreliable estimate (' + (m.key === 'med_inc' ? 'CV > 30%' : 'MOE of the low- or high-income share > ±10 pts') + '); shown when zoomed in.</span>' : '';

  // ------------------------------------------------------------------ explanations
  function explainFor(key) {
    const L_ = lowTxt(), H_ = highTxt();
    const us = 'US: ' + pct(NAT.low) + ' of households are ' + L_ + ', ' + pct(NAT.high) + ' are ' + H_ + '.';
    const E = {
      ice_inc: { t: 'M1: Index of Concentration at the Extremes (income)',
        what: 'Is the tract tilted toward the top or the bottom of the income distribution?',
        f: 'ICE = (households ' + H_ + ' − households ' + L_ + ') / all households\n    = p_high − p_low        range −1 … +1',
        read: '−1 means every household is low-income and +1 means every household is high-income. ' + us,
        cav: 'A tract near 0 may be mixed (many of both) or middle-income (few of either). M3 tells them apart.' },
      entropy: { t: 'M2: Income entropy (Shannon diversity)',
        what: 'How evenly are households spread across income groups? This is a direct measure of economic mixing.',
        f: 'H = −Σ p_k · ln(p_k)   over K = ' + G.length + ' groups\nH_norm = H / ln(K)      0 = all in one group … 1 = perfectly even\ngroups: ' + groupLabels(S.eg, NAT.lowIdx, NAT.highIdx).join(', '),
        read: 'Darker = households spread more evenly across the income groups.',
        cav: 'Entropy measures spread, not polarization. A tract split between rich and poor can score lower than a mostly low-income tract whose households are spread out. It also doesn\'t say which groups dominate.' },
      bivar: { t: 'M3: Low-income × high-income shares',
        what: 'Shows the low-income and high-income shares together, so mixed tracts and middle-income tracts look different.',
        f: 'p_low  = households ' + L_ + ' / all households\np_high = households ' + H_ + ' / all households\neach share → tier 1 / 2 / 3: below / within / above the US share ± ' + S.tier + ' pts',
        read: 'Dark blue-purple = mixed (many low- AND many high-income households). Light gray = middle-income (few of either). Teal = concentrated low income. Pink = concentrated high income. ' + us,
        cav: 'The tiers are anchored to national shares, so classes mean the same thing in every area, but they don\'t reflect New York\'s cost of living.' },
      ice_race: { t: 'ICE, race + income (Krieger et al.)',
        what: 'Contrasts high-income white non-Hispanic households with low-income households of color.',
        f: 'ICE = (white NH households ' + H_ + ' − households of color ' + L_ + ') / all households',
        read: 'Negative = concentration of low-income households of color; positive = concentration of high-income white households.',
        cav: 'Combines income and race in one contrast, which captures racialized economic segregation but can\'t separate the two.' },
      med_inc: { t: 'Median household income', what: 'ACS table B19013, the plain income reference map.',
        f: 'reported directly by the ACS (not recomputed)',
        read: 'Darker = higher median income. Classes are fifths of all tracts in the eight counties.',
        cav: 'The ACS top-codes medians at $250,001, so the wealthiest tracts all share the top class. A median says nothing about how mixed a tract is.' },
      p_low: { t: 'Share of households: low income (' + L_ + ')', what: 'One of the two inputs to M1 and M3.', f: 'p_low = households ' + L_ + ' / all households (B19001)', read: us, cav: 'Uses national dollar thresholds; no cost-of-living adjustment.' },
      p_high: { t: 'Share of households: high income (' + H_ + ')', what: 'One of the two inputs to M1 and M3.', f: 'p_high = households ' + H_ + ' / all households (B19001)', read: us, cav: 'Uses national dollar thresholds; no cost-of-living adjustment.' },
      race_largest: { t: 'Largest race/ethnic group', what: 'The plain race/ethnicity reference map: the largest of five mutually exclusive groups (ACS B03002).',
        f: 'groups: Hispanic (any race), NH Black, NH White, NH Asian, NH other/multiracial',
        read: 'Full color = that group is a majority (50%+); pale = largest but under 50%.',
        cav: 'One "largest group" hides mixing; the "Share:" maps show each group separately. Five colors can\'t all be told apart by every viewer, so hover a tract to see its group named.' },
      pov200: { t: 'Below 200% of the poverty line', what: 'ACS C17002.', f: 'persons with income-to-poverty ratio < 2.00 / persons for whom poverty is determined', read: 'Darker = more people near or below poverty.', cav: 'Federal poverty thresholds don\'t vary with local costs.' },
      ba: { t: "Bachelor's degree or higher", what: 'ACS B15003, adults 25 and older.', f: "adults 25+ with a bachelor's, master's, professional or doctoral degree / adults 25+", read: 'Darker = more college graduates.', cav: '' },
      rentb: { t: 'Rent burden', what: 'ACS B25070.', f: 'renter households paying 30%+ of income on rent / renter households with rent computed', read: 'Darker = more cost-burdened renters.', cav: 'Tracts with few renters have noisy estimates.' },
      crowd: { t: 'Crowded housing', what: 'ACS B25014.', f: 'occupied units with more than 1 person per room / occupied units', read: 'Darker = more crowding.', cav: '' },
      gini: { t: 'Gini index (within tract)', what: 'ACS B19083: income inequality among households inside the tract.', f: 'reported directly by the ACS', read: 'Darker = more unequal incomes within the tract.', cav: 'Gini describes inequality, not whether incomes cluster at the low or the high end.' }
    };
    if (key.startsWith('race_') && key !== 'race_largest') {
      const k = +key.slice(5);
      return { t: 'Share of residents: ' + RACE[k], what: 'ACS B03002, one of five mutually exclusive groups.', f: RACE[k] + ' residents / all residents', read: 'Darker = larger share. Fixed classes: under 10%, 10–25%, 25–50%, 50–75%, 75%+.', cav: '' };
    }
    return E[key];
  }

  function renderExplain() {
    const keys = S.layout === 'compare' ? [S.ma, S.mb] : [S.ma];
    const el = document.getElementById('explain');
    el.className = 'panel explain' + (keys.length === 1 ? ' single' : '');
    el.innerHTML = keys.map(k => {
      const e = explainFor(k);
      return '<div><h3>' + esc(e.t) + '</h3><p>' + esc(e.what) + '</p><div class="formula">' + esc(e.f) + '</div><p>' + esc(e.read) + '</p>' +
        (e.cav ? '<p class="caveat">' + esc(e.cav) + '</p>' : '') + '</div>';
    }).join('');
  }

  // ------------------------------------------------------------------ area snapshot
  function renderSnapshot() {
    const s = summarize(areaIdx(S.area));
    const a = ABY[S.area].label;
    const cmp = (x, us) => x > us + 0.02 ? 'more' : x < us - 0.02 ? 'fewer' : 'about as many';
    const sortedBy = s.h_race > s.h_inc * 1.15 ? 'race/ethnicity than by income' : s.h_inc > s.h_race * 1.15 ? 'income than by race/ethnicity' : null;
    const kpi = (v, k) => '<div class="kpi"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
    document.getElementById('snapshot').innerHTML =
      '<h3>Area snapshot: ' + esc(a) + '</h3><div class="kpis">' +
      kpi(int(s.n), 'tracts · ' + int(s.hh) + ' households') +
      kpi(pct(s.p_low), 'households ' + lowTxt() + ' (US ' + pct(NAT.low) + ')') +
      kpi(pct(s.p_high), 'households ' + highTxt() + ' (US ' + pct(NAT.high) + ')') +
      kpi(signed(s.ice), 'M1 ICE, whole area') +
      kpi(num(s.ent_area), 'M2 entropy, whole area') +
      kpi(pct(s.mixed), 'households in M3 "mixed" tracts') +
      kpi(num(s.h_inc), "Theil's H, income") +
      kpi(num(s.h_race), "Theil's H, race/ethnicity") +
      '</div><p>Compared with the US, ' + esc(a) + ' has ' + cmp(s.p_low, NAT.low) + ' low-income households and ' + cmp(s.p_high, NAT.high) +
      ' high-income households. ' + pct(s.conc_low) + ' of its households live in concentrated low-income tracts, ' + pct(s.conc_high) + ' in concentrated high-income tracts, ' +
      pct(s.middle) + ' in middle-income tracts and ' + pct(s.mixed) + ' in mixed tracts.</p>' +
      '<p>Average tract entropy (' + num(s.ent_mean) + ') vs. whole-area entropy (' + num(s.ent_area) + '): the gap between them is what Theil\'s H measures. ' +
      (sortedBy ? 'Households here are more sorted between tracts by ' + sortedBy + '.' : 'Households are sorted between tracts to a similar degree by income and by race/ethnicity.') + '</p>';
  }

  // ------------------------------------------------------------------ tract detail
  function selectTract(i, pan) {
    selected = i;
    restyle();
    renderDetail();
    if (pan && i >= 0) { const l = tractRefs[0][i]; if (l) maps[0].panTo(l.getBounds().getCenter()); }
    renderCharts();
  }

  function renderDetail() {
    const el = document.getElementById('detail');
    if (selected < 0) { el.classList.remove('show'); el.innerHTML = ''; return; }
    el.classList.add('show');
    const i = selected, t = T[i], c = C[i];
    const rank = (key) => { const v = MBY[key].value(i); if (!ok(v)) return null; let below = 0, n = 0; for (let j = 0; j < N; j++) { const x = MBY[key].value(j); if (ok(x)) { n++; if (x < v) below++; } } return below / n; };
    const er = rank('entropy');
    const row = (k, v) => '<tr><td>' + k + '</td><td>' + v + '</td></tr>';
    const moe = x => ok(x) ? ' ± ' + (x * 100).toFixed(0) + ' pts' : '';
    const cls = BIV_NAMES[c.bivar];
    const lh = c.bivar.split('-').map(Number);
    const tierWord = ['', 'below', 'near', 'above'];
    el.innerHTML =
      '<header><h3>' + esc(t.n) + '</h3><span class="sub">' + esc(COUNTIES[t.c]) + (t.d ? ' · ' + esc(cdtaLabel(t.d)) : '') +
      (t.f ? ' · ' + FOCUS_NAMES[t.f] : '') + '</span><button class="btn x" id="close-detail" type="button">Close</button></header>' +
      '<div class="detail-grid"><div><table>' +
      row('Households / residents', int(t.hh) + ' / ' + int(t.rt)) +
      row('Median household income', usd(c.med_inc) + (ok(t.mim) ? ' ± ' + usd(t.mim) : '')) +
      row('Households ' + lowTxt(), pct(c.p_low) + moe(c.m_lo)) +
      row('Households ' + highTxt(), pct(c.p_high) + moe(c.m_hi)) +
      row('M1: ICE income', signed(c.ice_inc)) +
      row('M2: income entropy', num(c.entropy)) +
      row('M3: low × high class', esc(cls)) +
      row('ICE race + income', signed(c.ice_race)) +
      row('Largest group', ok(c.race_largest) ? esc(RACE[c.race_largest]) + ' (' + pct(c.rs[c.race_largest]) + ')' : '–') +
      RACE.map((g, k) => row('&nbsp;&nbsp;' + esc(g), pct(c.rs[k]))).join('') +
      row('Below 200% of poverty', pct(c.pov200)) + row("Bachelor's+", pct(c.ba)) +
      '</table></div><div><div id="detail-chart"></div><div class="reading">' +
      '<p>' + pct(c.p_low) + ' of households earn ' + lowTxt() + ' (US ' + pct(NAT.low) + ') and ' + pct(c.p_high) + ' earn ' + highTxt() + ' (US ' + pct(NAT.high) + '). ' +
      'The low-income share is <b>' + tierWord[lh[0]] + '</b> the US share and the high-income share is <b>' + tierWord[lh[1]] + '</b> it, so M3 classes this tract as <b>' + esc(cls.toLowerCase()) + '</b>.</p>' +
      (ok(er) ? '<p>Its income entropy is higher than ' + pct(er) + ' of tracts in the eight counties.</p>' : '') +
      (c.unrel_lh ? '<p><b>Caution:</b> the margin of error on the low- or high-income share is wider than ±10 percentage points, so treat the M1 and M3 values loosely.</p>' : '') +
      '</div></div></div>';
    document.getElementById('close-detail').onclick = () => selectTract(-1);
    drawBracketChart(document.getElementById('detail-chart'), t);
  }

  function drawBracketChart(host, t) {
    const W = 520, H = 220, m = { l: 36, r: 8, t: 22, b: 52 };
    const usTot = sum(META.us_bins);
    const tr = t.b.map(v => v / t.hh), us = META.us_bins.map(v => v / usTot);
    const ymax = Math.max(0.05, ...tr, ...us) * 1.1;
    const bw = (W - m.l - m.r) / 16;
    const y = v => m.t + (H - m.t - m.b) * (1 - v / ymax);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Household income distribution of the tract compared with the US">';
    s += '<text class="title" x="' + m.l + '" y="14">Household income distribution: tract (bars) vs. US (ticks)</text>';
    [0, ymax / 2, ymax].forEach(v => { s += '<line class="gridline" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (m.l - 4) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + pct(v) + '</text>'; });
    for (let k = 0; k < 16; k++) {
      const x = m.l + k * bw;
      const isLow = k < NAT.lowIdx, isHigh = k >= NAT.highIdx;
      const col = isLow ? '#e34948' : isHigh ? '#1c5cab' : '#9a998f';
      const top = y(tr[k]);
      s += '<rect x="' + (x + 1) + '" y="' + top + '" width="' + (bw - 2) + '" height="' + Math.max(0, y(0) - top) + '" rx="2" fill="' + col + '"><title>' + kLabel(LB[k]) + (k < 15 ? '–' + kLabel(LB[k + 1]) : '+') + ': tract ' + pct(tr[k], 1) + ', US ' + pct(us[k], 1) + '</title></rect>';
      s += '<line x1="' + (x + 2) + '" x2="' + (x + bw - 2) + '" y1="' + y(us[k]) + '" y2="' + y(us[k]) + '" stroke="currentColor" stroke-width="2" style="color:var(--text)"/>';
      if (k % 2 === 0 || k === 15) s += '<text x="' + (x + bw / 2) + '" y="' + (H - m.b + 12) + '" text-anchor="end" transform="rotate(-45 ' + (x + bw / 2) + ' ' + (H - m.b + 12) + ')">' + kLabel(LB[k]) + '</text>';
    }
    s += '<text x="' + m.l + '" y="' + (H - 4) + '">Red = low-income brackets; blue = high-income brackets (current cut points)</text></svg>';
    host.innerHTML = s;
  }

  // ------------------------------------------------------------------ charts
  const tip = document.getElementById('tooltip');
  function showTip(html, ev) { tip.innerHTML = html; tip.style.display = 'block'; const x = Math.min(ev.clientX + 14, window.innerWidth - 270); tip.style.left = x + 'px'; tip.style.top = (ev.clientY + 14) + 'px'; }
  const hideTip = () => { tip.style.display = 'none'; };

  const SC_X = { log_med_inc: { label: 'Median household income (log scale)', v: i => C[i].log_med_inc, fmt: x => usdk(Math.pow(10, x)), log: true },
                 race_0: { label: '% Hispanic', v: i => C[i].rs[0], fmt: x => pct(x) },
                 race_1: { label: '% NH Black', v: i => C[i].rs[1], fmt: x => pct(x) },
                 race_2: { label: '% NH White', v: i => C[i].rs[2], fmt: x => pct(x) },
                 race_3: { label: '% NH Asian', v: i => C[i].rs[3], fmt: x => pct(x) },
                 pov200: { label: '% below 200% of poverty', v: i => C[i].pov200, fmt: x => pct(x) },
                 ba: { label: "% bachelor's degree or higher", v: i => C[i].ba, fmt: x => pct(x) } };
  const SC_Y = { ice_inc: 'M1: ICE, income', entropy: 'M2: Income entropy', p_low: 'M3 input: low-income share', p_high: 'M3 input: high-income share', ice_race: 'ICE, race + income' };

  function spearman(xs, ys) {
    const rank = a => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); let i = 0; while (i < o.length) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[o[k][1]] = avg; i = j + 1; } return r; };
    const rx = rank(xs), ry = rank(ys), n = xs.length;
    if (n < 3) return null;
    const mx = sum(rx) / n, my = sum(ry) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxy / Math.sqrt(sxx * syy);
  }
  const niceTicks = (lo, hi, n = 5) => { const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))); const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => span / s <= n) || 10 * mag; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10)); return out; };
  const pointColor = i => T[i].f ? FOCUS_COL[T[i].f] : '#a9a8a2';

  function focusLegend(host) {
    host.innerHTML = '<span><i style="background:' + FOCUS_COL[1] + '"></i>Northern Manhattan</span><span><i style="background:' + FOCUS_COL[2] + '"></i>South Bronx</span><span><i style="background:#a9a8a2"></i>Other tracts</span>' +
      (selected >= 0 ? '<span><i style="background:transparent;border:2px solid var(--text)"></i>Selected tract</span>' : '');
  }

  function renderScatter() {
    const xs = SC_X[S.scx], yKey = S.scy, ym = MBY[yKey] || { fmt: x => pct(x) };
    const yv = i => yKey === 'p_low' ? C[i].p_low : yKey === 'p_high' ? C[i].p_high : MBY[yKey].value(i);
    const idx = areaIdx(S.area).filter(i => ok(xs.v(i)) && ok(yv(i)));
    const W = 900, H = 440, m = { l: 56, r: 16, t: 12, b: 44 };
    const host = document.getElementById('scatter');
    focusLegend(document.getElementById('sc-legend'));
    if (idx.length < 3) { host.innerHTML = '<p>Not enough tracts with data.</p>'; return; }
    const X = idx.map(xs.v), Y = idx.map(yv);
    let x0 = Math.min(...X), x1 = Math.max(...X), y0 = Math.min(...Y), y1 = Math.max(...Y);
    const px = (x1 - x0) * 0.04 || 0.01, py = (y1 - y0) * 0.06 || 0.01; x0 -= px; x1 += px; y0 -= py; y1 += py;
    const sx = v => m.l + (W - m.l - m.r) * (v - x0) / (x1 - x0), sy = v => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));
    const rho = spearman(X, Y);
    document.getElementById('sc-rho').innerHTML = 'Spearman ρ = <b>' + num(rho) + '</b> (' + idx.length + ' tracts)';
    let s = '<svg class="chart" id="sc-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatterplot of ' + esc(SC_Y[yKey]) + ' against ' + esc(xs.label) + '">';
    niceTicks(y0, y1).forEach(v => { s += '<line class="gridline" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + sy(v) + '" y2="' + sy(v) + '"/><text x="' + (m.l - 6) + '" y="' + (sy(v) + 3) + '" text-anchor="end">' + esc(ym.fmt(v)) + '</text>'; });
    const xt = xs.log ? [4, 4.25, 4.5, 4.75, 5, 5.25, 5.5].filter(v => v >= x0 && v <= x1) : niceTicks(x0, x1);
    xt.forEach(v => { s += '<line class="gridline" y1="' + m.t + '" y2="' + (H - m.b) + '" x1="' + sx(v) + '" x2="' + sx(v) + '"/><text x="' + sx(v) + '" y="' + (H - m.b + 14) + '" text-anchor="middle">' + esc(xs.fmt(v)) + '</text>'; });
    s += '<text x="' + ((m.l + W - m.r) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(xs.label) + '</text>';
    s += '<text transform="rotate(-90)" x="' + (-(m.t + H - m.b) / 2) + '" y="14" text-anchor="middle">' + esc(SC_Y[yKey]) + '</text>';
    const order = idx.slice().sort((a, b) => (T[a].f > 0) - (T[b].f > 0));
    order.forEach(i => { s += '<circle cx="' + sx(xs.v(i)).toFixed(1) + '" cy="' + sy(yv(i)).toFixed(1) + '" r="' + (T[i].f ? 3.6 : 2.6) + '" fill="' + pointColor(i) + '" fill-opacity="' + (T[i].f ? 0.9 : 0.45) + '" stroke="var(--surface)" stroke-width="0.6"/>'; });
    // binned median trend
    const pairs = idx.map(i => [xs.v(i), yv(i)]).sort((a, b) => a[0] - b[0]);
    const med = a => { const b = a.slice().sort((p, q) => p - q); const k = (b.length - 1) / 2; return (b[Math.floor(k)] + b[Math.ceil(k)]) / 2; };
    const nb = Math.min(10, Math.floor(pairs.length / 5));
    if (nb >= 3) {
      const pts = [];
      for (let b = 0; b < nb; b++) { const sl = pairs.slice(Math.floor(b * pairs.length / nb), Math.floor((b + 1) * pairs.length / nb)); pts.push([med(sl.map(p => p[0])), med(sl.map(p => p[1]))]); }
      s += '<polyline fill="none" stroke="var(--text)" stroke-width="2" points="' + pts.map(p => sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join(' ') + '"/>';
    }
    if (selected >= 0 && ok(xs.v(selected)) && ok(yv(selected))) s += '<circle cx="' + sx(xs.v(selected)) + '" cy="' + sy(yv(selected)) + '" r="7" fill="none" stroke="var(--text)" stroke-width="2"/>';
    s += '<rect x="' + m.l + '" y="' + m.t + '" width="' + (W - m.l - m.r) + '" height="' + (H - m.t - m.b) + '" fill="transparent" id="sc-hit"/></svg>';
    host.innerHTML = s;
    attachHover(host.querySelector('svg'), idx, i => [sx(xs.v(i)), sy(yv(i))], W,
      i => '<b>' + esc(T[i].n) + '</b><br>' + esc(COUNTIES[T[i].c]) + (T[i].d ? ' · ' + T[i].d : '') + '<br>' + esc(xs.label) + ': ' + esc(xs.fmt(xs.v(i))) + '<br>' + esc(SC_Y[yKey]) + ': ' + esc(ym.fmt(yv(i))));
  }

  function attachHover(svg, idx, pos, W, html) {
    const pts = idx.map(i => [i, ...pos(i)]);
    const nearest = ev => {
      const r = svg.getBoundingClientRect(), k = W / r.width;
      const x = (ev.clientX - r.left) * k, y = (ev.clientY - r.top) * k;
      let best = null, bd = 144 * k;
      for (const p of pts) { const d = (p[1] - x) ** 2 + (p[2] - y) ** 2; if (d < bd) { bd = d; best = p[0]; } }
      return best;
    };
    svg.addEventListener('mousemove', ev => { const i = nearest(ev); if (i === null) hideTip(); else showTip(html(i), ev); });
    svg.addEventListener('mouseleave', hideTip);
    svg.addEventListener('click', ev => { const i = nearest(ev); if (i !== null) selectTract(i, true); });
  }

  function renderLowHigh() {
    const idx = areaIdx(S.area);
    const W = 640, H = 600, m = { l: 56, r: 16, t: 12, b: 44 };
    const lim = Math.min(1, Math.max(0.5, ...idx.map(i => Math.max(C[i].p_low, C[i].p_high))) + 0.05);
    const sx = v => m.l + (W - m.l - m.r) * v / lim, sy = v => m.t + (H - m.t - m.b) * (1 - v / lim);
    const lb = NAT.lowBreaks, hb = NAT.highBreaks;
    const xe = [0, lb[0], lb[1], lim], ye = [0, hb[0], hb[1], lim];
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Low-income share against high-income share for each tract" style="max-width:680px">';
    for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) {
      const xa = Math.max(0, xe[a - 1]), xb = Math.min(lim, xe[a]), ya = Math.max(0, ye[b - 1]), yb = Math.min(lim, ye[b]);
      if (xb > xa && yb > ya) s += '<rect x="' + sx(xa) + '" y="' + sy(yb) + '" width="' + (sx(xb) - sx(xa)) + '" height="' + (sy(ya) - sy(yb)) + '" fill="' + BIV[a + '-' + b] + '" fill-opacity="0.55"/>';
    }
    niceTicks(0, lim).forEach(v => {
      s += '<text x="' + (m.l - 6) + '" y="' + (sy(v) + 3) + '" text-anchor="end">' + pct(v) + '</text><text x="' + sx(v) + '" y="' + (H - m.b + 14) + '" text-anchor="middle">' + pct(v) + '</text>';
    });
    for (let ice = -0.6; ice <= 0.61; ice += 0.2) {
      const xA = Math.max(0, -ice), xB = Math.min(lim, lim - ice);
      if (xB <= xA) continue;
      s += '<line x1="' + sx(xA) + '" y1="' + sy(xA + ice) + '" x2="' + sx(xB) + '" y2="' + sy(xB + ice) + '" stroke="var(--text-2)" stroke-dasharray="4 4" stroke-width="0.8"/>';
      const lx = ice >= 0 ? lim - 0.03 - ice : lim - 0.03, ly = lx + ice;
      if (lx > 0 && ly > 0) s += '<text x="' + sx(lx) + '" y="' + sy(ly) + '" transform="rotate(-45 ' + sx(lx) + ' ' + sy(ly) + ')" text-anchor="end" dy="-3">ICE ' + signed(ice, 1) + '</text>';
    }
    s += '<text x="' + ((m.l + W - m.r) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Households ' + esc(lowTxt()) + '</text>';
    s += '<text transform="rotate(-90)" x="' + (-(m.t + H - m.b) / 2) + '" y="14" text-anchor="middle">Households ' + esc(highTxt()) + '</text>';
    const eb = MBY.entropy.breaks;
    const col = i => S.lh === 'entropy' ? (ok(C[i].entropy) ? SEQ[classOf(C[i].entropy, eb)] : NA_COL) : pointColor(i);
    idx.slice().sort((a, b) => (T[a].f > 0) - (T[b].f > 0)).forEach(i => {
      s += '<circle cx="' + sx(C[i].p_low).toFixed(1) + '" cy="' + sy(C[i].p_high).toFixed(1) + '" r="' + (T[i].f && S.lh === 'focus' ? 3.6 : 2.8) + '" fill="' + col(i) + '" fill-opacity="' + (S.lh === 'focus' && !T[i].f ? 0.45 : 0.9) + '" stroke="var(--surface)" stroke-width="0.6"/>';
    });
    if (selected >= 0) s += '<circle cx="' + sx(C[selected].p_low) + '" cy="' + sy(C[selected].p_high) + '" r="7" fill="none" stroke="var(--text)" stroke-width="2"/>';
    s += '</svg>';
    const host = document.getElementById('lowhigh');
    host.innerHTML = s;
    const lg = document.getElementById('lh-legend');
    if (S.lh === 'entropy') {
      lg.innerHTML = SEQ.map((c, k) => '<span><i style="background:' + c + '"></i>' + (k === 0 ? '< ' + num(eb[0]) : k === 4 ? '≥ ' + num(eb[3]) : num(eb[k - 1]) + '–' + num(eb[k])) + '</span>').join('') + '<span>(M2 income entropy)</span>';
    } else focusLegend(lg);
    attachHover(host.querySelector('svg'), idx, i => [sx(C[i].p_low), sy(C[i].p_high)], W,
      i => '<b>' + esc(T[i].n) + '</b><br>' + esc(COUNTIES[T[i].c]) + (T[i].d ? ' · ' + T[i].d : '') + '<br>Low ' + pct(C[i].p_low) + ' · High ' + pct(C[i].p_high) +
        '<br>ICE ' + signed(C[i].ice_inc) + ' · Entropy ' + num(C[i].entropy) + '<br>M3: ' + esc(BIV_NAMES[C[i].bivar] || 'class ' + C[i].bivar));
  }

  // ------------------------------------------------------------------ table
  const COLS = [
    ['area', 'Area', null, 'Area'],
    ['n', 'Tracts', int], ['hh', 'House­holds', int],
    ['inc_p50', 'Median tract income', usdk, 'Median of tract median incomes'],
    ['p90p10', 'P90/P10 tract income', x => num(x, 1), 'Ratio of the 90th to the 10th percentile of tract median incomes'],
    ['p_low', '% HH low', x => pct(x, 1)], ['p_high', '% HH high', x => pct(x, 1)],
    ['ice', 'M1 ICE', signed, 'Pooled over the area: (high − low) / households'],
    ['ice_race', 'ICE race + income', signed],
    ['ent_area', 'M2 entropy (area)', x => num(x), 'Normalized entropy of the area\'s pooled income groups'],
    ['ent_mean', 'M2 entropy (mean tract)', x => num(x), 'Household-weighted mean of tract entropies'],
    ['h_inc', "Theil's H income", x => num(x, 3)], ['h_race', "Theil's H race", x => num(x, 3)],
    ['mixed', 'HH in mixed tracts', x => pct(x)], ['middle', 'HH in middle-income tracts', x => pct(x)],
    ['conc_low', 'HH in conc. low tracts', x => pct(x)], ['conc_high', 'HH in conc. high tracts', x => pct(x)]
  ];
  let sortCol = null, sortDir = -1, lastRows = [];

  function tableRows() {
    const rows = [];
    const add = (level, area, key, idx) => rows.push(Object.assign({ level, area, key }, summarize(idx)));
    add('County', 'All 8 counties', 'all', areaIdx('all'));
    COUNTIES.forEach((c, k) => add('County', c, 'c' + k, areaIdx('c' + k)));
    add('Focus', 'Northern Manhattan', 'nm', areaIdx('nm'));
    META.focus.nm.forEach(code => { const idx = []; for (let i = 0; i < N; i++) if (T[i].d === code) idx.push(i); if (idx.length) add('CDTA', cdtaLabel(code), null, idx); });
    add('Focus', 'South Bronx', 'sb', areaIdx('sb'));
    META.focus.sb.forEach(code => { const idx = []; for (let i = 0; i < N; i++) if (T[i].d === code) idx.push(i); if (idx.length) add('CDTA', cdtaLabel(code), null, idx); });
    return rows;
  }

  function renderTable() {
    let rows = tableRows();
    lastRows = rows;
    if (sortCol) rows = rows.slice().sort((a, b) => sortCol === 'area' ? sortDir * String(a.area).localeCompare(b.area) : sortDir * ((a[sortCol] ?? -Infinity) - (b[sortCol] ?? -Infinity)));
    const th = COLS.map(([k, lab, , t]) => '<th data-col="' + k + '"' + (sortCol === k ? ' aria-sort="' + (sortDir > 0 ? 'ascending' : 'descending') + '"' : '') + (t ? ' title="' + esc(t) + '"' : '') + '>' + lab + (sortCol === k ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('');
    const tb = rows.map(r => '<tr class="level-' + r.level + (r.key === S.area ? ' sel' : '') + '"' + (r.key ? ' data-area="' + r.key + '" style="cursor:pointer"' : '') + '>' +
      COLS.map(([k, , f]) => '<td>' + (f ? esc(f(r[k])) : esc(r[k])) + '</td>').join('') + '</tr>').join('');
    const tbl = document.getElementById('summary');
    tbl.innerHTML = '<thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody>';
    tbl.querySelectorAll('th').forEach(h => h.onclick = () => { const c = h.dataset.col; if (sortCol === c) sortDir = -sortDir; else { sortCol = c; sortDir = c === 'area' ? 1 : -1; } renderTable(); });
    tbl.querySelectorAll('tr[data-area]').forEach(tr => tr.onclick = () => setArea(tr.dataset.area));
  }

  function downloadCsv() {
    const head = ['level', 'area', 'tracts', 'households', 'median_tract_income', 'p90_p10', 'pct_hh_low', 'pct_hh_high', 'ice_income', 'ice_race_income',
      'entropy_area', 'entropy_mean_tract', 'theil_h_income', 'theil_h_race', 'hh_in_mixed', 'hh_in_middle', 'hh_in_conc_low', 'hh_in_conc_high'];
    const keys = ['level', 'area', 'n', 'hh', 'inc_p50', 'p90p10', 'p_low', 'p_high', 'ice', 'ice_race', 'ent_area', 'ent_mean', 'h_inc', 'h_race', 'mixed', 'middle', 'conc_low', 'conc_high'];
    const q = v => typeof v === 'string' ? '"' + v.replace(/"/g, '""') + '"' : ok(v) ? +v.toFixed(5) : '';
    const settings = '# settings: low < ' + S.low + '; high >= ' + S.high + '; M3 tier +/- ' + S.tier + ' pts; entropy groups ' + S.eg + '; ACS ' + META.acs_span;
    const csv = [settings, head.join(',')].concat(lastRows.map(r => keys.map(k => q(r[k])).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'ses_summary_' + S.low / 1000 + 'k_' + S.high / 1000 + 'k.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------------ methods tab
  function renderMethods() {
    document.getElementById('methods-panel').innerHTML =
      '<p>All values are computed in your browser from ACS ' + META.acs_span + ' 5-year tract counts: household income in 16 brackets (B19001), the same brackets for white non-Hispanic households (B19001H), and Hispanic origin by race (B03002). Changing the method settings recomputes every map, chart and table. The defaults match <code>ses_diversity_maps.Rmd</code>.</p>' +
      '<h3>M1: Index of Concentration at the Extremes</h3><div class="formula">ICE = (households at or above the high cut − households below the low cut) / all households</div>' +
      '<p>From Massey (2001); applied to NYC by Krieger et al., <i>AJPH</i> 2016;106(2):256–263. Range −1 to +1.</p>' +
      '<h3>M2: Income entropy</h3><div class="formula">H_norm = −Σ p_k ln(p_k) / ln(K)</div><p>Shannon (1948); used as an area diversity measure by White (1986) and Reardon &amp; Firebaugh (2002). Range 0 to 1.</p>' +
      '<h3>M3: Low × high bivariate classes</h3><p>Each tract\'s low-income and high-income shares are each placed below, within, or above the US share ± the tier width. The 3 × 3 colors follow Stevens (2015).</p>' +
      '<h3>Theil\'s H (summary table)</h3><div class="formula">H = Σ_i t_i (E − E_i) / (T · E)</div><p>The information theory index of segregation (Theil &amp; Finizza 1971; Reardon &amp; Firebaugh 2002). 0 = every tract mirrors the area; 1 = complete separation.</p>' +
      '<h3>Margins of error</h3><p>MOEs of bracket sums use √(Σ MOE²); MOEs of shares use the ACS handbook\'s proportion formula (Census Bureau 2018, ch. 8). Tracts with a low- or high-income share MOE above ±10 points, or a median-income CV above 30%, get a dashed outline.</p>' +
      '<h3>Caveats</h3><ul><li>Income thresholds are national dollar amounts, not adjusted for New York\'s cost of living.</li><li>Tracts are not neighborhoods, and a mixed tract does not mean residents interact.</li><li>Five-year estimates blend 2020–2024 and can lag rapid change.</li><li>Tracts with fewer than 200 residents or 50 households (parks, airports, Rikers Island) are excluded.</li></ul>' +
      '<p>Full explanations, worked examples and references: <a href="https://github.com/sigmasigmaiota/nyc_ses/blob/main/ses_methods.md" target="_blank" rel="noopener">ses_methods.md</a>.</p>';
  }

  // ------------------------------------------------------------------ controls & wiring
  function fillSelect(sel, opts, value) {
    sel.innerHTML = opts.map(o => o.group !== undefined
      ? '<optgroup label="' + esc(o.group) + '">' + o.items.map(it => '<option value="' + it.v + '">' + esc(it.l) + '</option>').join('') + '</optgroup>'
      : '<option value="' + o.v + '">' + esc(o.l) + '</option>').join('');
    sel.value = value;
  }
  function measureOptions() {
    const groups = [...new Set(MEASURES.map(m => m.group))];
    return groups.map(g => ({ group: g, items: MEASURES.filter(m => m.group === g).map(m => ({ v: m.key, l: m.label })) }));
  }

  function setArea(key) {
    S.area = key;
    document.getElementById('area').value = key;
    selected = -1;
    updateAreaDecor(true);
    renderAll(false);
  }

  function renderAll(recompute) {
    if (recompute) compute();
    restyle();
    document.getElementById('legend-a').innerHTML = legendHtml(S.ma);
    document.getElementById('legend-b').innerHTML = legendHtml(S.mb);
    document.getElementById('us-shares').innerHTML = 'US shares at these cut points: <b>' + pct(NAT.low, 1) + '</b> low-income, <b>' + pct(NAT.high, 1) + '</b> high-income households. The report\'s defaults are under $30k and $150k or more.';
    document.getElementById('tier-val').textContent = S.tier;
    renderExplain();
    renderSnapshot();
    renderDetail();
    renderCharts();
    writeHash();
  }
  function renderCharts() {
    if (S.tab === 'scatter') renderScatter();
    else if (S.tab === 'lowhigh') renderLowHigh();
    else if (S.tab === 'table') renderTable();
  }

  function setLayout(l) {
    S.layout = l;
    document.getElementById('maps').classList.toggle('compare', l === 'compare');
    document.getElementById('card-b').style.display = l === 'compare' ? '' : 'none';
    document.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === l)));
    setTimeout(() => { maps.forEach(m => m.invalidateSize()); if (l === 'compare') maps[1].setView(maps[0].getCenter(), maps[0].getZoom(), { animate: false }); }, 50);
  }

  function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.tabpanel').forEach(p => { p.hidden = p.dataset.panel !== tab; });
    renderCharts();
    writeHash();
  }

  function init() {
    readHash();
    try { const th = localStorage.getItem('ses-theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* storage unavailable */ }

    compute();
    fillSelect(document.getElementById('area'), AREAS.map(a => ({ v: a.key, l: a.label })), S.area);
    fillSelect(document.getElementById('measure-a'), measureOptions(), S.ma);
    fillSelect(document.getElementById('measure-b'), measureOptions(), S.mb);
    fillSelect(document.getElementById('lowcut'), LOW_OPTS.map(v => ({ v, l: kLabel(v) })), S.low);
    fillSelect(document.getElementById('highcut'), HIGH_OPTS.map(v => ({ v, l: kLabel(v) })), S.high);
    fillSelect(document.getElementById('sc-x'), Object.entries(SC_X).map(([v, o]) => ({ v, l: o.label })), S.scx);
    fillSelect(document.getElementById('sc-y'), Object.entries(SC_Y).map(([v, l]) => ({ v, l })), S.scy);
    document.getElementById('egroups').value = S.eg;
    document.getElementById('tier').value = S.tier;
    document.getElementById('flag').checked = S.flag;
    document.getElementById('basemap').checked = S.basemap;
    document.getElementById('lh-color').value = S.lh;
    document.getElementById('subtitle').textContent = 'ACS ' + META.acs_span + ' 5-year estimates · ' + int(N) + ' census tracts in the five boroughs, Nassau, Suffolk and Westchester';
    document.getElementById('footer').innerHTML = 'Data: US Census Bureau, American Community Survey ' + META.acs_span + ' 5-year estimates (B19001, B19001H, B03002, B19013, B19083, C17002, B15003, B25070, B25014); TIGER/Line boundaries; NYC DCP Community District Tabulation Areas. Data file generated ' + esc(META.generated) + ' from <code>ses_diversity_maps.Rmd</code>. Basemap tiles © Esri. Not affiliated with the Census Bureau.';

    makeMap('map-a', 0);
    makeMap('map-b', 1);
    if (D.geo.cdtas) D.geo.cdtas.features.forEach(f => {
      const code = f.properties.cdta4;
      if (+code.slice(2) > 18) return;          // skip parks / joint-interest areas
      cdtaCenters.push({ code, ll: L.geoJSON(f).getBounds().getCenter() });
    });
    setLayout(S.layout);
    renderMethods();
    setTab(S.tab);
    renderAll(false);
    setTimeout(() => updateAreaDecor(true), 60);

    const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
    on('area', 'change', e => setArea(e.target.value));
    on('measure-a', 'change', e => { S.ma = e.target.value; renderAll(false); });
    on('measure-b', 'change', e => { S.mb = e.target.value; renderAll(false); });
    on('preset', 'change', e => {
      if (!e.target.value) return;
      const [a, b] = e.target.value.split('|');
      S.ma = a; S.mb = b;
      document.getElementById('measure-a').value = a; document.getElementById('measure-b').value = b;
      if (S.layout !== 'compare') setLayout('compare');
      e.target.value = '';
      renderAll(false);
    });
    on('lowcut', 'change', e => {
      S.low = +e.target.value;
      if (S.high <= S.low) { S.high = HIGH_OPTS.find(v => v > S.low); document.getElementById('highcut').value = S.high; }
      renderAll(true);
    });
    on('highcut', 'change', e => {
      S.high = +e.target.value;
      if (S.high <= S.low) { S.low = [...LOW_OPTS].reverse().find(v => v < S.high); document.getElementById('lowcut').value = S.low; }
      renderAll(true);
    });
    on('tier', 'input', e => { S.tier = +e.target.value; renderAll(true); });
    on('egroups', 'change', e => { S.eg = e.target.value; renderAll(true); });
    on('flag', 'change', e => { S.flag = e.target.checked; renderAll(false); });
    on('basemap', 'change', e => { S.basemap = e.target.checked; [0, 1].forEach(s => S.basemap ? tileLayers[s].addTo(maps[s]) : tileLayers[s].remove()); writeHash(); });
    on('reset', 'click', () => {
      ['low', 'high', 'tier', 'eg', 'flag'].forEach(k => { S[k] = DEFAULTS[k]; });
      document.getElementById('lowcut').value = S.low; document.getElementById('highcut').value = S.high;
      document.getElementById('tier').value = S.tier; document.getElementById('egroups').value = S.eg; document.getElementById('flag').checked = S.flag;
      renderAll(true);
    });
    on('sc-x', 'change', e => { S.scx = e.target.value; renderScatter(); writeHash(); });
    on('sc-y', 'change', e => { S.scy = e.target.value; renderScatter(); writeHash(); });
    on('lh-color', 'change', e => { S.lh = e.target.value; renderLowHigh(); writeHash(); });
    on('dl-csv', 'click', downloadCsv);
    on('theme-toggle', 'click', () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = nx;
      try { localStorage.setItem('ses-theme', nx); } catch (e) { /* ignore */ }
    });
    document.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => setLayout(b.dataset.layout)));
    document.querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    document.querySelectorAll('[data-tab-link]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); setTab(a.dataset.tabLink); document.getElementById('tab-methods').scrollIntoView({ behavior: 'smooth' }); }));

    // test hook: lets automated checks compare results with the R report
    window.SES_APP = { summarize, areaIdx, compute, selectTract, S, C: () => C, NAT: () => NAT };
  }

  init();
})();
