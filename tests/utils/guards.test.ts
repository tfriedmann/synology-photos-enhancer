import { describe, expect, it } from 'vitest';

import { isFiniteNumber, isRecord, isString, readPath, readProp } from '@/utils/guards';

describe('isRecord', () => {
  it('accepts plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('rejects null, arrays and primitives', () => {
    /* `typeof null === 'object'` and arrays are objects too — the two mistakes
     * this guard exists to prevent. */
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord('a')).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('isString', () => {
  it('accepts strings only', () => {
    expect(isString('')).toBe(true);
    expect(isString(42)).toBe(false);
    expect(isString(null)).toBe(false);
  });
});

describe('isFiniteNumber', () => {
  it('accepts real numbers', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
  });

  it('rejects NaN and infinities', () => {
    /* `typeof NaN === 'number'`, so a plain typeof check would let it through
     * and poison every comparison downstream. */
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rejects numeric strings', () => {
    expect(isFiniteNumber('42')).toBe(false);
  });
});

describe('readProp', () => {
  it('reads an existing key', () => {
    expect(readProp({ a: 1 }, 'a')).toBe(1);
  });

  it('returns undefined for a missing key or a non-record', () => {
    expect(readProp({ a: 1 }, 'b')).toBeUndefined();
    expect(readProp(null, 'a')).toBeUndefined();
    expect(readProp('string', 'a')).toBeUndefined();
  });
});

describe('readPath', () => {
  it('walks nested objects', () => {
    expect(readPath({ data: { list: [1] } }, 'data', 'list')).toEqual([1]);
  });

  it('returns undefined at the first missing link, without throwing', () => {
    expect(readPath({ data: {} }, 'data', 'list', 'deep')).toBeUndefined();
    expect(readPath(undefined, 'a', 'b')).toBeUndefined();
    expect(readPath({ data: 'not an object' }, 'data', 'list')).toBeUndefined();
  });

  it('returns the input when given no keys', () => {
    expect(readPath({ a: 1 })).toEqual({ a: 1 });
  });
});
