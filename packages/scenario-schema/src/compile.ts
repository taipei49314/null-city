import { canonicalJson, sha256 } from "@null-city/contracts";

/** Structural scenario input after Zod parse (avoids circular import with index). */
export interface ScenarioSource {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  metadata?: {
    difficulty: "introductory" | "standard" | "advanced";
    tags: string[];
    expectedDurationMinutes: number;
    mechanics: string[];
  };
  tickDurationSeconds: number;
  totalTicks: number;
  districts: Array<{ id: string } & Record<string, unknown>>;
  teams: Array<{ teamId: string; startDistrict: string } & Record<string, unknown>>;
  routes: Array<{ id: string; from: string; to: string; travelTicks: number } & Record<string, unknown>>;
  resources: { backupGenerators: number; advisoryUses: number };
  incidents: Array<{
    id: string;
    district: string;
    atTick: number;
    chainTrigger?: {
      sourceIncidentId: string;
      district?: string;
      attribute: string;
      below: number;
      forTicks: number;
    };
  } & Record<string, unknown>>;
  effects: Array<{ target: string; atTick: number } & Record<string, unknown>>;
  sources: Array<{ id: string } & Record<string, unknown>>;
  observations: Array<{
    id: string;
    incidentId: string;
    sourceId: string;
    corruption?: Array<{ probability: number }>;
  } & Record<string, unknown>>;
}

export const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

export interface ScenarioDiagnostic {
  path: string;
  message: string;
}

export type CompiledScenario = ScenarioSource & {
  format: "nullcity-scenario";
  version: 1;
  digest: string;
  indexes: {
    districtIds: string[];
    teamIds: string[];
    routeIds: string[];
    incidentIds: string[];
    sourceIds: string[];
    observationIds: string[];
  };
};

export class ScenarioCompileError extends Error {
  diagnostics: ScenarioDiagnostic[];
  constructor(diagnostics: ScenarioDiagnostic[]) {
    super(diagnostics.map((d) => `${d.path}: ${d.message}`).join("; "));
    this.diagnostics = diagnostics;
  }
}

/**
 * Semantic compilation: uniqueness, references, cycles, probability sums,
 * resource ceilings, route validity, canonical ordering, digest.
 */
