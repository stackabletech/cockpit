// Parses a successfully-executed SQL statement to detect DDL that alters
// catalog metadata, then drops the affected entries from the per-user
// metadata cache so completion sees fresh data immediately.

import type { Token } from 'antlr4ng';
import { SqlBaseLexer } from '$lib/editor/generated/SqlBaseLexer.js';
import { lexNonHidden, readQualifiedName } from '$lib/editor/lexer-utils.js';
import { logger } from '$lib/server/logging';
import { invalidate } from './metadata-cache.js';

const log = logger.child({ module: 'trino-ddl-invalidation' });

function skipIfMatches(tokens: Token[], i: number, types: number[]): number {
  for (const type of types) {
    if (tokens[i]?.type !== type) return i;
    i++;
  }
  return i;
}

function resolveQualified(
  parts: string[],
  defaultCatalog: string | undefined,
  defaultSchema: string | undefined
): { catalog?: string; schema?: string; name?: string } {
  if (parts.length === 3) return { catalog: parts[0], schema: parts[1], name: parts[2] };
  if (parts.length === 2) return { catalog: defaultCatalog, schema: parts[0], name: parts[1] };
  if (parts.length === 1) return { catalog: defaultCatalog, schema: defaultSchema, name: parts[0] };
  return {};
}

type Target =
  | { kind: 'schema'; catalog?: string; name?: string }
  | { kind: 'table' | 'view'; catalog?: string; schema?: string; name?: string }
  | { kind: 'column'; catalog?: string; schema?: string; table?: string };

/** Detect DDL and return the cache prefixes that should be dropped, or null. */
export function detectDdlInvalidation(
  sql: string,
  defaultCatalog: string | undefined,
  defaultSchema: string | undefined
): Target | null {
  const tokens = lexNonHidden(sql);
  if (tokens.length === 0) return null;

  const t0 = tokens[0].type;

  // CREATE/DROP/ALTER/RENAME SCHEMA [IF (NOT)? EXISTS] qualifiedName
  if (t0 === SqlBaseLexer.CREATE || t0 === SqlBaseLexer.DROP || t0 === SqlBaseLexer.ALTER) {
    let i = 1;
    // CREATE OR REPLACE ...
    if (tokens[i]?.type === SqlBaseLexer.OR && tokens[i + 1]?.type === SqlBaseLexer.REPLACE) i += 2;

    const kind = tokens[i]?.type;
    if (kind === SqlBaseLexer.SCHEMA) {
      i++;
      i = skipIfMatches(tokens, i, [SqlBaseLexer.IF, SqlBaseLexer.NOT, SqlBaseLexer.EXISTS]);
      i = skipIfMatches(tokens, i, [SqlBaseLexer.IF, SqlBaseLexer.EXISTS]);
      const { parts } = readQualifiedName(tokens, i);
      const r = resolveQualified(parts, defaultCatalog, undefined);
      return { kind: 'schema', catalog: r.catalog ?? r.schema, name: r.name };
    }

    if (
      kind === SqlBaseLexer.TABLE ||
      kind === SqlBaseLexer.VIEW ||
      (kind === SqlBaseLexer.MATERIALIZED && tokens[i + 1]?.type === SqlBaseLexer.VIEW)
    ) {
      if (kind === SqlBaseLexer.MATERIALIZED) i++;
      i++;
      i = skipIfMatches(tokens, i, [SqlBaseLexer.IF, SqlBaseLexer.NOT, SqlBaseLexer.EXISTS]);
      i = skipIfMatches(tokens, i, [SqlBaseLexer.IF, SqlBaseLexer.EXISTS]);

      const { parts, next } = readQualifiedName(tokens, i);
      const target = resolveQualified(parts, defaultCatalog, defaultSchema);

      // ALTER TABLE … ADD/DROP/RENAME COLUMN → invalidate columns of the table
      if (t0 === SqlBaseLexer.ALTER && kind === SqlBaseLexer.TABLE) {
        const sub = tokens[next]?.type;
        const subNext = tokens[next + 1]?.type;
        if (
          (sub === SqlBaseLexer.ADD || sub === SqlBaseLexer.DROP || sub === SqlBaseLexer.RENAME) &&
          subNext === SqlBaseLexer.COLUMN
        ) {
          return {
            kind: 'column',
            catalog: target.catalog,
            schema: target.schema,
            table: target.name
          };
        }
      }

      return {
        kind: kind === SqlBaseLexer.VIEW || kind === SqlBaseLexer.MATERIALIZED ? 'view' : 'table',
        catalog: target.catalog,
        schema: target.schema,
        name: target.name
      };
    }
  }

  return null;
}

/** Convenience: detect + invalidate, with logging. */
export function invalidateForStatement(
  userId: string,
  sql: string,
  defaultCatalog: string | undefined,
  defaultSchema: string | undefined
): void {
  let target: Target | null;
  try {
    target = detectDdlInvalidation(sql, defaultCatalog, defaultSchema);
  } catch (err) {
    log.warn({ err, user_id: userId }, 'DDL detection failed');
    return;
  }
  if (!target) return;

  const prefixes: string[] = [];
  if (target.kind === 'schema') {
    if (target.catalog) {
      // Changing a schema affects the schemas list for its catalog, plus any
      // cached tables/columns under that catalog. Drop broadly — cheap.
      prefixes.push(`schemas:${target.catalog}`);
      prefixes.push(`tables:${target.catalog}.`);
      prefixes.push(`columns:${target.catalog}.`);
    } else {
      // Unknown catalog: clear everything schema-level as a safe fallback.
      prefixes.push('schemas:', 'tables:', 'columns:');
    }
  } else if (target.kind === 'table' || target.kind === 'view') {
    if (target.catalog && target.schema) {
      prefixes.push(`tables:${target.catalog}.${target.schema}`);
      prefixes.push(`columns:${target.catalog}.${target.schema}.`);
    } else {
      prefixes.push('tables:', 'columns:');
    }
  } else if (target.kind === 'column') {
    if (target.catalog && target.schema && target.table) {
      prefixes.push(`columns:${target.catalog}.${target.schema}.${target.table}`);
    } else {
      prefixes.push('columns:');
    }
  }

  if (prefixes.length > 0) {
    log.debug({ user_id: userId, target, prefixes }, 'DDL detected — invalidating cache');
    invalidate(userId, ...prefixes);
  }
}
