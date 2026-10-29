/* ===========================================================================
   aostar.js  -  AO* search on an AND-OR graph of delivery sub-problems
   ---------------------------------------------------------------------------
   PROBLEM REDUCTION MODEL
     P(u,v) = "get the package from u to v"           (an OR node)
     Arcs of P(u,v):
       road arc : u and v share a road -> just drive it          (cost = road length, km)
       AND arc  : choose a waypoint w and solve BOTH P(u,w) AND P(w,v);
                  arc cost = the cost of both children (no extra penalty).
     AO* requires an ACYCLIC graph, so a waypoint is rejected if one of its two
     sub-problems is already an ancestor of P(u,v) (that would close a cycle).
     Only the K most promising waypoints (lowest h(u,w)+h(w,v))
     are generated; arcs whose admissible lower bound already exceeds the
     direct road are pruned (branch-and-bound).

   AO* LOOP
     1. follow the marked (cheapest) arc from the root -> best partial solution graph
     2. pick an unexpanded tip node of that graph
     3. expand it (generate arcs, children get f = h)
     4. revise costs bottom-up:  f(n) = min over arcs [ arcCost + sum f(children) ]
        mark the best arc; n is SOLVED when every child of its marked arc is solved
     repeat until the root is solved (or its cost becomes infinite = no route)
   =========================================================================== */
