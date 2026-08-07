/**
 * Shared structural topology types used by every per-scenario topology
 * module (`blackRiver.ts`, `glassHarbor.ts`, `signalZero.ts`) and by the
 * registry (`registry.ts`) that picks between them.
 *
 * These carry only the *structural* public facts a human commander would
 * already know before the crisis starts: which districts exist, which
 * roads connect them, and where to draw them. No district attribute values
 * (power, hazard, population risk, ...) live here — those are only ever
 * known through delivered evidence and claims in `PlayerSessionState`.
 */

export interface TopologyDistrict {
  id: string;
  label: string;
  /** normalized layout position, 0..100 */
  x: number;
  y: number;
}

export interface TopologyRoute {
  id: string;
  from: string;
  to: string;
}

export interface ScenarioTopology {
  scenarioId: string;
  /** short display name, e.g. "BLACK RIVER" */
  name: string;
  districts: readonly TopologyDistrict[];
  routes: readonly TopologyRoute[];
}
