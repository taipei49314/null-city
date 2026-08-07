/**
 * Structural bounds for browser-side artifact parsing / canonicalization.
 * Fail closed: oversized or over-deep values never reach projectors.
 */

export const MAX_NESTING_DEPTH = 32;
export const MAX_EVENT_COUNT = 50_000;
export const MAX_STRING_LENGTH = 16_384;
export const MAX_ARRAY_LENGTH = 20_000;
export const MAX_OBJECT_KEYS = 2_000;

export class ArtifactBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactBoundsError";
  }
}

export function measureDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== "object") {
    return depth;
  }
  if (depth > MAX_NESTING_DEPTH) {
    return depth;
  }
  if (Array.isArray(value)) {
    let max = depth;
    for (const item of value) {
      max = Math.max(max, measureDepth(item, depth + 1));
      if (max > MAX_NESTING_DEPTH) {
        return max;
      }
    }
    return max;
  }
  let max = depth;
  for (const item of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, measureDepth(item, depth + 1));
    if (max > MAX_NESTING_DEPTH) {
      return max;
    }
  }
  return max;
}

export function assertWithinDepth(value: unknown, where: string): void {
  if (measureDepth(value) > MAX_NESTING_DEPTH) {
    throw new ArtifactBoundsError(`${where}: nesting exceeds maximum depth ${MAX_NESTING_DEPTH}`);
  }
}