export function compileScenario(scenario: ScenarioSource): CompiledScenario {
  const diagnostics: ScenarioDiagnostic[] = [];
  const diag = (path: string, message: string): void => {
    diagnostics.push({ path, message });
  };

  if (!SUPPORTED_SCHEMA_VERSIONS.has(scenario.schemaVersion)) {
    diag("schemaVersion", `unsupported schemaVersion ${scenario.schemaVersion}; supported: ${[...SUPPORTED_SCHEMA_VERSIONS].join(",")}`);
  }
  if (scenario.totalTicks > 10_000) {
    diag("totalTicks", "totalTicks exceeds hard ceiling 10000");
  }
  if (scenario.districts.length === 0) {
    diag("districts", "at least one district is required");
  }
  if (scenario.resources.backupGenerators > 100 || scenario.resources.advisoryUses > 100) {
    diag("resources", "resource counts exceed ceiling 100");
  }

  const districtIds = new Set(scenario.districts.map((d) => d.id));
  assertUnique(
    scenario.districts.map((d) => d.id),
    "districts",
    diag,
  );
  assertUnique(
    scenario.teams.map((t) => t.teamId),
    "teams",
    diag,
  );
  assertUnique(
    scenario.routes.map((r) => r.id),
    "routes",
    diag,
  );
  assertUnique(
    scenario.incidents.map((i) => i.id),
    "incidents",
    diag,
  );
  assertUnique(
    scenario.sources.map((s) => s.id),
    "sources",
    diag,
  );
  assertUnique(
    scenario.observations.map((o) => o.id),
    "observations",
    diag,
  );

  for (const team of scenario.teams) {
    if (!districtIds.has(team.startDistrict)) {
      diag(`teams.${team.teamId}.startDistrict`, `unknown district ${team.startDistrict}`);
    }
  }
  for (const route of scenario.routes) {
    if (!districtIds.has(route.from)) {
      diag(`routes.${route.id}.from`, `unknown district ${route.from}`);
    }
    if (!districtIds.has(route.to)) {
      diag(`routes.${route.id}.to`, `unknown district ${route.to}`);
    }
    if (route.from === route.to) {
      diag(`routes.${route.id}`, "route cannot be a self-loop");
    }
  }

  const incidentIds = new Set(scenario.incidents.map((i) => i.id));
  const sourceIds = new Set(scenario.sources.map((s) => s.id));
  for (const incident of scenario.incidents) {
    if (!districtIds.has(incident.district)) {
      diag(`incidents.${incident.id}.district`, `unknown district ${incident.district}`);
    }
    // Chain-only incidents may use a sentinel atTick beyond the horizon.
    if (incident.atTick > scenario.totalTicks && !incident.chainTrigger) {
      diag(`incidents.${incident.id}.atTick`, "atTick exceeds totalTicks");
    }
    if (incident.chainTrigger) {
      if (!incidentIds.has(incident.chainTrigger.sourceIncidentId)) {
        diag(
          `incidents.${incident.id}.chainTrigger.sourceIncidentId`,
          `unknown source incident ${incident.chainTrigger.sourceIncidentId}`,
        );
      }
      if (incident.chainTrigger.sourceIncidentId === incident.id) {
        diag(`incidents.${incident.id}.chainTrigger`, "incident cannot chain from itself");
      }
      const chainDistrict = incident.chainTrigger.district ?? incident.district;
      if (!districtIds.has(chainDistrict)) {
        diag(`incidents.${incident.id}.chainTrigger.district`, `unknown district ${chainDistrict}`);
      }
    }
  }

  // Detect chain cycles (directed edges source -> chained)
  const chainAdj = new Map<string, string[]>();
  for (const incident of scenario.incidents) {
    if (!incident.chainTrigger) {
      continue;
    }
    const src = incident.chainTrigger.sourceIncidentId;
    const list = chainAdj.get(src) ?? [];
    list.push(incident.id);
    chainAdj.set(src, list);
  }
  if (hasCycle(chainAdj)) {
    diag("incidents.chainTrigger", "chain trigger graph contains a cycle");
  }

  for (const observation of scenario.observations) {
    if (!incidentIds.has(observation.incidentId)) {
      diag(`observations.${observation.id}.incidentId`, `unknown incident ${observation.incidentId}`);
    }
    if (!sourceIds.has(observation.sourceId)) {
      diag(`observations.${observation.id}.sourceId`, `unknown source ${observation.sourceId}`);
    }
    const corruption = observation.corruption ?? [];
    const sum = corruption.reduce((acc, c) => acc + c.probability, 0);
    if (sum > 1.0001) {
      diag(`observations.${observation.id}.corruption`, `corruption probability sum ${sum} exceeds 1`);
    }
  }

  for (const effect of scenario.effects) {
    if (!districtIds.has(effect.target)) {
      diag(`effects.target`, `unknown district ${effect.target}`);
    }
    if (effect.atTick > scenario.totalTicks) {
      diag(`effects.atTick`, "effect atTick exceeds totalTicks");
    }
  }

  if (diagnostics.length > 0) {
    throw new ScenarioCompileError(diagnostics);
  }

  const ordered: ScenarioSource = {
    ...scenario,
    districts: [...scenario.districts].sort((a, b) => a.id.localeCompare(b.id)),
    teams: [...scenario.teams].sort((a, b) => a.teamId.localeCompare(b.teamId)),
    routes: [...scenario.routes].sort((a, b) => a.id.localeCompare(b.id)),
    incidents: [...scenario.incidents].sort((a, b) => a.id.localeCompare(b.id)),
    sources: [...scenario.sources].sort((a, b) => a.id.localeCompare(b.id)),
    observations: [...scenario.observations].sort((a, b) => a.id.localeCompare(b.id)),
    effects: [...scenario.effects].sort((a, b) => a.atTick - b.atTick || a.target.localeCompare(b.target)),
  };

  const digest = sha256(canonicalJson(ordered));
  // A compiled scenario is a value, and its `digest` is only meaningful while
  // the contents it was computed over stay put. One loader instance is shared
  // by every session in a server process, so an accidental (or hostile) write
  // to a nested district/incident object would silently change what later
  // sessions simulate while the digest kept asserting the original bytes.
  // Freezing makes that a thrown TypeError in strict mode instead.
  return deepFreeze({
    ...ordered,
    format: "nullcity-scenario",
    version: 1,
    digest,
    indexes: {
      districtIds: ordered.districts.map((d) => d.id),
      teamIds: ordered.teams.map((t) => t.teamId),
      routeIds: ordered.routes.map((r) => r.id),
      incidentIds: ordered.incidents.map((i) => i.id),
      sourceIds: ordered.sources.map((s) => s.id),
      observationIds: ordered.observations.map((o) => o.id),
    },
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
}

function assertUnique(ids: string[], path: string, diag: (path: string, message: string) => void): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      diag(path, `duplicate id ${id}`);
    }
    seen.add(id);
  }
}

function hasCycle(adj: Map<string, string[]>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: string): boolean => {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    for (const next of adj.get(node) ?? []) {
      if (walk(next)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of adj.keys()) {
    if (walk(node)) {
      return true;
    }
  }
  return false;
}
