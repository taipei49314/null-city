import { describe, expect, it } from "vitest";
import type { RouteInit } from "@null-city/scenario-schema";

import { shortestTravelPath } from "../src/graph.js";

/**
 * M8: weighted-route correctness against a genuinely independent reference on
 * randomized graphs.
 *
 * The existing `graph.test.ts` compares against a brute-force walker, but only
 * on one hand-written five-edge graph. This file cross-checks a *different
 * algorithm* (Bellman-Ford, which relaxes every edge rather than settling the
 * cheapest frontier node) over seeded random graphs, including closures,
 * parallel edges, disconnected components and heavy weight ties — the shapes
 * where a hand-rolled Dijkstra is most likely to be wrong.
 *
 * Randomness is seeded so a failure is always reproducible from the seed
 * printed in the assertion message.
 */

/** Deterministic PRNG so failures reproduce exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RandomGraph {
  nodes: string[];
  routes: RouteInit[];
  closed: Set<string>;
}

function randomGraph(seed: number): RandomGraph {
  const random = mulberry32(seed);
  const nodeCount = 2 + Math.floor(random() * 7);
  const nodes = Array.from({ length: nodeCount }, (_, index) => `d${index}`);
  const routes: RouteInit[] = [];
  const edgeCount = Math.floor(random() * (nodeCount * 2));

  for (let i = 0; i < edgeCount; i += 1) {
    const from = nodes[Math.floor(random() * nodeCount)]!;
    const to = nodes[Math.floor(random() * nodeCount)]!;
    if (from === to) {
      continue;
    }
    routes.push({
      id: `r${i}`,
      from: from as never,
      to: to as never,
      // Small integer weights maximise ties, which is where tie-breaking bugs
      // in a hand-rolled Dijkstra show up.
      travelTicks: 1 + Math.floor(random() * 5),
      capacity: 100,
    });
  }

  const closed = new Set<string>();
  for (const route of routes) {
    if (random() < 0.2) {
      closed.add(route.id);
    }
  }
  return { nodes, routes, closed };
}

/**
 * Independent reference: Bellman-Ford. Deliberately a different algorithm from
 * the implementation so a shared logical error cannot cancel out.
 */
function bellmanFord(from: string, to: string, routes: readonly RouteInit[], closed: ReadonlySet<string>): number | null {
  if (from === to) {
    return 0;
  }
  const open = routes.filter((route) => !closed.has(route.id));
  const nodes = new Set<string>([from, to]);
  for (const route of open) {
    nodes.add(route.from);
    nodes.add(route.to);
  }
  const distance = new Map<string, number>();
  for (const node of nodes) {
    distance.set(node, Number.POSITIVE_INFINITY);
  }
  distance.set(from, 0);

  for (let round = 0; round < nodes.size - 1; round += 1) {
    let changed = false;
    for (const route of open) {
      for (const [a, b] of [
        [route.from, route.to],
        [route.to, route.from],
      ] as const) {
        const current = distance.get(a)!;
        if (current === Number.POSITIVE_INFINITY) {
          continue;
        }
        const candidate = current + route.travelTicks;
        if (candidate < distance.get(b)!) {
          distance.set(b, candidate);
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
  }

  const result = distance.get(to)!;
  return result === Number.POSITIVE_INFINITY ? null : result;
}

/** Recomputes the cost of a returned route list, to check the path itself. */
function costOfPath(routeIds: readonly string[], routes: readonly RouteInit[]): number {
  let total = 0;
  for (const id of routeIds) {
    const route = routes.find((candidate) => candidate.id === id);
    if (!route) {
      throw new Error(`returned unknown route id ${id}`);
    }
    total += route.travelTicks;
  }
  return total;
}

/** Confirms the returned route ids form a connected walk from `from` to `to`. */
function pathIsConnected(from: string, to: string, routeIds: readonly string[], routes: readonly RouteInit[]): boolean {
  let cursor = from;
  for (const id of routeIds) {
    const route = routes.find((candidate) => candidate.id === id)!;
    if (route.from === cursor) {
      cursor = route.to;
    } else if (route.to === cursor) {
      cursor = route.from;
    } else {
      return false;
    }
  }
  return cursor === to;
}

describe("weighted routing against an independent Bellman-Ford reference", () => {
  it("agrees with Bellman-Ford on 400 seeded random graphs", () => {
    let compared = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const { nodes, routes, closed } = randomGraph(seed);
      for (const from of nodes) {
        for (const to of nodes) {
          const actual = shortestTravelPath(from as never, to as never, routes, closed as never);
          const expected = bellmanFord(from, to, routes, closed);
          compared += 1;
          expect(
            actual === null ? null : actual.travelTicks,
            `seed=${seed} from=${from} to=${to} routes=${JSON.stringify(routes)} closed=${[...closed]}`,
          ).toBe(expected);
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("returns a connected path whose recomputed cost equals the reported cost", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const { nodes, routes, closed } = randomGraph(seed);
      for (const from of nodes) {
        for (const to of nodes) {
          const actual = shortestTravelPath(from as never, to as never, routes, closed as never);
          if (actual === null || from === to) {
            continue;
          }
          expect(
            costOfPath(actual.routeIds, routes),
            `seed=${seed} ${from}->${to} cost mismatch for ${JSON.stringify(actual)}`,
          ).toBe(actual.travelTicks);
          expect(
            pathIsConnected(from, to, actual.routeIds, routes),
            `seed=${seed} ${from}->${to} returned a disconnected walk ${JSON.stringify(actual.routeIds)}`,
          ).toBe(true);
        }
      }
    }
  });

  it("never routes through a closed route", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const { nodes, routes, closed } = randomGraph(seed);
      for (const from of nodes) {
        for (const to of nodes) {
          const actual = shortestTravelPath(from as never, to as never, routes, closed as never);
          for (const id of actual?.routeIds ?? []) {
            expect(closed.has(id), `seed=${seed} used closed route ${id}`).toBe(false);
          }
        }
      }
    }
  });

  it("handles parallel edges by taking the cheaper one", () => {
    const routes: RouteInit[] = [
      { id: "slow", from: "central" as never, to: "north" as never, travelTicks: 9, capacity: 100 },
      { id: "fast", from: "central" as never, to: "north" as never, travelTicks: 2, capacity: 100 },
    ];
    const path = shortestTravelPath("central" as never, "north" as never, routes, new Set());
    expect(path?.travelTicks).toBe(2);
    expect(path?.routeIds).toEqual(["fast"]);
  });

  it("falls back to the parallel edge when the cheaper one is closed", () => {
    const routes: RouteInit[] = [
      { id: "slow", from: "central" as never, to: "north" as never, travelTicks: 9, capacity: 100 },
      { id: "fast", from: "central" as never, to: "north" as never, travelTicks: 2, capacity: 100 },
    ];
    const path = shortestTravelPath("central" as never, "north" as never, routes, new Set(["fast"] as never));
    expect(path?.travelTicks).toBe(9);
    expect(path?.routeIds).toEqual(["slow"]);
  });

  it("treats an unknown origin or destination as unreachable, not as cost zero", () => {
    const routes: RouteInit[] = [
      { id: "a", from: "central" as never, to: "north" as never, travelTicks: 3, capacity: 100 },
    ];
    expect(shortestTravelPath("ghost" as never, "north" as never, routes, new Set())).toBeNull();
    expect(shortestTravelPath("central" as never, "ghost" as never, routes, new Set())).toBeNull();
  });
});
