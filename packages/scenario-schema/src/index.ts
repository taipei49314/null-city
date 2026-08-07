import { z } from "zod";
import { TEAM_TYPES } from "@null-city/contracts";
import { compileScenario, type CompiledScenario } from "./compile.js";

export {
  compileScenario,
  ScenarioCompileError,
  SUPPORTED_SCHEMA_VERSIONS,
  type CompiledScenario,
  type ScenarioDiagnostic,
} from "./compile.js";

/**
 * District ids are scenario-defined, not a fixed global enum: any lowercase
 * slug is syntactically valid here, and `compileScenario` separately checks
 * that every reference (`teams[].startDistrict`, `routes[].from/to`,
 * `incidents[].district`, `effects[].target`, `chainTrigger.district`)
 * resolves to a district actually declared in *this* scenario's own
 * `districts[]`. This is what lets a new scenario ship as pure JSON under
 * `scenarios/` with no edit to this package.
 */
export const districtIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "district id must be a lowercase slug (a-z, 0-9, -), starting with a letter");
export const teamTypeSchema = z.enum(TEAM_TYPES);

export const scenarioMetadataSchema = z
  .object({
    difficulty: z.enum(["introductory", "standard", "advanced"]),
    tags: z.array(z.string().min(1)).default([]),
    expectedDurationMinutes: z.number().positive(),
    mechanics: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const districtInitSchema = z
  .object({
    id: districtIdSchema,
    power: z.number().min(0).max(100),
    communications: z.number().min(0).max(100),
    water: z.number().min(0).max(100),
    traffic: z.number().min(0).max(100),
    medicalCapacity: z.number().min(0).max(100),
    hazardLevel: z.number().min(0).max(100),
    populationRisk: z.number().min(0).max(100),
  })
  .strict();

export const teamInitSchema = z
  .object({
    teamId: z.string().min(1),
    type: teamTypeSchema,
    startDistrict: districtIdSchema,
    reschedulable: z.boolean().default(true),
  })
  .strict();

export const routeInitSchema = z
  .object({
    id: z.string().min(1),
    from: districtIdSchema,
    to: districtIdSchema,
    travelTicks: z.number().int().positive(),
    capacity: z.number().min(0).max(100).default(100),
  })
  .strict();

export const effectInitSchema = z
  .object({
    atTick: z.number().int().min(0),
    target: districtIdSchema,
    attribute: z.enum([
      "power",
      "communications",
      "water",
      "traffic",
      "medicalCapacity",
      "hazardLevel",
      "populationRisk",
    ]),
    delta: z.number(),
    repeatEvery: z.number().int().positive().optional(),
    label: z.string().optional(),
  })
  .strict();

export const incidentInitSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    district: districtIdSchema,
    /** triggers at this tick */
    atTick: z.number().int().min(0),
    /** incident severity, 0..100 */
    severity: z.number().min(0).max(100),
    /** applied repeatedly while the incident is active */
    effect: z.object({
      attribute: z.enum([
        "power",
        "communications",
        "water",
        "traffic",
        "medicalCapacity",
        "hazardLevel",
        "populationRisk",
      ]),
      delta: z.number(),
    }),
    /** condition to declare the incident handled; teams dispatched for this incident may satisfy it */
    handledBy: z.array(z.string()).default([]),
    /** optional chained trigger: fires when the source incident is active and the
     *  monitored district attribute stays below the threshold for `forTicks`
     *  consecutive ticks (defaults to the source incident's district) */
    chainTrigger: z
      .object({
        sourceIncidentId: z.string().min(1),
        district: districtIdSchema.optional(),
        attribute: z.enum([
          "power",
          "communications",
          "water",
          "traffic",
          "medicalCapacity",
          "hazardLevel",
          "populationRisk",
        ]),
        below: z.number(),
        forTicks: z.number().int().positive(),
      })
      .optional(),
  })
  .strict();

export const observationSourceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["sensor", "human", "dispatch", "medical", "public", "news", "automated"]),
    reliability: z.number().min(0).max(1),
  })
  .strict();

export const observationDefSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    /** real observation delay in ticks */
    baseDelayTicks: z.number().int().min(0),
    /** probability the observation never arrives (0..1) */
    lossProbability: z.number().min(0).max(1).default(0),
    /** additional delay when communication channel is degraded */
    degradedDelayMultiplier: z.number().min(1).default(1),
    /** corruption table: "truth" -> possibly corrupted text */
    corruption: z
      .array(
        z.object({
          probability: z.number().min(0).max(1),
          type: z.enum([
            "exaggerated",
            "understated",
            "mistaken_identity",
            "wrong_location",
            "attribution_error",
          ]),
          text: z.string(),
          false: z.boolean().default(false),
        }),
      )
      .optional(),
    /** when this observation is no longer "news", it may be dropped silently */
    staleAfterTicks: z.number().int().min(0).optional(),
    content: z.string().min(1),
    category: z.string().default("report"),
    /** reference to the incident that creates this observation */
    incidentId: z.string(),
    /** observation triggers at a specific tick (for scripted reports) */
    atTick: z.number().int().min(0),
    /** when true, atTick is interpreted as ticks AFTER the incident becomes active */
    relativeToIncidentStart: z.boolean().default(false),
  })
  .strict();

export const scenarioSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    metadata: scenarioMetadataSchema.optional(),
    tickDurationSeconds: z.number().positive().default(10),
    totalTicks: z.number().int().positive(),
    districts: z.array(districtInitSchema),
    teams: z.array(teamInitSchema),
    routes: z.array(routeInitSchema),
    resources: z
      .object({
        backupGenerators: z.number().int().min(0),
        advisoryUses: z.number().int().min(0),
      })
      .strict(),
    incidents: z.array(incidentInitSchema),
    effects: z.array(effectInitSchema).optional().default([]),
    sources: z.array(observationSourceSchema),
    observations: z.array(observationDefSchema),
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioInit = Scenario;
export type ScenarioMetadata = z.infer<typeof scenarioMetadataSchema>;
export type DistrictInit = z.infer<typeof districtInitSchema>;
export type TeamInit = z.infer<typeof teamInitSchema>;
export type RouteInit = z.infer<typeof routeInitSchema>;
export type IncidentInit = z.infer<typeof incidentInitSchema>;
export type EffectInit = z.infer<typeof effectInitSchema>;
export type ObservationSource = z.infer<typeof observationSourceSchema>;
export type ObservationDef = z.infer<typeof observationDefSchema>;

export function parseScenario(json: string): Scenario & CompiledScenario {
  const parsed = scenarioSchema.parse(stripCompiledFields(JSON.parse(json)));
  return compileScenario(parsed) as Scenario & CompiledScenario;
}

export function validateScenario(value: unknown): Scenario & CompiledScenario {
  const parsed = scenarioSchema.parse(stripCompiledFields(value));
  return compileScenario(parsed) as Scenario & CompiledScenario;
}

/** Allow re-validating an already-compiled scenario object. */
export function stripCompiledFields(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = { ...(value as Record<string, unknown>) };
  delete record["format"];
  delete record["version"];
  delete record["digest"];
  delete record["indexes"];
  return record;
}

export const MAX_SCENARIO_FILE_BYTES = 1_000_000;

export function assertScenarioSize(json: string): void {
  if (Buffer.byteLength(json, "utf8") > MAX_SCENARIO_FILE_BYTES) {
    throw new Error(`scenario file exceeds ${MAX_SCENARIO_FILE_BYTES} bytes`);
  }
}
