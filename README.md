# Parcel Delivery · Search Algorithm Visualizer

An interactive visualizer that finds a delivery route from point **A** to point **B** on a small city map using
two search algorithms, lets you watch each one step by step, and compares them on the same map:

| Algorithm | Rule |
|---|---|
| **A\*** | expand the frontier node with the lowest f(n) = g(n) + h(n) |
| **AO\*** | AND-OR problem reduction (sub-problems P(u→v), AND arcs through waypoints) |

For every run the app reports **path found, total cost (km), nodes explored and execution time**.

Course: CSE3121 – Artificial Intelligence & Soft Computing. No installs, no internet, no build step.

## How to run

**Option 1 (simplest):** unzip, then double-click `index.html` (Chrome, Edge, Firefox or Safari).

**Option 2 (local server):**
```
cd ao-delivery
python3 -m http.server 8000      # then open http://localhost:8000
```

**Automated tests (optional, needs Node.js):**
```
node test/run_tests.js
```
Checks, for every start/goal pair (240): A\* returns a valid chain of real roads whose cost matches and is optimal
with H0/H1/H2, step recording never changes an answer, and AO\* with K = all matches Dijkstra.

## Using it

1. Pick a ready-made scenario, or choose A and B (drop-downs, or click two junctions on the map).
2. Choose the algorithm to watch with the **Watch** buttons (A\*, AO\*).
3. Press **Play** (or ← / → to step, Space to play/pause, Home/End to jump).
   * A\*: each round is **Pick** (take the lowest-f node off the frontier) then **Expand** (look at every road
     leaving it). The map shows explored nodes, the frontier, the search tree and the final route; the right-hand
     panel lists the frontier (row 1 leaves next) and the explored nodes in order.
   * AO\*: each iteration is **Select → Expand → Revise**, shown on the AND-OR graph (drag to pan, scroll to zoom).
4. The **comparison table** (bottom) runs both on the same A and B. Click a row to watch that algorithm.
   Tick **Draw all paths on the map** to see the two final routes together.

## What the comparison measures

* **Path found** – the junctions visited, A to B.
* **Total cost (km)** – sum of the road lengths on the path. Roads are straight lines, or curved by a winding
  factor (see `js/map.js`).
* **Nodes explored** – nodes taken off the frontier and checked (the goal included). For AO\* this is the number of
  *sub-problems expanded*, which is not the same thing as a map junction, so read it as a trend.
* **Execution time** – average wall-clock time of the search alone, repeated until at least ~15 ms have elapsed, with a
  warm-up. The same code that animates also runs un-instrumented for timing (no step recording), so the number is fair.
  It depends on your computer; compare ratios, not absolute values.
* **Result** – "shortest", or how much longer than the true optimum (Dijkstra, computed behind the scenes).

## Heuristics

| Name | Definition | Admissible? |
|---|---|---|
| H0 | h = 0 (blind) | yes |
| H1 | straight-line distance | yes |
| **H2** (default) | max(H1, landmark bound) | yes, tighter than H1 |
| H3 | 1.6 × H2 (deliberately over-estimates) | no (A\* may return a longer route) |

The landmark bound uses three landmark junctions (purple diamonds) with exact road distances to every junction:
|d(L,v) − d(L,u)| never exceeds the true distance (triangle inequality). Both A\* and AO\* use the heuristic.

## What changed from the first version

* Added step-by-step visualization for **A\*** (`js/astar.js`) next to AO\*. The other classic searches (BFS, DFS,
  Greedy, Hill climbing) are not part of this project.
* Comparison table now shows path, total cost, nodes explored and **execution time**, with a path overlay on the map.
* Removed the river and bridges, rush-hour traffic, road closing, vehicle types and stop penalties. The map is now a
  plain road network and the cost of a road is its length in km.
* AO\* with a narrow beam and a weak heuristic could dead-end and report "no route" on a connected map. It now retries
  automatically with a wider K and says so in the narration.

## Honest limitations

* AO\* is optimal **inside the graph it generates**. With K = all and H1/H2 it matched Dijkstra on every tested pair;
  with the default (H2, K = 3) it did on all 240 pairs; with the blind H0 it returned a longer route on 38 of 240.
* A road network has only OR choices (which road to drive), so AO\* does extra bookkeeping here. For a plain A→B
  route, A\* is the better tool; AO\* is the right model when a task is made of sub-tasks that must **all** be done.
* The map is a fixed 16-junction demo city. Edit `js/map.js` (nodes and `EDGES`) to change it.

## Files

```
index.html          page layout
css/style.css       styling (light and dark theme)
js/map.js           city, roads, graph construction
js/heuristics.js    H0–H3
js/aostar.js        AO* (records every step for playback; can run without recording for timing)
js/astar.js         A* (records every step for playback), timer
js/app.js           user interface
test/run_tests.js   headless correctness tests
```
