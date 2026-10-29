// zod building blocks for configuration read from environment variables.
// Kept free of SvelteKit and server imports: both client and server config use it.

import { z } from 'zod';

type Env = Record<string, string | undefined>;

/** Treats an empty or whitespace-only value like an unset variable. */
function blankAsUnset(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** `true` or `false` (case-insensitive). */
export function envBoolean(defaultValue: boolean) {
  return z.preprocess(
    blankAsUnset,
    z.stringbool({ truthy: ['true'], falsy: ['false'] }).default(defaultValue)
  );
}

/** An integer within `min` and `max`. */
export function envInteger(
  defaultValue: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}
) {
  return z.preprocess(
    blankAsUnset,
    z.coerce.number().int().min(min).max(max).default(defaultValue)
  );
}

/** A positive integer, or `undefined` when unset. */
export const envOptionalInteger = z.preprocess(
  blankAsUnset,
  z.coerce.number().int().positive().optional()
);

/** A trimmed string, or `undefined` when unset. */
export const envString = z.preprocess(blankAsUnset, z.string().optional());

/** A list of non-empty entries separated by `separator`. */
export function envList(defaultValue: string[], separator: RegExp | string = ',') {
  return z.preprocess(
    blankAsUnset,
    z
      .string()
      .transform((value) =>
        value
          .split(separator)
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
      .default(defaultValue)
  );
}

/**
 * Parses `env` with `schema`. Throws one error that names every invalid
 * variable, so a misconfigured deployment fails at startup with all problems
 * listed instead of falling back to defaults.
 */
export function parseEnv<T extends z.ZodType>(schema: T, env: Env): z.output<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    return name ? `${name}: ${issue.message}` : issue.message;
  });
  throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
}
