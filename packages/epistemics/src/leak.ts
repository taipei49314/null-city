const FORBIDDEN_KIND_MARKERS = [
  "TrueIncidentOccurred",
  "IncidentChained",
  "IncidentResolved",
  "SystemStateChanged",
  "ObservationCorrupted",
  "prngState",
  "idempotencyKeys",
  "internallyFalse",
  "corruptionType",
  '"false":true',
  '"stream":"truth"',
];

const FORBIDDEN_TRUTH_ATTR_PATTERN =
  /"districts"\s*:\s*\{[^}]*"(?:power|communications|water|hazardLevel|populationRisk)"\s*:\s*\d+/;

/** Returns a reason string when a public payload appears to leak truth. */
export function detectPublicLeak(value: unknown): string | null {
  const text = JSON.stringify(value);
  if (!text) {
    return null;
  }
  for (const marker of FORBIDDEN_KIND_MARKERS) {
    if (text.includes(marker)) {
      return marker;
    }
  }
  if (FORBIDDEN_TRUTH_ATTR_PATTERN.test(text)) {
    return "truth_district_attributes";
  }
  if (text.includes('"internal"') && text.includes('"incidents"')) {
    return "internal_incidents";
  }
  return null;
}
