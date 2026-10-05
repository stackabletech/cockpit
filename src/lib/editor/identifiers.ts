/**
 * Shared Trino identifier utilities.
 */

/**
 * Regex for "simple" identifiers that don't require quoting in Trino.
 * Letters, digits and underscores, not starting with a digit.
 */
export const SIMPLE_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Wrap a name in double quotes, escaping embedded quotes (" -> "").
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Quote a name only if Trino would not accept it unquoted (e.g. `my-schema`).
 */
export function formatIdentifier(name: string): string {
  return SIMPLE_IDENTIFIER_REGEX.test(name) ? name : quoteIdentifier(name);
}

/**
 * Render a value as a SQL string literal, escaping embedded single quotes.
 */
export function quoteStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

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
