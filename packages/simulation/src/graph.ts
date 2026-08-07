import type { DistrictId, RouteId } from "@null-city/contracts";
import type { RouteInit } from "@null-city/scenario-schema";

export interface TravelPath {
  routeIds: RouteId[];
  /** total ticks required to travel the path */
  travelTicks: number;
}

interface Edge {
  next: DistrictId;
  travelTicks: number;
  routeId: RouteId;
}

/**
 * Weighted shortest path (Dijkstra) over open routes.
 * Returns null when no open path exists.
 */
export function shortestTravelPath(
  from: DistrictId,
  to: DistrictId,
  routes: readonly RouteInit[],
  closedRoutes: ReadonlySet<RouteId>,
): TravelPath | null {
  if (from === to) {
    return { routeIds: [], travelTicks: 0 };
  }

  const graph = new Map<DistrictId, Edge[]>();
  for (const route of routes) {
    if (closedRoutes.has(route.id)) {
      continue;
    }
    pushEdge(graph, route.from, { next: route.to, travelTicks: route.travelTicks, routeId: route.id });
    pushEdge(graph, route.to, { next: route.from, travelTicks: route.travelTicks, routeId: route.id });
  }

  const dist = new Map<DistrictId, number>();
  const prevEdge = new Map<DistrictId, { edge: Edge; prev: DistrictId }>();
  const visited = new Set<DistrictId>();
  dist.set(from, 0);

  while (visited.size < graph.size + 1) {
    let current: DistrictId | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const [node, cost] of dist) {
      if (!visited.has(node) && cost < best) {
        best = cost;
        current = node;
      }
    }
    if (current === null || best === Number.POSITIVE_INFINITY) {
      break;
    }
    if (current === to) {
      break;
    }
    visited.add(current);
    const edges = graph.get(current);
    if (!edges) {
      continue;
    }
    for (const edge of edges) {
      const alt = best + edge.travelTicks;
      const known = dist.get(edge.next);
      if (known === undefined || alt < known) {
        dist.set(edge.next, alt);
        prevEdge.set(edge.next, { edge, prev: current });
      }
    }
  }

  if (!dist.has(to)) {
    return null;
  }

  const routeIds: RouteId[] = [];
  let cursor: DistrictId | null = to;
  while (cursor !== null && prevEdge.has(cursor)) {
    const step = prevEdge.get(cursor);
    if (!step) {
      break;
    }
    routeIds.unshift(step.edge.routeId);
    cursor = step.prev;
  }

  return {
    routeIds,
    travelTicks: dist.get(to) as number,
  };
}

function pushEdge(graph: Map<DistrictId, Edge[]>, node: DistrictId, edge: Edge): void {
  const list = graph.get(node);
  if (list) {
    list.push(edge);
  } else {
    graph.set(node, [edge]);
  }
}
