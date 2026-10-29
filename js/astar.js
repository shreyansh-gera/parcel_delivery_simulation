/* ===========================================================================
   astar.js  -  A* search, run on the SAME road network and cost model as AO*,
   so the two can be compared fairly.

   A* keeps a frontier (open list) and always expands the node with the lowest
       f(n) = g(n) + h(n)
   where g(n) is the distance already driven to reach n and h(n) is the
   heuristic estimate of the distance still to go.  With an admissible h
   (never over-estimates) the route it returns is a shortest one.

   Cost of a route = sum of road lengths (km).
   "explored" = nodes taken off the frontier and checked (the goal included).

   If `rec` is an array, every step is recorded into it for the visualizer.
   Pass null to run the bare algorithm (used for timing).
   =========================================================================== */
(function () {
  const NS = (typeof window !== 'undefined' ? window : global);
  const INF = Infinity, EPS = 1e-12;

  function pathCost(G, p) { let t = 0; for (let i = 0; i < p.length - 1; i++) t += G.cost(p[i], p[i + 1]); return t; }
  function rebuild(par, g) { const p = []; for (let x = g; x !== -1; x = par[x]) p.unshift(x); return p; }

  function search(G, s, goal, H, rec) {
    const N = G.N, par = new Array(N).fill(-2), gs = new Array(N).fill(INF), closed = new Array(N).fill(false);
    const order = [];
    const hOf = n => H(n, goal);
    const keyOf = o => o.g + hOf(o.n);                       // f = g + h
    const open = [{ n: s, from: -1, g: 0 }];
    par[s] = -1; gs[s] = 0;
    let expanded = 0, generated = 1;

    // index of the entry that leaves the frontier next: lowest f, ties -> lower h, then lower junction number
    function pick() {
      let bi = 0, bk = keyOf(open[0]), bh = hOf(open[0].n);
      for (let i = 1; i < open.length; i++) {
        const k = keyOf(open[i]), h = hOf(open[i].n);
        if (k < bk - EPS || (Math.abs(k - bk) <= EPS && (h < bh - EPS || (Math.abs(h - bh) <= EPS && open[i].n < open[bi].n)))) { bi = i; bk = k; bh = h; }
      }
      return bi;
    }

    // ---- recording helpers (only used when rec != null) ----------------
    function frontView() {            // frontier listed in the order nodes will LEAVE it
      const rows = open.map(o => ({ n: o.n, from: o.from, g: o.g, h: hOf(o.n), key: keyOf(o) }));
      rows.sort((a, b) => a.key - b.key || a.h - b.h || a.n - b.n);
      return rows;
    }
    function treeView() {             // [child, parent] pairs of the search tree so far
      const t = [], seen = new Set();
      for (const n of order) if (!seen.has(n) && par[n] >= 0) { seen.add(n); t.push([n, par[n]]); }
      for (const o of open) if (o.from >= 0 && !seen.has(o.n)) { seen.add(o.n); t.push([o.n, o.from]); }
      return t;
    }
    const snap = (phase, extra) => rec.push(Object.assign({ phase, front: frontView(), closed: order.slice(), tree: treeView(), expanded, generated }, extra));

    if (rec) snap('init', {});
    let found = false;
    while (open.length) {
      const idx = pick(), cur = open[idx];
      if (rec) snap('pick', { cur: cur.n, curFrom: cur.from, curG: cur.g });
      open.splice(idx, 1);
      closed[cur.n] = true; order.push(cur.n); expanded++;
      if (cur.n === goal) { found = true; break; }

      const added = [];
      for (const a of G.adj[cur.n]) {
        const t = a.to, ng = cur.g + a.cost;
        if (ng < gs[t] - EPS) {                               // a cheaper way to t than any known so far
          const wasClosed = closed[t], k = open.findIndex(o => o.n === t);
          gs[t] = ng; par[t] = cur.n;
          if (k >= 0) { open[k] = { n: t, from: cur.n, g: ng }; added.push({ to: t, status: 'better', g: ng, h: hOf(t) }); }
          else { open.push({ n: t, from: cur.n, g: ng }); generated++; if (wasClosed) closed[t] = false; added.push({ to: t, status: wasClosed ? 'reopen' : 'new', g: ng, h: hOf(t) }); }
        } else added.push({ to: t, status: 'skip', why: closed[t] ? 'already explored with a cost no worse' : 'a cheaper way is already known' });
      }
      if (rec) snap('expand', { cur: cur.n, curG: cur.g, added });
    }
    const path = found ? rebuild(par, goal) : null, cost = found ? pathCost(G, path) : null;
    if (rec) snap('done', { cur: found ? goal : -1, path, cost, found });
    return { algo: 'astar', name: 'A*', found, path, cost, expanded, generated, frames: rec || null };
  }

  /** Run A* with the chosen heuristic, plus a blind run (h = 0, i.e. Dijkstra) as the ground-truth optimum. */
  NS.AOS.runAStar = function (G, s, g, hname, record) {
    const H = (u, v) => G.heur[hname](u, v);
    return { astar: search(G, s, g, H, record ? [] : null), dijkstra: search(G, s, g, () => 0, null) };
  };
  /** Single bare run (no recording) - what the timer calls. */
  NS.AOS.runSearch = function (G, s, g, hname) { return search(G, s, g, (u, v) => G.heur[hname](u, v), null); };

  /** Average wall-clock time of fn() in milliseconds (runs it repeatedly until ~minMs have passed). */
  NS.AOS.timeIt = function (fn, minMs) {
    minMs = minMs || 25;
    for (let i = 0; i < 5; i++) fn();                          // warm-up
    let reps = 0; const t0 = performance.now(); let el;
    do { for (let i = 0; i < 10; i++) fn(); reps += 10; el = performance.now() - t0; } while (el < minMs && reps < 50000);
    return { ms: el / reps, reps };
  };

  NS.AOS.pathCost = pathCost;
  if (typeof module !== 'undefined') module.exports = NS.AOS;
})();
