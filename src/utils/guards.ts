/**
 * Runtime type guards for data crossing a trust boundary.
 *
 * Everything the extension reads from the page — API payloads, `postMessage`
 * data — is `unknown` by contract. These are the narrowing primitives that turn
 * it into types without reaching for `any`.
 */

/** A non-null, non-array object. The usual starting point for narrowing JSON. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Rejects `NaN` and infinities, which `typeof` alone would let through. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Reads `key` from an unknown value without asserting the whole shape. */
export function readProp(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** Walks a path of keys, yielding `undefined` at the first missing link. */
export function readPath(value: unknown, ...keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}