(function () {
  const NS = (typeof window !== 'undefined' ? window : global);
  const INF = Infinity, EPS = 1e-9;

  function runOnce(G, start, goal, options) {
    const opt = Object.assign({ K: 3, hname: 'hybrid', prune: true, maxIter: 3000, record: true }, options || {});
    const H = G.heur[opt.hname];
    const Hadm = NS.AOS.HEURISTICS[opt.hname].admissible ? H : G.heur.hybrid;   // used only for pruning
    const nodes = new Map(), order = [], frames = [];

    function getP(u, v) {
      const id = 'P' + u + '_' + v;
      let n = nodes.get(id);
      if (!n) {
        const h = H(u, v);
        n = { id, kind: 'P', u, v, h, f: h, solved: false, dead: h === INF, expanded: false, arcs: [], best: -1,
              parents: new Set(), size: G.D[u][v], createdAt: -1, expandedAt: -1, idx: order.length };
        nodes.set(id, n); order.push(n);
      }
      return n;
    }
    function getR(u, v) {
      const id = 'R' + u + '_' + v;
      let n = nodes.get(id);
      if (!n) {
        const c = G.cost(u, v);
        n = { id, kind: 'R', u, v, h: c, f: c, solved: true, dead: false, expanded: true, arcs: [], best: -1,
              parents: new Set(), size: 0, createdAt: -1, expandedAt: -1, idx: order.length };
        nodes.set(id, n); order.push(n);
      }
      return n;
    }

    function trace(root) {                       // current best partial solution graph
      const sol = new Set(), tips = [];
      (function go(n) {
        if (sol.has(n.id)) return;
        sol.add(n.id);
        if (n.kind === 'R') return;
        if (!n.expanded) { if (!n.dead) tips.push(n); return; }
        if (n.best < 0) return;
        for (const cid of n.arcs[n.best].children) go(nodes.get(cid));
      })(root);
      return { sol, tips };
    }

    function expand(n) {
      const { u, v } = n, info = { tip: n.id, arcs: [], pruned: [], skipped: 0 };
      let roadCost = INF;
      const anc = ancestors(n);
      if (G.cost(u, v) !== undefined) {
        const R = getR(u, v); R.parents.add(n.id);
        n.arcs.push({ kind: 'road', cost: 0, children: [R.id], est: R.f });
        roadCost = R.f;
        info.arcs.push({ kind: 'road', est: R.f });
      }
      const cands = [];
      for (let w = 0; w < G.N; w++) {
        if (w === u || w === v || G.comp[w] !== G.comp[u]) continue;
        const ca = nodes.get('P' + u + '_' + w), cb = nodes.get('P' + w + '_' + v);
        if ((ca && (ca === n || anc.has(ca.id))) || (cb && (cb === n || anc.has(cb.id)))) continue;   // would close a cycle
        const a1 = H(u, w), a2 = H(w, v);
        const b1 = Hadm(u, w), b2 = Hadm(w, v);
        if (a1 === INF || a2 === INF || b1 === INF || b2 === INF) continue;
        cands.push({ w, h1: a1, h2: a2, lb: a1 + a2 + G.stop, lbAdm: b1 + b2 + G.stop });
      }
      cands.sort((a, b) => a.lb - b.lb || a.w - b.w);
      let kept = 0;
      for (const c of cands) {
        if (opt.prune && c.lbAdm >= roadCost - EPS) { info.pruned.push(c.w); continue; }
        if (kept >= opt.K) { info.skipped++; continue; }
        kept++;
        const a = getP(u, c.w), b = getP(c.w, v);
        a.parents.add(n.id); b.parents.add(n.id);
        n.arcs.push({ kind: 'and', w: c.w, cost: G.stop, children: [a.id, b.id], est: c.lb });
        info.arcs.push({ kind: 'and', w: c.w, h1: c.h1, h2: c.h2, est: c.lb });
      }
      n.expanded = true;
      if (n.arcs.length === 0) { n.dead = true; n.f = INF; }
      return info;
    }

    function ancestors(n) {
      const seen = new Set(), st = [n];
      while (st.length) { const x = st.pop(); x.parents.forEach(pid => { if (!seen.has(pid)) { seen.add(pid); st.push(nodes.get(pid)); } }); }
      return seen;
    }

    function revise(start) {
      // every node whose cost may change = start + all its ancestors; process children before parents
      const A = ancestors(start); A.add(start.id);
      const topo = [], mark = new Set();
      const dfs = n => {
        if (mark.has(n.id)) return; mark.add(n.id);
        for (const a of n.arcs) for (const cid of a.children) if (A.has(cid)) dfs(nodes.get(cid));
        topo.push(n);
      };
      for (const id of A) dfs(nodes.get(id));
      const changes = [];
      for (const m of topo) {
        if (m.kind === 'R' || !m.expanded) continue;
        let best = -1, bf = INF;
        m.arcs.forEach((a, i) => {
          a.est = a.cost + a.children.reduce((s, cid) => s + nodes.get(cid).f, 0);
          if (a.est < bf - EPS) { bf = a.est; best = i; }
        });
        const solved = best >= 0 && m.arcs[best].children.every(cid => nodes.get(cid).solved);
        const dead = bf === INF;
        const changed = Math.abs((bf === INF ? 1e18 : bf) - (m.f === INF ? 1e18 : m.f)) > EPS || best !== m.best || solved !== m.solved || dead !== m.dead;
        const old = m.f, oldBest = m.best;
        m.f = bf; m.best = best; m.solved = solved; m.dead = dead;
        if (changed) changes.push({ id: m.id, old, nw: bf, best, oldBest, solved });
      }
      return changes;
    }

    function snap(phase, extra) {
      if (!opt.record) return;           // timing runs skip the step recording
      const st = {};
      for (const n of order) if (n.createdAt >= 0 && n.createdAt <= frames.length)
        st[n.id] = [n.f, n.solved ? 1 : 0, n.dead ? 1 : 0, n.expanded ? 1 : 0, n.best, n.arcs.map(a => a.est)];
      frames.push(Object.assign({ phase, nodes: st, expansions: expansions, created: Object.keys(st).length }, extra || {}));
    }

    let expansions = 0;
    const root = getP(start, goal);
    root.createdAt = 0;
    snap('init', { rootId: root.id });
    let iter = 0;
    while (!root.solved && root.f < INF && iter++ < opt.maxIter) {
      const { sol, tips } = trace(root);
      const tip = tips[0]; if (!tip) break;
      if (opt.record) snap('select', { tip: tip.id, sol: [...sol], tips: tips.map(t => t.id) });
      const idxStart = order.length;
      const info = expand(tip);
      expansions++;
      if (opt.record) {
        tip.expandedAt = frames.length;
        for (let i = idxStart; i < order.length; i++) order[i].createdAt = frames.length;
        for (const n of order) if (n.createdAt < 0) n.createdAt = frames.length;   // safety
        snap('expand', { tip: tip.id, info });
      }
      const changes = revise(tip);
      if (opt.record) {
        const { sol: sol2 } = trace(root);
        snap('revise', { tip: tip.id, changes, sol: [...sol2] });
      }
    }
    let routeNodes = null, cost = null;
    if (root.solved) {
      const route = n => {
        if (n.kind === 'R') return [n.u, n.v];
        const a = n.arcs[n.best];
        if (a.kind === 'road') return route(nodes.get(a.children[0]));
        const L = route(nodes.get(a.children[0])), R = route(nodes.get(a.children[1]));
        return L.concat(R.slice(1));
      };
      routeNodes = route(root); cost = root.f;
    }
    if (opt.record) { const { sol: fin } = trace(root); snap('done', { sol: [...fin], route: routeNodes, cost }); }
    // make sure node timelines are consistent for the viewer
    return { frames, nodes, order, root, route: routeNodes, cost, expansions, generated: order.length,
             found: !!routeNodes, options: opt };
  }

  /* With a narrow beam (small K) and a weak heuristic every candidate arc can dead-end, and AO* would wrongly
     report "no route". The map here is connected, so in that case retry with a wider beam (K doubles) and
     remember what happened in `widenedFrom` / `options.K`. */
  NS.AOS.runAOStar = function (G, start, goal, options) {
    const o = Object.assign({ K: 3 }, options || {});
    let K = o.K, r;
    for (;;) {
      r = runOnce(G, start, goal, Object.assign({}, o, { K }));
      if (r.found || K >= G.N) break;
      K = K * 2 >= G.N ? 99 : K * 2;
    }
    r.widenedFrom = K !== o.K ? o.K : null;
    return r;
  };
  if (typeof module !== 'undefined') module.exports = NS.AOS;
})();
