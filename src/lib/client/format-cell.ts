/**
 * Formats a table cell from an untyped result row (Trino, CSV/Parquet preview) as text.
 * Objects and arrays are shown as JSON instead of `[object Object]`.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  // JSON.stringify returns undefined for functions and symbols.
  return JSON.stringify(value) ?? '';
}
