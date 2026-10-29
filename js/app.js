/* ===========================================================================
   app.js  -  user interface: map, step-by-step playback for A* and AO*,
   AND-OR graph viewer (AO*), frontier viewer (A*) and the comparison table.
   =========================================================================== */
(function () {
  'use strict';
  const { NODES, EDGES, HEURISTICS } = AOS;
  const $ = s => document.querySelector(s);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sh = i => NODES[i].short;
  const nm = i => `${NODES[i].name} (${sh(i)})`;
  const fmt = x => x === Infinity ? '∞' : x.toFixed(2);
  const fmtT = ms => ms < 0.1 ? ms.toFixed(4) : ms < 10 ? ms.toFixed(3) : ms.toFixed(1);
  const EPS = 1e-6;
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  const ORDER = ['astar', 'ao'];
  const ALGOS = [
    { id: 'astar', label: 'A*',  blurb: 'lowest f(n) = g(n) + h(n)' },
    { id: 'ao',    label: 'AO*', blurb: 'AND-OR problem reduction' }
  ];
  const COLORS = { astar: 'var(--c-astar)', ao: 'var(--c-ao)' };
  const INFO = {
    astar: { title: 'A* search', rule: 'always expands the frontier node with the lowest f(n) = g(n) + h(n): distance driven so far plus estimated distance to go' }
  };
  const PRESETS = [
    { id: 'p1', label: 'Warehouse → Eastgate', start: 0, goal: 15 },
    { id: 'p2', label: 'Harbor → Airport',     start: 1, goal: 12 },
    { id: 'p3', label: 'Mall → Airport',       start: 7, goal: 12 },
    { id: 'p4', label: 'Station → Stadium',    start: 4, goal: 9 },
    { id: 'p5', label: 'Market → Tech Park',   start: 3, goal: 10 }
  ];

  const S = {
    start: 0, goal: 15, heur: 'hybrid', K: 3, prune: true, labels: true, algo: 'ao', overlay: false, pickNext: 'A',
    frame: 0, playing: false, timer: null, follow: true, speed: 5,
    G: null, run: null, base: null, results: null, times: null, frames: []
  };
  let gEls = null, pos = null, view = { k: 1, x: 0, y: 0 }, mapEls = null, truckAnim = null;
  const resOf = a => S.results[a];
  const algoName = a => ALGOS.find(x => x.id === a).label;

  /* ------------------------------------------------------------ controls */
  function fillSelect(sel, items, val) { sel.innerHTML = ''; items.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }); sel.value = val; }
  function syncControls() {
    fillSelect($('#selA'), NODES.map(n => [n.id, n.name + ' (' + n.short + ')']), S.start);
    fillSelect($('#selB'), NODES.map(n => [n.id, n.name + ' (' + n.short + ')']), S.goal);
    fillSelect($('#selH'), Object.entries(HEURISTICS).map(([k, v]) => [k, v.label]), S.heur);
    $('#rngK').value = S.K; $('#vK').textContent = S.K >= 7 ? 'all' : S.K;
    $('#chkPrune').checked = S.prune; $('#chkTimes').checked = S.labels;
    document.querySelectorAll('#presets button').forEach(b => { const p = PRESETS.find(x => x.id === b.dataset.id); b.classList.toggle('on', p.start === S.start && p.goal === S.goal); });
    document.querySelectorAll('#tabs button').forEach(b => { const on = b.dataset.id === S.algo; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const a = ALGOS.find(x => x.id === S.algo); $('#algoBlurb').textContent = a.blurb;
  }
  function initControls() {
    const pr = $('#presets');
    PRESETS.forEach(p => { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.label; b.dataset.id = p.id; b.onclick = () => { S.start = p.start; S.goal = p.goal; syncControls(); rebuild(); }; pr.appendChild(b); });
    const tb = $('#tabs');
    ALGOS.forEach(a => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.id = a.id; b.textContent = a.label;
      b.style.setProperty('--tabc', COLORS[a.id]); b.onclick = () => selectAlgo(a.id); tb.appendChild(b);
    });
    const changed = () => { syncControls(); rebuild(); };
    $('#selA').onchange = e => { S.start = +e.target.value; if (S.goal === S.start) S.goal = (S.start + 1) % NODES.length; changed(); };
    $('#selB').onchange = e => { S.goal = +e.target.value; if (S.goal === S.start) S.start = (S.goal + 1) % NODES.length; changed(); };
    $('#selH').onchange = e => { S.heur = e.target.value; changed(); };
    $('#rngK').oninput = e => { S.K = +e.target.value; changed(); };
    $('#chkPrune').onchange = e => { S.prune = e.target.checked; changed(); };
    $('#chkTimes').onchange = e => { S.labels = e.target.checked; updateMap(); };
    $('#chkOverlay').onchange = e => setOverlay(e.target.checked);
    $('#chkFollow').onchange = e => { S.follow = e.target.checked; if (S.follow && S.algo === 'ao') followView(); };
    $('#bFit').onclick = () => fitAll();
    $('#bFirst').onclick = () => go(0); $('#bPrev').onclick = () => go(S.frame - 1);
    $('#bNext').onclick = () => go(S.frame + 1); $('#bLast').onclick = () => go(S.frames.length - 1);
    $('#bPlay').onclick = togglePlay;
    $('#scrub').oninput = e => go(+e.target.value);
    $('#rngSpd').oninput = e => { S.speed = +e.target.value; if (S.playing) { stopTimer(); startTimer(); } };
    $('#themeBtn').onclick = () => {
      const d = document.documentElement, nx = d.dataset.theme === 'dark' ? 'light' : 'dark';
      d.dataset.theme = nx; $('#themeBtn').textContent = nx === 'dark' ? 'Light mode' : 'Dark mode';
      try { localStorage.setItem('aos-theme', nx); } catch (e) {}
    };
    try { const t = localStorage.getItem('aos-theme'); if (t) { document.documentElement.dataset.theme = t; $('#themeBtn').textContent = t === 'dark' ? 'Light mode' : 'Dark mode'; } } catch (e) {}
    document.addEventListener('keydown', e => {
      if (/SELECT|INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
      if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') go(S.frame + 1); else if (e.key === 'ArrowLeft') go(S.frame - 1);
      else if (e.key === 'Home') go(0); else if (e.key === 'End') go(S.frames.length - 1);
    });
    window.addEventListener('resize', () => { if (S.follow && S.algo === 'ao') followView(); });
  }

  /* ------------------------------------------------------------ playback */
  function startTimer() { S.timer = setInterval(() => { if (S.frame >= S.frames.length - 1) { togglePlay(); return; } go(S.frame + 1); }, 1500 / S.speed); }
  function stopTimer() { clearInterval(S.timer); S.timer = null; }
  function stopPlay() { if (S.playing) { S.playing = false; stopTimer(); $('#bPlay').textContent = 'Play'; } }
  function togglePlay() {
    if (S.playing) { S.playing = false; stopTimer(); }
    else { if (S.frame >= S.frames.length - 1) go(0); S.playing = true; startTimer(); }
    $('#bPlay').textContent = S.playing ? 'Pause' : 'Play';
  }
  function go(i) {
    const n = S.frames.length;
    S.frame = Math.max(0, Math.min(n - 1, i));
    if (S.overlay) { S.overlay = false; $('#chkOverlay').checked = false; setLegend(); }
    render();
    if (S.frame === n - 1 && resOf(S.algo).found && !S._droveFor) { S._droveFor = true; drive(); }
    if (S.frame < n - 1) { S._droveFor = false; stopDrive(); }
  }
  function setOverlay(v) {
    S.overlay = v; $('#chkOverlay').checked = v;
    if (v) { stopPlay(); stopDrive(); }
    setLegend(); updateMap();
  }
  function setActive(a) {
    S.algo = a; S.frames = a === 'ao' ? S.run.frames : S.base[a].frames; S.frame = 0;
    $('#scrub').max = S.frames.length - 1;
    $('#graphCard').hidden = a !== 'ao'; $('#listCard').hidden = a === 'ao';
  }
  function selectAlgo(a) {
    stopPlay(); stopDrive(); S._droveFor = false; S.overlay = false; $('#chkOverlay').checked = false;
    setActive(a); syncControls(); setLegend(); buildCompare(); render();
    if (a === 'ao') fitAll(true);
  }

  /* ------------------------------------------------------------ rebuild */
  function aoResult() { const r = S.run; return { algo: 'ao', name: 'AO*', found: r.found, path: r.route, cost: r.cost, expanded: r.expansions, generated: r.generated }; }
  function rebuild() {
    stopPlay(); stopDrive(); S._droveFor = false; S.overlay = false; $('#chkOverlay').checked = false;
    S.G = AOS.buildGraph();
    const K = S.K >= 7 ? 99 : S.K;
    S.run = AOS.runAOStar(S.G, S.start, S.goal, { K, hname: S.heur, prune: S.prune, record: true });
    S.base = AOS.runAStar(S.G, S.start, S.goal, S.heur, true);
    S.results = { astar: S.base.astar, ao: aoResult() };
    S.times = null;
    setActive(S.algo);
    buildMap(); buildGraphView(); setLegend(); buildCompare();
    render(); if (S.algo === 'ao') fitAll(true);
    // timing runs a moment later so sliders and menus stay responsive
    clearTimeout(S._tm);
    S._tm = setTimeout(() => { measure(); buildCompare(); }, 40);
  }
  function measure() {
    const G = S.G, K = S.K >= 7 ? 99 : S.K, t = {};
    t.astar = AOS.timeIt(() => AOS.runSearch(G, S.start, S.goal, S.heur), 15);
    t.ao = AOS.timeIt(() => AOS.runAOStar(G, S.start, S.goal, { K, hname: S.heur, prune: S.prune, record: false }), 15);
    S.times = t;
  }

  /* ------------------------------------------------------------ map */
  function buildMap() {
    const svg = $('#mapSvg'); svg.innerHTML = '';
    const roads = el('g', {}, svg), times = el('g', {}, svg), tree = el('g', {}, svg), legs = el('g', {}, svg), over = el('g', {}, svg),
          halo = el('g', {}, svg), wps = el('g', {}, svg), nodes = el('g', {}, svg), vals = el('g', {}, svg), badges = el('g', {}, svg), lms = el('g', {}, svg), tr = el('g', {}, svg);
    mapEls = { times: [], legs, over, halo, wps, vals, nodes: [], lms, badges, roads: [] };
    EDGES.forEach((e, i) => {
      const a = NODES[e[0]], b = NODES[e[1]];
      const r = el('line', { class: 'road', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, roads);
      el('title', {}, r, 'Road ' + AOS.edgeLabel(i) + ', ' + S.G.cost(e[0], e[1]).toFixed(2) + ' km');
      mapEls.roads.push(r);
      mapEls.times.push(el('text', { class: 'rtime', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 7 }, times));
    });
    NODES.forEach((n, i) => {
      const c = el('circle', { class: 'pt', cx: n.x, cy: n.y, r: 9 }, nodes);
      el('title', {}, c, n.name);
      c.addEventListener('click', () => {
        if (S.pickNext === 'A') { S.start = i; S.pickNext = 'B'; if (S.goal === i) S.goal = (i + 1) % NODES.length; }
        else { S.goal = i; S.pickNext = 'A'; if (S.start === i) S.start = (i + 1) % NODES.length; }
        syncControls(); rebuild();
      });
      mapEls.nodes.push(c);
      el('text', { class: 'nm', x: n.x, y: n.y + 26 }, nodes, n.name);
    });
    S.G.landmarks.forEach(l => { const n = NODES[l]; el('path', { class: 'lm', d: `M ${n.x} ${n.y - 15} l 6 6 l -6 6 l -6 -6 z` }, lms); });
    const tk = el('g', { class: 'truck', style: 'display:none' }, tr);
    el('rect', { class: 'body', x: -15, y: -9, width: 20, height: 16, rx: 3 }, tk);
    el('rect', { class: 'cab', x: 5, y: -4, width: 10, height: 11, rx: 3 }, tk);
    el('rect', { class: 'box', x: -12, y: -6, width: 8, height: 8, rx: 1 }, tk);
    el('circle', { cx: -8, cy: 8, r: 3.4 }, tk); el('circle', { cx: 9, cy: 8, r: 3.4 }, tk);
    mapEls.tk = tk; mapEls.tree = tree;
  }

  function setLegend() {
    const L = $('#mapLegend');
    const line = (c, w, dash) => `<svg width="26" height="10"><line x1="1" y1="5" x2="25" y2="5" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/></svg>`;
    const dot = (fill, stroke, ring) => `<svg width="16" height="16"><circle cx="8" cy="8" r="5.5" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/>${ring ? `<circle cx="8" cy="8" r="7.3" fill="none" stroke="var(--tip)" stroke-width="1.6" ${ring === 'dash' ? 'stroke-dasharray="2.5 2"' : ''}/>` : ''}</svg>`;
    if (S.overlay) {
      L.innerHTML = ORDER.map(a => `<span>${line(COLORS[a], 5)}${algoName(a)} · ${resOf(a).found ? resOf(a).cost.toFixed(2) + ' km' : 'no route'}</span>`).join('');
    } else if (S.algo === 'ao') {
      L.innerHTML = `<span>${line('var(--accent)', 6)}solved road leg</span><span>${line('var(--tip)', 4, '3 7')}estimated leg (h)</span>
        <span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--accent)" stroke-width="2.5"/></svg>waypoint</span>
        <span><svg width="14" height="14"><path d="M7 1 l5 6 l-5 6 l-5 -6z" fill="var(--land)"/></svg>landmark (H2, H3)</span>`;
    } else {
      L.innerHTML = `<span>${dot('var(--accent-soft)', 'var(--accent)')}explored</span><span>${dot('var(--panel)', 'var(--ink)', 'dash')}in frontier</span>
        <span>${dot('var(--tip)', 'var(--tip)')}being expanded</span><span>${line('var(--muted)', 2)}search tree</span><span>${line('var(--accent)', 6)}final route</span>
        <span><svg width="14" height="14"><path d="M7 1 l5 6 l-5 6 l-5 -6z" fill="var(--land)"/></svg>landmark (H2, H3)</span>`;
    }
  }

  function legsAt(fr) {
    const legs = [], wps = new Set(), seen = new Set(), run = S.run;
    (function walk(n) {
      if (seen.has(n.id)) return; seen.add(n.id);
      const st = fr.nodes[n.id]; if (!st) return;
      if (n.kind === 'R') { legs.push({ u: n.u, v: n.v, kind: 'road', f: n.f }); return; }
      if (!st[3] || st[4] < 0) { legs.push({ u: n.u, v: n.v, kind: 'est', f: st[0], id: n.id }); return; }
      const a = n.arcs[st[4]]; if (a.kind === 'and') wps.add(a.w);
      a.children.forEach(cid => walk(run.nodes.get(cid)));
    })(run.root);
    return { legs, wps };
  }
  function solFor(i) {
    const fr = S.run.frames;
    for (let k = i; k >= 0; k--) if (fr[k].sol) return fr[k].sol;
    return [S.run.root.id];
  }
  function nodeClass(i, extra) { return 'pt' + (extra ? ' ' + extra : '') + (i === S.start ? ' start' : i === S.goal ? ' goal' : ''); }
  function lineBetween(g, cls, u, v, off) {
    const a = NODES[u], b = NODES[v]; let ox = 0, oy = 0;
    if (off) { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; ox = -dy / L * off; oy = dx / L * off; }
    return el('line', { class: cls, x1: a.x + ox, y1: a.y + oy, x2: b.x + ox, y2: b.y + oy }, g);
  }

  function updateMap() {
    if (!mapEls) return;
    EDGES.forEach((e, i) => { mapEls.times[i].textContent = S.labels ? S.G.cost(e[0], e[1]).toFixed(2) : ''; });
    mapEls.legs.innerHTML = ''; mapEls.tree.innerHTML = ''; mapEls.over.innerHTML = ''; mapEls.halo.innerHTML = ''; mapEls.wps.innerHTML = ''; mapEls.vals.innerHTML = '';
    mapEls.lms.style.display = (S.heur === 'hybrid' || S.heur === 'weighted') && !S.overlay ? '' : 'none';
    if (S.overlay) updateMapOverlay();
    else if (S.algo === 'ao') updateMapAO(); else updateMapSearch();
    mapEls.badges.innerHTML = '';
    [[S.start, 'A'], [S.goal, 'B']].forEach(([i, t]) => el('text', { class: 'badgeAB', x: NODES[i].x, y: NODES[i].y + 4.5 }, mapEls.badges, t));
    mapEls.nodes.forEach((c, i) => c.setAttribute('r', (i === S.start || i === S.goal) ? 12 : 9));
  }

  function updateMapOverlay() {
    ORDER.forEach((a, k) => {
      const r = resOf(a); if (!r.found) return;
      for (let i = 0; i < r.path.length - 1; i++) { const l = lineBetween(mapEls.over, 'ovl', r.path[i], r.path[i + 1], (k - (ORDER.length - 1) / 2) * 4.6); l.setAttribute('stroke', COLORS[a]); }
    });
    mapEls.nodes.forEach((c, i) => c.setAttribute('class', nodeClass(i)));
    $('#mapHint').innerHTML = 'Final route of A* and AO* on the same map. Where the two lines run side by side, they agree on that road.';
  }

  function updateMapAO() {
    const fr = S.frames[S.frame], run = S.run;
    const { legs, wps } = legsAt(fr), g = mapEls.legs;
    const tip = (fr.phase === 'select' || fr.phase === 'expand') ? fr.tip : null;
    legs.forEach(l => {
      const a = NODES[l.u], b = NODES[l.v];
      if (l.kind === 'road') el('line', { class: 'leg-road', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, g);
      else {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const cx = mx - dy / len * 28, cy = my + dx / len * 28;
        el('path', { class: 'leg-est' + (l.id === tip ? ' leg-tip' : ''), d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}` }, g);
        el('text', { class: 'leg-lab', x: (a.x + b.x) / 4 + cx / 2, y: (a.y + b.y) / 4 + cy / 2 + 4 }, g, fmt(l.f));
      }
    });
    wps.forEach(w => el('circle', { class: 'wp', cx: NODES[w].x, cy: NODES[w].y, r: 15 }, mapEls.wps));
    const onRoute = new Set(); legs.forEach(l => { onRoute.add(l.u); onRoute.add(l.v); });
    mapEls.nodes.forEach((c, i) => c.setAttribute('class', nodeClass(i, onRoute.has(i) ? 'onroute' : '')));
    const done = fr.phase === 'done';
    $('#mapHint').innerHTML = done && run.found
      ? `Delivered: <b>${run.route.map(sh).join(' → ')}</b> · <b class="mono">${run.cost.toFixed(2)} km</b>. <button type="button" class="ghost small" id="bDrive">Replay delivery</button>`
      : 'Dashed amber legs are still estimates; solid blue legs are solved. Click a junction to set A, then B.';
    const bd = $('#bDrive'); if (bd) bd.onclick = () => { stopDrive(); drive(); };
  }

  function updateMapSearch() {
    const fr = S.frames[S.frame], r = resOf(S.algo), done = fr.phase === 'done';
    const closedSet = new Set(fr.closed), frontSet = new Set(fr.front.map(x => x.n));
    fr.tree.forEach(([c, p]) => lineBetween(mapEls.tree, 'tree', p, c));
    if (done && fr.found) for (let i = 0; i < fr.path.length - 1; i++) lineBetween(mapEls.legs, 'leg-road', fr.path[i], fr.path[i + 1]);
    frontSet.forEach(n => { if (n !== fr.cur || done) el('circle', { class: 'halo-front', cx: NODES[n].x, cy: NODES[n].y, r: 16 }, mapEls.halo); });
    if (fr.cur >= 0 && !done) el('circle', { class: 'halo-cur', cx: NODES[fr.cur].x, cy: NODES[fr.cur].y, r: 18 }, mapEls.halo);
    mapEls.nodes.forEach((c, i) => c.setAttribute('class', nodeClass(i, (i === fr.cur && !done) ? 'cur' : closedSet.has(i) ? 'closed' : '')));
    fr.front.forEach(row => el('text', { class: 'val', x: NODES[row.n].x, y: NODES[row.n].y - 18 }, mapEls.vals, 'f ' + row.key.toFixed(2)));
    let hint;
    if (done) hint = fr.found ? `Route found: <b>${fr.path.map(sh).join(' → ')}</b> · <b class="mono">${fr.cost.toFixed(2)} km</b> · ${fr.expanded} nodes explored. <button type="button" class="ghost small" id="bDrive">Replay delivery</button>` : 'The frontier ran empty: no route exists.';
    else hint = 'Pale blue = explored, dashed ring = in the frontier, amber = being expanded. Labels show f = g + h. Click a junction to set A, then B.';
    $('#mapHint').innerHTML = hint;
    const bd = $('#bDrive'); if (bd) bd.onclick = () => { stopDrive(); drive(); };
  }

  function stopDrive() { if (truckAnim) cancelAnimationFrame(truckAnim); truckAnim = null; if (mapEls && mapEls.tk) mapEls.tk.style.display = 'none'; }
  function drive() {
    const route = resOf(S.algo).path; if (!route || route.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pts = route.map(i => NODES[i]), seg = []; let tot = 0;
    for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); seg.push(d); tot += d; }
    const dur = Math.min(7000, Math.max(3000, tot * 6)), t0 = performance.now(), tk = mapEls.tk; tk.style.display = '';
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur); let d = p * tot, i = 0;
      while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
      const a = pts[i], b = pts[i + 1], f = seg[i] ? d / seg[i] : 1;
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      tk.setAttribute('transform', `translate(${x} ${y}) ${Math.abs(ang) > 90 ? 'scale(-1 1)' : ''}`);
      if (p < 1) truckAnim = requestAnimationFrame(step); else truckAnim = null;
    })(t0);
  }

  /* ------------------------------------------------------------ AND-OR graph view (AO*) */
  const NW = 86, NH = 42, SLOT = 96, LV = 132;
  function buildGraphView() {
    const vp = $('#vp'); vp.innerHTML = '';
    const run = S.run; pos = new Map(); const seen = new Set(); let cursor = 0;
    const layer = new Map();           // longest path from the root, so every edge points downward
    const layerOf = n => { if (layer.has(n.id)) return layer.get(n.id); let d = 0; n.parents.forEach(pid => { d = Math.max(d, layerOf(run.nodes.get(pid)) + 1); }); layer.set(n.id, d); return d; };
    (function place(n) {
      seen.add(n.id);
      const kids = []; n.arcs.forEach(a => a.children.forEach(c => { if (!kids.includes(c)) kids.push(c); }));
      const own = [];
      kids.forEach(cid => { if (!seen.has(cid)) { place(run.nodes.get(cid)); own.push(cid); } });
      const x = own.length ? (pos.get(own[0]).x + pos.get(own[own.length - 1]).x) / 2 : (cursor++) * SLOT + SLOT / 2;
      pos.set(n.id, { x, y: layerOf(n) * LV + 40 });
    })(run.root);
    const eg = el('g', {}, vp), ng = el('g', {}, vp);
    gEls = { nodes: new Map(), arcs: new Map() };
    run.order.forEach(n => {
      const p = pos.get(n.id); if (!p) return;
      const arcs = [];
      n.arcs.forEach((a, k) => {
        const els = { a, lines: [], j: null, jt: null, lab: null };
        const px = p.x, py = p.y + NH / 2;
        if (a.kind === 'road') {
          const c = pos.get(a.children[0]);
          els.lines.push(el('path', { class: 'edge', d: curve(px, py, c.x, c.y - NH / 2) }, eg));
          els.lab = el('text', { class: 'arcl', x: (px + c.x) / 2 + 14, y: (py + c.y - NH / 2) / 2 }, eg);
        } else {
          const c1 = pos.get(a.children[0]), c2 = pos.get(a.children[1]);
          const jx = (c1.x + c2.x) / 2, jy = p.y + NH / 2 + 38;
          els.lines.push(el('path', { class: 'edge', d: curve(px, py, jx, jy - 8) }, eg));
          a.children.forEach(cid => { const c = pos.get(cid); els.lines.push(el('path', { class: 'edge' + (c.y <= p.y + LV + 1 ? '' : ' cross'), d: curve(jx, jy + 8, c.x, c.y - NH / 2) }, eg)); });
          els.j = el('circle', { class: 'junc', cx: jx, cy: jy, r: 9 }, eg);
          els.jt = el('text', { class: 'jt', x: jx, y: jy + 3.5 }, eg, 'AND');
          els.jt.style.fontSize = '7px';
          els.lab = el('text', { class: 'arcl', x: jx + 30, y: jy + 4 }, eg);
          el('title', {}, els.j, 'AND arc via ' + NODES[a.w].name + ': both halves must be solved');
        }
        arcs.push(els);
      });
      gEls.arcs.set(n.id, arcs);
    });
    run.order.forEach(n => {
      const p = pos.get(n.id); if (!p) return;
      const g = el('g', { class: 'nd ' + n.kind, transform: `translate(${p.x - NW / 2} ${p.y - NH / 2})` }, ng);
      el('rect', { width: NW, height: NH }, g);
      const t1 = el('text', { class: 't1', x: NW / 2, y: 17 }, g), t2 = el('text', { class: 't2', x: NW / 2, y: 33 }, g);
      t1.textContent = n.kind === 'P' ? sh(n.u) + ' → ' + sh(n.v) : 'road ' + sh(n.u) + '–' + sh(n.v);
      el('title', {}, g, n.kind === 'P' ? `Deliver ${NODES[n.u].name} → ${NODES[n.v].name}` : `Drive the road ${NODES[n.u].name} – ${NODES[n.v].name}`);
      gEls.nodes.set(n.id, { g, t2, n });
    });
    $('#graphLegend').innerHTML = `
      <span><svg width="22" height="14"><rect x="1" y="1" width="20" height="12" rx="4" fill="none" stroke="var(--road)" stroke-dasharray="4 2" stroke-width="1.6"/></svg>generated, f = h</span>
      <span><svg width="22" height="14"><rect x="1" y="1" width="20" height="12" rx="4" fill="var(--tip-soft)" stroke="var(--tip)" stroke-width="2.4"/></svg>chosen to expand</span>
      <span><svg width="22" height="14"><rect x="1" y="1" width="20" height="12" rx="4" fill="var(--ok-soft)" stroke="var(--ok)" stroke-width="1.6"/></svg>solved</span>
      <span><svg width="26" height="10"><line x1="1" y1="5" x2="25" y2="5" stroke="var(--accent)" stroke-width="3.4"/></svg>best plan so far</span>
      <span><svg width="18" height="18"><circle cx="9" cy="9" r="8" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.6"/></svg>AND: both halves needed</span>`;
  }
  function curve(x1, y1, x2, y2) { const m = (y1 + y2) / 2; return `M ${x1} ${y1} C ${x1} ${m}, ${x2} ${m}, ${x2} ${y2}`; }

  function updateGraph() {
    const run = S.run, fr = run.frames[S.frame], solSet = new Set(solFor(S.frame));
    const tip = (fr.phase === 'select' || fr.phase === 'expand') ? fr.tip : null;
    const flash = new Set(fr.phase === 'revise' ? fr.changes.map(c => c.id) : []);
    run.order.forEach(n => {
      const e = gEls.nodes.get(n.id); if (!e) return;
      const st = fr.nodes[n.id], arcs = gEls.arcs.get(n.id) || [];
      if (!st) { e.g.classList.add('hide'); arcs.forEach(a => showArc(a, false)); return; }
      const [f, solved, dead, exp, best, est] = st, c = e.g.classList;
      c.remove('hide'); c.toggle('exp', !!exp); c.toggle('unexp', n.kind === 'P' && !exp); c.toggle('solved', !!solved && n.kind === 'P' || n.kind === 'R');
      c.toggle('dead', !!dead); c.toggle('insol', solSet.has(n.id)); c.toggle('tip', n.id === tip); c.toggle('flash', flash.has(n.id));
      if (n.kind === 'R') e.t2.textContent = '✓ ' + fmt(f);
      else e.t2.textContent = dead ? '✗ no route' : exp ? (solved ? '✓ ' : 'f ') + fmt(f) : 'h ' + fmt(f);
      arcs.forEach((a, k) => {
        const vis = !!exp; showArc(a, vis); if (!vis) return;
        const isBest = best === k, inSol = isBest && solSet.has(n.id);
        a.lines.forEach(l => { l.classList.toggle('best', isBest); l.classList.toggle('insol', inSol); });
        if (a.j) { a.j.classList.toggle('best', isBest); a.j.classList.toggle('insol', inSol); }
        a.lab.textContent = est ? fmt(est[k]) : ''; a.lab.classList.toggle('insol', inSol);
      });
    });
  }
  function showArc(a, v) { a.lines.forEach(l => l.classList.toggle('hide', !v)); [a.j, a.jt, a.lab].forEach(x => x && x.classList.toggle('hide', !v)); }

  /* pan / zoom */
  function applyView(animate) { const vp = $('#vp'); vp.style.transition = animate ? '' : 'none'; vp.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; if (!animate) requestAnimationFrame(() => vp.style.transition = ''); }
  function fitBox(ids, animate, maxK) {
    const svg = $('#graphSvg'), W = svg.clientWidth, H = svg.clientHeight;
    if (!W || !H) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ids.forEach(id => { const p = pos.get(id); if (!p) return; x0 = Math.min(x0, p.x - NW / 2); x1 = Math.max(x1, p.x + NW / 2); y0 = Math.min(y0, p.y - NH / 2); y1 = Math.max(y1, p.y + NH / 2 + 40); });
    if (x0 > x1) return;
    const pad = 30, k = Math.max(0.12, Math.min(maxK || 1.1, (W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0)));
    view = { k, x: (W - (x1 - x0) * k) / 2 - x0 * k, y: Math.max(pad / 2, (H - (y1 - y0) * k) / 2) - y0 * k };
    applyView(animate);
  }
  function fitAll(instant) { fitBox(Object.keys(S.run.frames[Math.min(S.frame, S.run.frames.length - 1)].nodes), !instant, 1.1); }
  function followView() {
    const fr = S.run.frames[S.frame], ids = new Set(solFor(S.frame)); if (fr.tip) ids.add(fr.tip);
    fitBox([...ids], true, 1.0);
  }
  function initPanZoom() {
    const svg = $('#graphSvg'); let drag = null;
    svg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; svg.classList.add('drag'); svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => { if (!drag) return; view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; applyView(false); });
    const end = () => { drag = null; svg.classList.remove('drag'); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      const nk = Math.max(0.1, Math.min(2.5, view.k * f)), s = nk / view.k;
      view.x = mx - (mx - view.x) * s; view.y = my - (my - view.y) * s; view.k = nk; applyView(false);
    }, { passive: false });
  }

  /* ------------------------------------------------------------ frontier / explored lists (A*) */
  function updateLists() {
    const fr = S.frames[S.frame];
    $('#listTitle').textContent = 'A*: frontier and explored nodes';
    $('#frontTitle').textContent = 'Frontier: priority queue, lowest f = g + h first';
    $('#listNote').textContent = 'Row 1 is taken next.';
    const touched = new Set((fr.added || []).filter(x => x.status !== 'skip').map(x => x.to));
    const head = '<thead><tr><th>#</th><th>Node</th><th>Came from</th><th class="num">g (km)</th><th class="num">h</th><th class="num key">f = g + h</th></tr></thead>';
    const rows = fr.front.map((r, i) => {
      const chosen = fr.phase === 'pick' && r.n === fr.cur;
      const cls = (chosen ? 'chosen ' : '') + (touched.has(r.n) ? 'fresh' : '');
      return `<tr class="${cls}"><td>${chosen ? '→' : i + 1}</td><td><b>${sh(r.n)}</b></td><td>${r.from >= 0 ? sh(r.from) : 'start'}</td><td class="num">${fmt(r.g)}</td><td class="num">${fmt(r.h)}</td><td class="num key">${fmt(r.key)}</td></tr>`;
    }).join('');
    $('#frontTable').innerHTML = head + '<tbody>' + (rows || '<tr><td colspan="6" class="empty">(empty)</td></tr>') + '</tbody>';
    $('#closedList').innerHTML = fr.closed.length ? fr.closed.map((n, i) => `<span class="chip${n === fr.cur && fr.phase !== 'done' ? ' tip' : ''}">${i + 1} · ${sh(n)}</span>`).join(' ') : '<span class="note">nothing explored yet</span>';
  }

  /* ------------------------------------------------------------ narration */
  const chip = i => `<span class="chip">${sh(i)}</span>`;
  const lab = id => { const n = S.run.nodes.get(id); return n.kind === 'P' ? `<span class="chip">${sh(n.u)}→${sh(n.v)}</span>` : `<span class="chip">road ${sh(n.u)}–${sh(n.v)}</span>`; };
  function guarantee() {
    return HEURISTICS[S.heur].admissible ? 'With this heuristic h never over-estimates, so the route A* returns is a shortest one.'
      : 'This heuristic over-estimates, so A* is no longer guaranteed to return the shortest route.';
  }
  function narrate() { S.algo === 'ao' ? narrateAO() : narrateSearch(); }

  function narrateSearch() {
    const fr = S.frames[S.frame], I = INFO.astar, ref = S.base.dijkstra.cost;
    let h = '';
    if (fr.phase === 'init') {
      h = `<h3>Starting point</h3>
      <p>The frontier holds only the start junction, ${nm(S.start)}. The goal is ${nm(S.goal)}.</p>
      <p><b>${I.title}</b> ${I.rule}.</p>
      <p>Each round has two steps: <b>Pick</b> the next node from the frontier, then <b>Expand</b> it by looking at every road leaving it. Press ▶ or Play.</p>`;
    } else if (fr.phase === 'pick') {
      const top = fr.front.slice(0, 5);
      h = `<h3>Pick ${chip(fr.cur)}</h3><p>Lowest f = g + h in the frontier:</p><ul>${top.map((r, i) => `<li${i === 0 ? ' class="pk"' : ''}>${sh(r.n)}: <span class="f">${fmt(r.g)} + ${fmt(r.h)} = ${fmt(r.key)}</span>${i === 0 ? ' ← lowest, picked' : ''}</li>`).join('')}</ul>${fr.front.length > 5 ? `<p class="note">…and ${fr.front.length - 5} more in the frontier.</p>` : ''}`;
      h += fr.curFrom >= 0 ? `<p>It was reached from ${chip(fr.curFrom)}; distance driven so far <code>g = ${fmt(fr.curG)} km</code>.</p>` : '<p>This is the start junction.</p>';
      if (fr.cur === S.goal) h += `<p><b>This is the goal B.</b> The search stops and the route is read back through the “came from” links.</p>`;
    } else if (fr.phase === 'expand') {
      h = `<h3>Expand ${chip(fr.cur)}</h3><p>Roads leaving ${nm(fr.cur)}:</p><ul>` + fr.added.map(x => {
        const to = `<b>${sh(x.to)}</b>`;
        if (x.status === 'skip') return `<li>${to}: skipped, ${x.why}</li>`;
        if (x.status === 'better') return `<li>${to}: found a <b>cheaper</b> way (<span class="f">g = ${fmt(x.g)}</span>), frontier entry updated</li>`;
        if (x.status === 'reopen') return `<li>${to}: cheaper way to an explored node (<span class="f">g = ${fmt(x.g)}</span>), put back in the frontier</li>`;
        return `<li>${to}: added to the frontier (<span class="f">g = ${fmt(x.g)}, h = ${fmt(x.h)}</span>)</li>`;
      }).join('') + '</ul>';
      h += `<p class="note">${fr.expanded} node${fr.expanded > 1 ? 's' : ''} explored so far.</p>`;
    } else if (fr.found) {
      const longer = fr.cost - ref;
      h = `<h3>Route found</h3><p><b>Route:</b> ${fr.path.map(chip).join(' → ')}</p>
      <p>Total distance <code>${fr.cost.toFixed(2)} km</code> over ${fr.path.length - 1} roads, after exploring <code>${fr.expanded}</code> nodes.</p>
      <p>${longer < EPS ? '<b>This is a shortest route.</b>' : `<b>Not the shortest:</b> the best possible route is ${ref.toFixed(2)} km, so this one is ${longer.toFixed(2)} km (${(longer / ref * 100).toFixed(0)}%) longer.`} ${guarantee()}</p>`;
    } else h = '<h3>No route</h3><p>The frontier became empty without reaching B.</p>';
    $('#narr').innerHTML = h;
  }

  function narrateAO() {
    const run = S.run, fr = run.frames[S.frame], root = run.root, n = fr.tip ? run.nodes.get(fr.tip) : null;
    const rootF = fr.nodes[root.id][0];
    let h = '';
    if (fr.phase === 'init') {
      h = `<h3>Starting point</h3>
      <p>The graph holds one node, the root problem ${lab(root.id)}: <i>deliver the package from ${nm(S.start)} to ${nm(S.goal)}</i>.</p>
      <p>It has not been expanded, so its cost is just the heuristic guess: <code>f = h = ${fmt(rootF)} km</code>.</p>
      ${run.widenedFrom ? `<p><b>Note:</b> with K = ${run.widenedFrom} and this heuristic every arc dead-ended, so AO* automatically retried with K = ${run.options.K >= 16 ? 'all' : run.options.K}. The steps below are that successful run.</p>` : ''}
      <p>AO* repeats three moves: <b>select</b> the cheapest-looking plan and one of its unfinished pieces, <b>expand</b> that piece into arcs, then <b>revise</b> the costs back up to the root. Press ▶ or Play.</p>`;
    } else if (fr.phase === 'select') {
      const { legs } = legsAt(fr);
      h = `<h3>Select an unfinished piece of the best plan</h3>
      <p>Following the cheapest arc from the root gives the current best plan, estimated at <code>${fmt(rootF)} km</code>. Its pieces:</p>
      <ul>${legs.map(l => `<li>${sh(l.u)} → ${sh(l.v)}: ${l.kind === 'road' ? `<b>solved road</b>, ${fmt(l.f)} km` : `<b>unfinished</b>, estimate ${fmt(l.f)} km` + (l.id === fr.tip ? ' ← expand this one' : '')}</li>`).join('')}</ul>
      <p>Only pieces inside the best plan are ever expanded, so AO* never spends effort on routes that already look worse.</p>`;
    } else if (fr.phase === 'expand') {
      const info = fr.info;
      h = `<h3>Expand ${lab(n.id)}</h3><p>Ways to get from ${nm(n.u)} to ${nm(n.v)}:</p><ul>` +
        info.arcs.map(a => a.kind === 'road'
          ? `<li><b>Drive the road</b> directly: <code>${fmt(a.est)} km</code> (exact)</li>`
          : `<li><b>AND</b> via ${nm(a.w)}: solve ${sh(n.u)}→${sh(a.w)} <b>and</b> ${sh(a.w)}→${sh(n.v)}<br><span class="f">h ${fmt(a.h1)} + h ${fmt(a.h2)} = ${fmt(a.est)}</span></li>`).join('') + '</ul>';
      if (!info.arcs.length) h += `<p><b>No usable arc.</b> No road joins them and no waypoint leads anywhere, so this node is marked as having no route.</p>`;
      if (info.pruned.length) h += `<p>Pruned ${info.pruned.length} waypoint arc${info.pruned.length > 1 ? 's' : ''} (${info.pruned.map(sh).join(', ')}): even their optimistic lower bound is no better than the direct road.</p>`;
      if (info.skipped) h += `<p>Skipped ${info.skipped} weaker waypoint${info.skipped > 1 ? 's' : ''} because only the best K = ${S.K >= 7 ? 'all' : S.K} are generated.</p>`;
    } else if (fr.phase === 'revise') {
      const ch = fr.changes.filter(c => c.id.startsWith('P'));
      h = `<h3>Revise costs back up the graph</h3><p>Rule: <code>f(node) = min over arcs [ arc cost + Σ f(children) ]</code>. A node is <b>solved</b> when every child of its cheapest arc is solved.</p><ul>` +
        ch.slice(0, 8).map(c => { const nn = run.nodes.get(c.id); return `<li>${lab(c.id)} <span class="f">${fmt(c.old)} → ${fmt(c.nw)}</span>${c.solved ? ' <b>solved ✓</b>' : ''}${nn.id === root.id ? ' (root)' : ''}</li>`; }).join('') + '</ul>' +
        (ch.length > 8 ? `<p>…and ${ch.length - 8} more.</p>` : '') +
        `<p>Root estimate is now <code>${fmt(rootF)} km</code>${fr.nodes[root.id][1] ? ' and it is <b>solved</b>.' : '. With an admissible h this number never goes down; it only rises toward the true optimum.'}</p>`;
    } else {
      const ref = S.base.dijkstra.cost;
      h = run.found
        ? `<h3>Root solved: plan found</h3><p>The best plan contains no unfinished pieces. Total distance <code>${run.cost.toFixed(2)} km</code>.</p>
           <p><b>Route:</b> ${run.route.map(chip).join(' → ')}</p>
           <p>AO* made ${run.expansions} expansions and generated ${run.generated} nodes. Because every unfinished piece was scored with an admissible h, no other plan in the graph can be cheaper.</p>${run.cost > ref + EPS ? `<p><b>Note:</b> the true shortest route is ${ref.toFixed(2)} km. AO* is optimal only inside the graph it generated. Here the limit K = ${S.K} (or a blind or over-estimating heuristic) kept the better waypoint out. Raise K to “all” or switch to H2 to close the gap.</p>` : ''}`
        : `<h3>No route</h3><p>Every arc from the root ended in a node with no route, so its cost became ∞ and AO* stopped.</p>`;
    }
    $('#narr').innerHTML = h;
  }

  /* ------------------------------------------------------------ comparison */
  function buildCompare() {
    const ref = S.base.dijkstra.found ? S.base.dijkstra.cost : null, T = S.times;
    const rows = ORDER.map(a => ({ a, r: resOf(a), t: T ? T[a].ms : null }));
    const found = rows.filter(x => x.r.found);
    const minC = Math.min(...found.map(x => x.r.cost)), minE = Math.min(...found.map(x => x.r.expanded));
    const minT = T ? Math.min(...found.map(x => x.t)) : null;
    const maxC = Math.max(...found.map(x => x.r.cost), 1e-9), maxE = Math.max(...found.map(x => x.r.expanded), 1), maxT = T ? Math.max(...found.map(x => x.t), 1e-9) : 1;
    $('#cmpNote').textContent = `${nm(S.start)} → ${nm(S.goal)}. Heuristic for A* and AO*: ${HEURISTICS[S.heur].label}. Click a row to watch that algorithm.`;
    const tag = r => !r.found ? '<span class="tag bad">no route</span>' : ref === null ? '' :
      r.cost <= ref + EPS ? '<span class="tag ok">shortest</span>' : `<span class="tag mid">+${((r.cost / ref - 1) * 100).toFixed(0)}% longer</span>`;
    const num = (v, mx, best, txt) => `<td class="num${best ? ' best' : ''}">${txt}<div class="bar" style="width:${Math.max(3, v / mx * 100)}%"></div></td>`;
    $('#cmpTable').innerHTML = `<thead><tr><th>Algorithm</th><th>Path found</th><th class="num">Total cost (km)</th><th class="num">Nodes explored</th><th class="num">Time (ms)</th><th>Result</th></tr></thead><tbody>` +
      rows.map(({ a, r, t }) => `<tr class="pickrow${a === S.algo ? ' me' : ''}" data-a="${a}" tabindex="0" title="Watch ${algoName(a)} step by step">
        <td><span class="dotc" style="background:${COLORS[a]}"></span><b>${algoName(a)}</b></td>
        <td class="route">${r.found ? r.path.map(sh).join(' → ') + `<div class="hops">${r.path.length - 1} roads</div>` : 'none'}</td>
        ${r.found ? num(r.cost, maxC, Math.abs(r.cost - minC) < EPS, r.cost.toFixed(2)) : '<td class="num">—</td>'}
        ${r.found ? num(r.expanded, maxE, r.expanded === minE, r.expanded) : '<td class="num">—</td>'}
        ${t === null ? '<td class="num">…</td>' : num(t, maxT, Math.abs(t - minT) < 1e-12, fmtT(t))}
        <td>${tag(r)}</td></tr>`).join('') + '</tbody>';
    $('#cmpTable').querySelectorAll('tr.pickrow').forEach(tr => { tr.onclick = () => selectAlgo(tr.dataset.a); tr.onkeydown = e => { if (e.key === 'Enter') selectAlgo(tr.dataset.a); }; });
    $('#cmpFoot').innerHTML = `<b>Nodes explored</b> = nodes taken off the frontier and checked (the goal included). For AO* it counts sub-problems expanded, which are not the same thing as map junctions, so compare it as a trend. <b>Time</b> = average of ${T ? T.astar.reps + '+' : 'many'} repeated runs of the search alone in this browser (no animation recording); it depends on your computer, so look at the ratios rather than the absolute numbers. Green = best in the column.`;
    const r = resOf(S.algo);
    $('#kpis').innerHTML = `<div class="kpi"><b>${r.found ? r.cost.toFixed(2) : '—'}</b><span>km, ${algoName(S.algo)} route</span></div>
      <div class="kpi"><b>${r.found ? r.path.length - 1 : '—'}</b><span>roads driven</span></div>
      <div class="kpi"><b>${r.expanded}</b><span>nodes explored</span></div>
      <div class="kpi"><b>${T ? fmtT(T[S.algo].ms) : '…'}</b><span>ms average run time</span></div>`;
    // verdict
    const best0 = ref === null ? minC : ref, ra = resOf('astar'), rao = resOf('ao');
    let v = `<p><b>Shortest route:</b> ${best0.toFixed(2)} km. ` + found.map(x => `${algoName(x.a)} ${x.r.cost <= best0 + EPS ? 'found it' : '+' + ((x.r.cost / best0 - 1) * 100).toFixed(0) + '% longer'}`).join('; ') + '.</p>';
    v += `<p><b>Work done:</b> A* explored ${ra.expanded} junctions; AO* expanded ${rao.expanded} sub-problems.` + (T ? ` Run time: A* ${fmtT(T.astar.ms)} ms, AO* ${fmtT(T.ao.ms)} ms${T.ao.ms > T.astar.ms ? ` (AO* is about ${(T.ao.ms / T.astar.ms).toFixed(0)}× slower)` : ''}.` : '') + ' The two counts are not the same unit, so compare them as a trend.</p>';
    v += `<p><b>Why they differ:</b> A* adds g (distance driven) and h (estimated distance to go) and walks the map junction by junction, so with an admissible h it is optimal and focused. AO* reaches the same kind of answer by splitting the delivery into sub-problems joined by AND arcs and revising costs back up the graph. That extra bookkeeping pays off when a plan is made of sub-tasks that must <i>all</i> be done, which a plain A→B road trip is not.</p>`;
    $('#verdict').innerHTML = v;
  }

  /* ------------------------------------------------------------ render */
  function render() {
    const fr = S.frames[S.frame], n = S.frames.length;
    $('#scrub').value = S.frame;
    const names = { init: 'Start', select: 'Select', pick: 'Pick', expand: 'Expand', revise: 'Revise', done: 'Done' };
    const ph = $('#phase'); ph.textContent = names[fr.phase]; ph.className = 'badge ' + fr.phase;
    $('#stepNo').textContent = `step ${S.frame} / ${n - 1}`;
    $('#bPrev').disabled = $('#bFirst').disabled = S.frame === 0; $('#bNext').disabled = $('#bLast').disabled = S.frame === n - 1;
    updateMap(); narrate();
    if (S.algo === 'ao') { updateGraph(); if (S.follow && S.frame > 0) followView(); else if (S.frame === 0) fitAll(); }
    else updateLists();
    document.querySelectorAll('#cmpTable tr.pickrow').forEach(tr => tr.classList.toggle('me', tr.dataset.a === S.algo));
  }

  initControls(); initPanZoom();
  syncControls(); rebuild();
  window.AOS_APP = S;
})();
