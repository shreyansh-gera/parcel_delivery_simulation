// Headless tests:  node test/run_tests.js
require('../js/map.js'); require('../js/heuristics.js'); require('../js/aostar.js'); require('../js/astar.js');
const A = global.AOS, G = A.buildGraph();
const short = p => p ? p.map(i => A.NODES[i].short).join('-') : '-';
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const same = (a, b) => Math.abs(a - b) < 1e-6;

let aoTot = 0, aoNarrowOk = 0, aoNarrowTot = 0, pairs = 0, zeroOk = 0, zeroTot = 0;
for (let s = 0; s < G.N; s++) for (let g = 0; g < G.N; g++) {
  if (s === g) continue; pairs++;
  const b = A.runAStar(G, s, g, 'euclid', false), ref = b.dijkstra, r = b.astar;
  const tag = A.NODES[s].short + '>' + A.NODES[g].short;
  // A* must return a real chain of roads from s to g, with the cost it reports
  check(r.found, 'A* found no route ' + tag);
  check(r.path[0] === s && r.path[r.path.length - 1] === g, 'A* bad endpoints ' + tag);
  check(r.path.every((n, i) => i === 0 || G.cost(r.path[i - 1], n) !== undefined), 'A* uses a missing road ' + tag);
  check(same(r.cost, A.pathCost(G, r.path)), 'A* cost mismatch ' + tag);
  check(r.cost >= ref.cost - 1e-9, 'A* beat the optimum?! ' + tag);
  for (const h of ['zero', 'euclid', 'hybrid']) check(same(A.runAStar(G, s, g, h, false).astar.cost, ref.cost), 'A* not optimal with ' + h + ' ' + tag);
  // recording must not change the answer
  const rec = A.runAStar(G, s, g, 'euclid', true).astar;
  check(same(rec.cost, r.cost) && rec.expanded === r.expanded, 'recording changed A* ' + tag);
  const f = rec.frames; check(f[0].phase === 'init' && f[f.length - 1].phase === 'done' && f.length === 2 + 2 * rec.expanded - 1, 'frame count ' + tag);
  // AO*: with K = all and an informative admissible heuristic it must match Dijkstra.
  for (const h of ['euclid', 'hybrid']) {
    const a = A.runAOStar(G, s, g, { K: 99, hname: h, record: false });
    aoTot++; check(a.found && same(a.cost, ref.cost), 'AO* K=all ' + h + ' ' + tag + ' ' + (a.cost && a.cost.toFixed(3)) + ' vs ' + ref.cost.toFixed(3));
    const rr = A.runAOStar(G, s, g, { K: 99, hname: h, record: true }); check(same(rr.cost, a.cost) && rr.expansions === a.expansions, 'AO* recording changed result ' + tag);
  }
  // Default setting (H2, K = 3) and the blind heuristic H0 are reported, not asserted: AO* is only optimal
  // inside the graph it generates, and H0 gives it nothing to rank waypoints with.
  const n3 = A.runAOStar(G, s, g, { K: 3, hname: 'hybrid', record: false });
  aoNarrowTot++; check(n3.found, 'AO* K=3 found no route ' + tag); if (n3.found && same(n3.cost, ref.cost)) aoNarrowOk++;
  const z = A.runAOStar(G, s, g, { K: 99, hname: 'zero', record: false });
  check(z.found, 'AO* H0 found no route ' + tag); zeroTot++; if (same(z.cost, ref.cost)) zeroOk++;
  const z3 = A.runAOStar(G, s, g, { K: 3, hname: 'zero', record: false });
  check(z3.found, 'AO* H0 K=3 should widen and still find a route ' + tag);
}
console.log(`${pairs} start/goal pairs: A* always returns a valid road chain and is optimal with H0, H1 and H2.`);
console.log(`AO* with K = all matches Dijkstra on ${aoTot} / ${aoTot} runs (H1 and H2).`);
console.log(`AO* with the app default (H2, K = 3) is optimal on ${aoNarrowOk} / ${aoNarrowTot} pairs; with the blind H0 it is optimal on ${zeroOk} / ${zeroTot} (always a valid route, sometimes longer).`);

// inadmissible H3 may be suboptimal in A*, but must still return a valid route
let h3bad = 0; for (let s = 0; s < G.N; s++) for (let g = 0; g < G.N; g++) if (s !== g) { const r = A.runAStar(G, s, g, 'weighted', false); if (!r.astar.found) fails++; if (r.astar.cost > r.dijkstra.cost + 1e-6) h3bad++; }
console.log(`A* with the over-estimating H3 is slightly suboptimal on ${h3bad} pairs (expected).`);

console.log('\nDefault scenario WH > EG, H2:');
const b = A.runAStar(G, 0, 15, 'hybrid', false), ao = A.runAOStar(G, 0, 15, { K: 3, hname: 'hybrid', record: false });
console.log(' ', 'astar'.padEnd(7), short(b.astar.path).padEnd(40), b.astar.cost.toFixed(2), 'km  explored', b.astar.expanded);
console.log(' ', 'ao*'.padEnd(7), short(ao.route).padEnd(40), ao.cost.toFixed(2), 'km  explored', ao.expansions);
const t = A.timeIt(() => A.runSearch(G, 0, 15, 'hybrid'));
console.log('  timing check: A* averages', t.ms.toFixed(4), 'ms over', t.reps, 'runs');
console.log(fails ? `\n${fails} FAILURES` : '\nAll checks passed.');
process.exit(fails ? 1 : 0);
