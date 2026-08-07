import { describe, expect, it } from "vitest";
import type { RouteInit } from "@null-city/scenario-schema";
import { shortestTravelPath } from "../src/graph.js";

describe("shortestTravelPath (Dijkstra)", () => {
  it("prefers a longer hop-count path when total travelTicks is lower", () => {
    // A -10-> B -10-> C  (20) vs A -100-> C. BFS-by-hops would pick the direct edge.
    const routes: RouteInit[] = [
      { id: "a-c-slow", from: "central", to: "medical", travelTicks: 100, capacity: 100 },
      { id: "a-b", from: "central", to: "north", travelTicks: 10, capacity: 100 },
      { id: "b-c", from: "north", to: "medical", travelTicks: 10, capacity: 100 },
    ];
    const path = shortestTravelPath("central", "medical", routes, new Set());
    expect(path).not.toBeNull();
    expect(path!.travelTicks).toBe(20);
    expect(path!.routeIds).toEqual(["a-b", "b-c"]);
  });

  it("returns null when disconnected by closures", () => {
    const routes: RouteInit[] = [
      { id: "a-b", from: "central", to: "north", travelTicks: 4, capacity: 100 },
    ];
    expect(shortestTravelPath("central", "riverside", routes, new Set())).toBeNull();
    expect(shortestTravelPath("central", "north", routes, new Set(["a-b"]))).toBeNull();
  });

  it("matches an independent brute-force reference on small graphs", () => {
    const routes: RouteInit[] = [
      { id: "r1", from: "central", to: "industrial", travelTicks: 6, capacity: 100 },
      { id: "r2", from: "central", to: "riverside", travelTicks: 5, capacity: 100 },
      { id: "r3", from: "industrial", to: "riverside", travelTicks: 4, capacity: 100 },
      { id: "r4", from: "central", to: "north", travelTicks: 4, capacity: 100 },
      { id: "r5", from: "north", to: "riverside", travelTicks: 5, capacity: 100 },
    ];
    const pairs: Array<[string, string]> = [
      ["central", "riverside"],
      ["industrial", "north"],
      ["north", "industrial"],
    ];
    for (const [from, to] of pairs) {
      const got = shortestTravelPath(from as never, to as never, routes, new Set());
      const ref = bruteForce(from, to, routes);
      expect(got?.travelTicks).toBe(ref);
    }
  });
});

function bruteForce(from: string, to: string, routes: RouteInit[]): number | null {
  if (from === to) {
    return 0;
  }
  type Edge = { to: string; cost: number };
  const adj = new Map<string, Edge[]>();
  for (const route of routes) {
    const a = adj.get(route.from) ?? [];
    a.push({ to: route.to, cost: route.travelTicks });
    adj.set(route.from, a);
    const b = adj.get(route.to) ?? [];
    b.push({ to: route.from, cost: route.travelTicks });
    adj.set(route.to, b);
  }
  let best: number | null = null;
  const walk = (node: string, cost: number, seen: Set<string>): void => {
    if (cost > (best ?? Number.POSITIVE_INFINITY)) {
      return;
    }
    if (node === to) {
      best = cost;
      return;
    }
    for (const edge of adj.get(node) ?? []) {
      if (seen.has(edge.to)) {
        continue;
      }
      const next = new Set(seen);
      next.add(edge.to);
      walk(edge.to, cost + edge.cost, next);
    }
  };
  walk(from, 0, new Set([from]));
  return best;
}
