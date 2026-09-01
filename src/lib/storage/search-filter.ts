/**
 * Date / size filter parsing and matching for storage searches.
 *
 * This module is intentionally free of any server or client dependencies (only
 * plain TypeScript) so that it can be shared by:
 *   • the search UI (src/lib/components/storage/*)
 *   • the search API endpoint (src/routes/(app)/api/storage/search/+server.ts)
 *
 * Sizes are always expressed in megabytes: a bare number is interpreted as MB
 * (an explicit `MB` / `MiB` suffix is accepted for clarity) and both "." and ","
 * are accepted as decimal separators. The date parser accepts ISO (YYYY-MM-DD),
 * European (DD.MM.YYYY) and US (MM/DD/YYYY) notations plus an optional time
 * component.
 */

export type SearchFilterField = 'date' | 'size';
export type SearchFilterOperator = '>' | '=' | '<';

/** The operator options shown in the filter input dropdown, in order. */
export const FILTER_OPERATORS: readonly SearchFilterOperator[] = ['>', '=', '<'];

/** A single filter row stored on a search session. */
export interface SearchFilter {
  id: string;
  field: SearchFilterField;
  operator: SearchFilterOperator;
  value: string;
}

/** Transport form of a filter without the UI-only row id. */
export type SearchFilterSpec = Omit<SearchFilter, 'id'>;

/** Minimal shape needed to evaluate the filters against. */
export interface FilterableItem {
  size: number;
  lastModified: Date;
  /** Whether the item is a directory. Size filters never match directories. */
  isDirectory?: boolean;
}

// ── Size parsing ─────────────────────────────────────────────────────────────

/** One megabyte in bytes — the only unit used for size filters. */
const MB = 1024 ** 2;

/**
 * Parse a size filter value such as "1.5", "1,5 MB" or "3 MiB" into bytes.
 * Sizes are always expressed in megabytes; a bare number is interpreted as MB
 * and both "." and "," are accepted as the decimal separator. Any other unit
 * (KB, GB, …) is rejected. Returns null when the input cannot be parsed.
 */
export function parseSizeInput(input: string): number | null {
  const match = /^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]*)$/.exec(input.trim());
  if (!match) return null;
  const [, numberPart, unitRaw] = match;
  const value = Number(numberPart.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = unitRaw.toLowerCase();
  if (unit !== '' && unit !== 'm' && unit !== 'mb' && unit !== 'mib') return null;
  return Math.round(value * MB);
}

// ── Date parsing ─────────────────────────────────────────────────────────────

export interface ParseDateOptions {
  /**
   * Whether an ambiguous `A/B/YYYY` value (both parts ≤ 12) should be read as
   * day-first (European) rather than month-first (US). Defaults to true.
   */
  preferDayFirst?: boolean;
}

const DATE_PART_RE = /^(?:(\d{1,4})([./-]))?(\d{1,2})\2?(\d{1,4})$/;

/**
 * Parse a date string into a local `Date`, accepting:
 *   • ISO / year-first: 2026-08-17, 2026/08/17, 2026.08.17
 *   • European:         17.08.2026, 17/08/2026, 17-08-2026
 *   • US:               08/17/2026, 08-17-2026
 * An optional time component (` HH:mm` or `THH:mm`) is also accepted.
 * Returns null when the value is not a valid date.
 */
