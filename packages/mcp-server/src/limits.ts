/**
 * Hard payload ceilings shared by every tool. These exist so an agent (or
 * a misbehaving MCP client) can never coerce the adapter into shipping an
 * unbounded response — the same "bounded outputs" discipline the
 * benchmark runner applies to policy decisions.
 */
export const MAX_EVENTS_PER_CALL = 200;
export const MAX_LIST_ITEMS = 200;
export const MAX_RATIONALE_LENGTH = 2000;

export interface BoundedList<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export function bound<T>(items: readonly T[], limit: number): BoundedList<T> {
  const capped = Math.max(1, Math.min(limit, MAX_LIST_ITEMS));
  return {
    items: items.slice(0, capped),
    total: items.length,
    truncated: items.length > capped,
  };
}

export function clampInt(value: number, min: number, max: number): number {
  const truncated = Math.trunc(value);
  return Math.min(max, Math.max(min, truncated));
}
