/* ===========================================================================
   heuristics.js  -  our own heuristic functions h(u, v)
   ---------------------------------------------------------------------------
   h(u,v) estimates the cheapest road distance (km) to deliver a package u -> v.

   zero      h = 0                              blind baseline (uniform-cost)
   euclid    H1: straight-line distance in km (never longer than any road)
   hybrid    H2 (ours): max( H1 , ALT landmark bound ).  Admissible + tighter.
   weighted  H3: 1.6 x H2.  Over-estimates on purpose: faster, not optimal.
   =========================================================================== */
(function () {
  const NS = (typeof window !== 'undefined' ? window : global);
  const INF = Infinity;

  NS.AOS.HEURISTICS = {
    zero:     { label: 'H0 · none (h = 0, blind search)',                 admissible: true },
    euclid:   { label: 'H1 · straight-line distance (km)', admissible: true },
    hybrid:   { label: 'H2 · hybrid: landmarks + straight-line (ours)', admissible: true },
    weighted: { label: 'H3 · H2 × 1.6 (inadmissible, greedy-leaning)',    admissible: false }
  };

  NS.AOS.makeHeuristics = function (G) {
    const { D, N } = G;
    // --- pick 3 landmarks by farthest-point selection on road cost (ALT) -----
    const lm = [];
    let seed = 0;
    for (let i = 0; i < N; i++) if (G.adj[i].length) { seed = i; break; }
    let d0 = NS.AOS.dijkstra(G, seed);
    let far = seed;
    for (let i = 0; i < N; i++) if (d0[i] < INF && d0[i] > d0[far]) far = i;
    lm.push(far);
    const dl = [NS.AOS.dijkstra(G, far)];
    for (let k = 1; k < 3; k++) {
      let best = -1, bs = -1;
      for (let i = 0; i < N; i++) {
        const m = Math.min(...dl.map(d => d[i]));
        if (m < INF && m > bs) { bs = m; best = i; }
      }
      if (best < 0 || lm.includes(best)) break;
      lm.push(best); dl.push(NS.AOS.dijkstra(G, best));
    }
    G.landmarks = lm; G.landDist = dl;

    const adjacent = (u, v) => G.cost(u, v) !== undefined;
    const hEuclid = (u, v) => u === v ? 0 : D[u][v] * G.cmin;
    const hLand = (u, v) => {
      let m = 0;
      for (const d of dl) {
        const a = d[u], b = d[v];
        if (a === INF && b === INF) continue;
        if (a === INF || b === INF) return INF;           // different components
        m = Math.max(m, Math.abs(a - b));                  // triangle inequality
      }
      return m;
    };
    const hybrid = (u, v) => {
      if (u === v) return 0;
      if (G.comp[u] !== G.comp[v]) return INF;
      return Math.max(hEuclid(u, v), hLand(u, v)) + (adjacent(u, v) ? 0 : G.stop);
    };
    G.heur = {
      zero: () => 0,
      euclid: (u, v) => (u !== v && G.comp[u] !== G.comp[v]) ? INF : hEuclid(u, v),
      hybrid,
      weighted: (u, v) => { const h = hybrid(u, v); return h === INF ? INF : h * 1.6; }
    };
  };
  if (typeof module !== 'undefined') module.exports = NS.AOS;
})();
