import { describe, expect, it } from "vitest";
import {
  BLACK_RIVER_SCENARIO_ID,
  GLASS_HARBOR_SCENARIO_ID,
  MIRROR_DISTRICT_SCENARIO_ID,
  RED_LEDGER_SCENARIO_ID,
  SCENARIO_TOPOLOGIES,
  SIGNAL_ZERO_SCENARIO_ID,
  districtLabel,
  findDistrict,
  getTopology,
} from "../src/topology/registry";

describe("scenario topology registry (local, structural only)", () => {
  it("registers the suite scenarios including Mirror District and Red Ledger", () => {
    expect(SCENARIO_TOPOLOGIES.map((t) => t.scenarioId)).toEqual([
      BLACK_RIVER_SCENARIO_ID,
      GLASS_HARBOR_SCENARIO_ID,
      SIGNAL_ZERO_SCENARIO_ID,
      MIRROR_DISTRICT_SCENARIO_ID,
      RED_LEDGER_SCENARIO_ID,
    ]);
  });

  it.each(SCENARIO_TOPOLOGIES.map((t) => [t.scenarioId, t] as const))(
    "%s: every route endpoint refers to a declared district, no duplicate ids",
    (_scenarioId, topology) => {
      const knownIds = new Set(topology.districts.map((d) => d.id));
      expect(knownIds.size).toBe(topology.districts.length);
      for (const route of topology.routes) {
        expect(knownIds.has(route.from)).toBe(true);
        expect(knownIds.has(route.to)).toBe(true);
      }
      const routeIds = topology.routes.map((r) => r.id);
      expect(new Set(routeIds).size).toBe(routeIds.length);
    },
  );

  it.each(SCENARIO_TOPOLOGIES.map((t) => [t.scenarioId, t] as const))(
    "%s: carries no district attribute values (power/hazard/etc.) — structure only",
    (_scenarioId, topology) => {
      for (const district of topology.districts) {
        const keys = Object.keys(district);
        for (const forbidden of ["power", "hazardLevel", "populationRisk", "communications", "water", "traffic", "medicalCapacity"]) {
          expect(keys).not.toContain(forbidden);
        }
      }
    },
  );

  it("no district id collides across scenarios", () => {
    const seen = new Set<string>();
    for (const topology of SCENARIO_TOPOLOGIES) {
      for (const district of topology.districts) {
        expect(seen.has(district.id)).toBe(false);
        seen.add(district.id);
      }
    }
  });

  it("getTopology resolves each registered scenario and falls back to Black River for unknown ids", () => {
    expect(getTopology(GLASS_HARBOR_SCENARIO_ID).name).toBe("GLASS HARBOR");
    expect(getTopology(SIGNAL_ZERO_SCENARIO_ID).name).toBe("SIGNAL ZERO");
    expect(getTopology("not-a-real-scenario").scenarioId).toBe(BLACK_RIVER_SCENARIO_ID);
  });

  it("districtLabel resolves districts across the whole suite and falls back to the raw id", () => {
    expect(districtLabel("central")).toBe("Central");
    expect(districtLabel("harborside")).toBe("Harborside");
    expect(districtLabel("east-relay")).toBe("East Relay");
    expect(districtLabel("not-a-real-district")).toBe("not-a-real-district");
    expect(findDistrict("not-a-real-district")).toBeUndefined();
  });
});