export function parseDateInput(input: string, options: ParseDateOptions = {}): Date | null {
  const trimmed = input.trim();
  const parts = trimmed.split(/[T ]/);
  if (parts.length === 0 || parts.length > 2) return null;
  const datePart = parts[0];
  const timePart = parts[1];

  const groups = DATE_PART_RE.exec(datePart);
  if (!groups) return null;

  let year: number;
  let month: number;
  let day: number;

  if (groups[1] !== undefined && groups[1].length === 4) {
    // YYYY-…-…
    year = Number(groups[1]);
    month = Number(groups[3]);
    day = Number(groups[4]);
  } else {
    const a = Number(groups[1] ?? groups[3]);
    const b = Number(groups[3]);
    if (groups[4].length !== 4) return null;
    year = Number(groups[4]);

    // Determine day/month order. Non-numeric grouping cannot occur: the regex
    // guarantees three numeric components, with a separator between them.
    if (a > 12 && b <= 12) {
      // First component must be the day.
      day = a;
      month = b;
    } else if (a <= 12 && b > 12) {
      // Second component must be the day; first is the month (US style).
      day = b;
      month = a;
    } else {
      // Ambiguous — honour the caller's preference (day-first by default).
      if (options.preferDayFirst !== false) {
        day = a;
        month = b;
      } else {
        day = b;
        month = a;
      }
    }
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (year < 1) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (timePart !== undefined) {
    const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timePart);
    if (timeMatch === null) return null;
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
    seconds = timeMatch[3] === undefined ? 0 : Number(timeMatch[3]);
    if (hours > 23 || minutes > 59 || seconds > 59) return null;
  }

  const parsed = new Date(year, month - 1, day, hours, minutes, seconds, 0);
  // Reject invalid calendar dates such as 30 February.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/** Format a Date as an ISO-style date string (YYYY-MM-DD, local time). */
export function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── Serialisation ────────────────────────────────────────────────────────────

/** Serialise a filter to a single `filter=` query parameter value. */
export function serializeFilter(spec: SearchFilterSpec): string {
  return `${spec.field}${spec.operator}${spec.value}`;
}

/** Parse a `filter=<field><operator><value>` query parameter value. */
export function parseFilterParam(raw: string): SearchFilterSpec | null {
  const match = /^(date|size)([><=])(.+)$/.exec(raw);
  if (!match) return null;
  return {
    field: match[1] as SearchFilterField,
    operator: match[2] as SearchFilterOperator,
    value: match[3]
  };
}

// ── Per-field parsing helpers ────────────────────────────────────────────────

/** Parse the value of a size filter into bytes (null when invalid). */
export function parseSizeFilterValue(spec: Pick<SearchFilterSpec, 'value'>): number | null {
  return parseSizeInput(spec.value);
}

/** Parse the value of a date filter into a Date (null when invalid). */
export function parseDateFilterValue(
  spec: Pick<SearchFilterSpec, 'value'>,
  options?: ParseDateOptions
): Date | null {
  return parseDateInput(spec.value, options);
}

/**
 * True when the filter has a typed value that actually filters something
 * without being flagged as invalid in the UI.
 */
export function isUsableFilter(spec: SearchFilterSpec): boolean {
  return spec.field === 'size'
    ? parseSizeFilterValue(spec) !== null
    : parseDateFilterValue(spec) !== null;
}

// ── Matching ─────────────────────────────────────────────────────────────────

function compareSize(actual: number, target: number, operator: SearchFilterOperator): boolean {
  if (operator === '>') return actual > target;
  if (operator === '<') return actual < target;
  return actual === target;
}

/**
 * Compile a list of filter specifications into a single predicate. All
 * specified filters must match (logical AND). Filters whose value is empty or
 * cannot be parsed are skipped, so callers may pass user-provided rows freely.
 * As soon as a usable size filter is present, directories are excluded: folder
 * entries have no well-defined size and must not satisfy size constraints.
 */
export function compileFilterPredicates(
  specs: SearchFilterSpec[]
): (item: FilterableItem) => boolean {
  const predicates: Array<(item: FilterableItem) => boolean> = [];
  let hasSizeFilter = false;

  for (const spec of specs) {
    if (spec.field === 'size') {
      const target = parseSizeFilterValue(spec);
      if (target === null) continue;
      hasSizeFilter = true;
      predicates.push((item) => compareSize(item.size, target, spec.operator));
      continue;
    }
    const date = parseDateFilterValue(spec);
    if (date === null) continue;
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const startTime = start.getTime();
    const endTime = end.getTime();
    const { operator } = spec;
    predicates.push((item) => {
      const time = item.lastModified.getTime();
      if (operator === '=') return time >= startTime && time < endTime;
      if (operator === '>') return time >= endTime;
      return time < startTime;
    });
  }

  if (hasSizeFilter) {
    predicates.push((item) => item.isDirectory !== true);
  }

  if (predicates.length === 0) return () => true;
  return (item) => predicates.every((predicate) => predicate(item));
}
