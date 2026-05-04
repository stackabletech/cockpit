/**
 * Shared Trino identifier utilities.
 */

/**
 * Regex for "simple" identifiers that don't require quoting in Trino.
 * Includes alphanumeric and underscores.
 */
export const SIMPLE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]+$/;

/**
 * Strip matching double-quotes or backticks around a quoted identifier,
 * also collapsing the SQL-style doubled-quote escape ("" -> ", `` -> `).
 */
export function unquoteIdentifier(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  const isQuoted = (first === '"' && last === '"') || (first === '`' && last === '`');
  if (!isQuoted) return text;
  return text.slice(1, -1).replaceAll(first + first, first);
}
