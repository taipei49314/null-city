import { z } from "zod";

/**
 * Rejects arrays and `null` where the protocol requires a keyed object.
 *
 * `typeof [] === "object"` is why the inherited verifiers accepted an array
 * as an event payload (audit finding ART-04). Every payload schema in this
 * package is anchored on this guard rather than on `typeof`.
 */
export const plainObject = z.custom<Record<string, unknown>>(
  (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  { message: "expected a non-array object" },
);

/** Non-negative integer tick. Negative ticks are never valid (audit finding ART-05). */
export const tickSchema = z.number().int().min(0);

/** Nullable non-negative integer tick. */
export const nullableTickSchema = tickSchema.nullable();

export const nonEmptyString = z.string().min(1);

export const finiteNumber = z.number().finite();

/** First zod issue rendered as a short, stable, test-assertable string. */
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "invalid payload";
  }
  const path = issue.path.join(".");
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}
