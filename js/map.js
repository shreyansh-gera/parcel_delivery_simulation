/* ===========================================================================
   map.js  -  the city: locations, roads and graph construction
   ---------------------------------------------------------------------------
   Coordinates are SVG units (1000 x 620).  100 units = 1 km.
   Cost of a road = its LENGTH in km  =  straight-line distance x winding factor
   (a winding factor of 1 is a straight road; 1.3 is a road that curves a lot).
   =========================================================================== */
(function () {
  const NS = (typeof window !== 'undefined' ? window : global);
  NS.AOS = NS.AOS || {};

  const NODES = [
    { id: 0,  name: 'Central Warehouse', short: 'WH', x: 70,  y: 120 },
    { id: 1,  name: 'Harbor',            short: 'HB', x: 80,  y: 430 },
    { id: 2,  name: 'Old Town',          short: 'OT', x: 220, y: 250 },
    { id: 3,  name: 'Market',            short: 'MK', x: 250, y: 100 },
    { id: 4,  name: 'Station',           short: 'ST', x: 230, y: 460 },
    { id: 5,  name: 'University',        short: 'UN', x: 390, y: 170 },
    { id: 6,  name: 'Hospital',          short: 'HP', x: 400, y: 340 },
    { id: 7,  name: 'Mall',              short: 'ML', x: 380, y: 540 },
    { id: 8,  name: 'Downtown',          short: 'DT', x: 540, y: 260 },
    { id: 9,  name: 'Stadium',           short: 'SD', x: 560, y: 100 },
    { id: 10, name: 'Tech Park',         short: 'TP', x: 650, y: 400 },
    { id: 11, name: 'Garden District',   short: 'GD', x: 560, y: 520 },
    { id: 12, name: 'Airport',           short: 'AP', x: 900, y: 80  },
    { id: 13, name: 'Suburb East',       short: 'SE', x: 880, y: 300 },
    { id: 14, name: 'City Park',         short: 'CP', x: 740, y: 200 },
    { id: 15, name: 'Eastgate Customer', short: 'EG', x: 860, y: 520 }
  ];

  // [from, to, winding factor (optional, default 1)]
  const EDGES = [
    [0, 3], [0, 2, 1.15], [0, 1, 1.1], [1, 4], [1, 2, 1.3],
    [2, 3, 1.2], [2, 5], [2, 6, 1.25], [2, 4, 1.1], [3, 5],
    [4, 6], [4, 7], [5, 6, 1.2], [6, 7],
    [3, 9, 1.1], [6, 8, 1.15], [7, 11],
    [8, 9], [8, 14], [8, 10, 1.3], [9, 14], [9, 12],
    [12, 14], [12, 13, 1.1], [13, 14], [13, 15], [10, 11],
    [10, 15], [10, 14, 1.2], [11, 15], [8, 11, 1.25], [10, 13]
  ];

  const D = NODES.map(a => NODES.map(b => Math.hypot(a.x - b.x, a.y - b.y)));  // pixel distances

  function edgeLabel(i) { const e = EDGES[i]; return NODES[e[0]].short + '–' + NODES[e[1]].short; }

  /** Build the road graph (undirected, every road usable). */
  function buildGraph() {
    const N = NODES.length, adj = Array.from({ length: N }, () => []), cmap = new Map();
    let cmin = Infinity;
    EDGES.forEach((e, i) => {
      const [u, v, f] = e;
      const c = (D[u][v] / 100) * (f || 1);
      adj[u].push({ to: v, cost: c, e: i }); adj[v].push({ to: u, cost: c, e: i });
      cmap.set(u * N + v, c); cmap.set(v * N + u, c);
      cmin = Math.min(cmin, c / D[u][v]);
    });
    const G = { N, adj, D, stop: 0, cmin, cost: (u, v) => cmap.get(u * N + v) };   // undefined => no road
    G.comp = new Array(N).fill(0);   // the whole map is one connected piece
    NS.AOS.makeHeuristics(G);
    return G;
  }

  /** Dijkstra on road lengths - used for the landmark heuristic */
  function dijkstra(G, s) {
    const dist = new Array(G.N).fill(Infinity), done = new Array(G.N).fill(false);
    dist[s] = 0;
    for (let k = 0; k < G.N; k++) {
      let u = -1; for (let i = 0; i < G.N; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done[u] = true;
      for (const a of G.adj[u]) if (dist[u] + a.cost < dist[a.to]) dist[a.to] = dist[u] + a.cost;
    }
    return dist;
  }

  NS.AOS.NODES = NODES; NS.AOS.EDGES = EDGES; NS.AOS.D = D;
  NS.AOS.buildGraph = buildGraph; NS.AOS.dijkstra = dijkstra; NS.AOS.edgeLabel = edgeLabel;
  if (typeof module !== 'undefined') module.exports = NS.AOS;
})();
