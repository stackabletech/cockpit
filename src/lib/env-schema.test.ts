import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  envBoolean,
  envInteger,
  envList,
  envOptionalInteger,
  envUrl,
  parseEnv
} from './env-schema.js';

describe('envBoolean', () => {
  const schema = envBoolean(false);

  it('parses true and false case-insensitively', () => {
    expect(schema.parse('true')).toBe(true);
    expect(schema.parse('FALSE')).toBe(false);
  });

  it('uses the default when unset or blank', () => {
    expect(schema.parse(undefined)).toBe(false);
    expect(schema.parse('  ')).toBe(false);
  });

  it('rejects other values', () => {
    expect(schema.safeParse('yes').success).toBe(false);
    expect(schema.safeParse('1').success).toBe(false);
  });
});

describe('envInteger', () => {
  const schema = envInteger(8, { max: 10 });

  it('parses a trimmed integer and uses the default when blank', () => {
    expect(schema.parse(' 4 ')).toBe(4);
    expect(schema.parse('')).toBe(8);
  });

  it('rejects non-integers and values out of range', () => {
    for (const value of ['1.5', '8x', '0', '11']) {
      expect(schema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('envOptionalInteger', () => {
  it('is undefined when unset', () => {
    expect(envOptionalInteger.parse(undefined)).toBeUndefined();
  });
});

describe('envUrl', () => {
  it('accepts http and https URLs and is undefined when blank', () => {
    expect(envUrl.parse(' https://trino.example.com:8443 ')).toBe('https://trino.example.com:8443');
    expect(envUrl.parse('')).toBeUndefined();
  });

  it('rejects values without an http or https scheme', () => {
    expect(envUrl.safeParse('trino.example.com:8443').success).toBe(false);
    expect(envUrl.safeParse('ftp://trino.example.com').success).toBe(false);
  });
});

describe('envList', () => {
  it('splits, trims and drops empty entries', () => {
    expect(envList(['a']).parse(' x , ,y ')).toEqual(['x', 'y']);
  });

  it('uses the default when unset', () => {
    expect(envList(['a']).parse(undefined)).toEqual(['a']);
  });
});

describe('parseEnv', () => {
  const schema = z.object({ A: envInteger(1), B: envBoolean(true) });

  it('returns the parsed values', () => {
    expect(parseEnv(schema, { A: '2' })).toEqual({ A: 2, B: true });
  });

  it('names every invalid variable in one error', () => {
    expect(() => parseEnv(schema, { A: 'x', B: 'y' })).toThrow(/A: .*\n- B: /s);
  });
});
