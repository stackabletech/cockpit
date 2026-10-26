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
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: the optional fraction must start with [.,]
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

// eslint-disable-next-line security/detect-unsafe-regex -- bounded repetition only
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
  const parts = parseDateParts(input, options);
  if (parts === null) return null;
  const { year, month, day, hours, minutes, seconds } = parts;
  return new Date(year, month - 1, day, hours, minutes, seconds, 0);
}

/** Wall-clock date and time components of a parsed date filter value. */
interface DateParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function parseDateParts(input: string, options: ParseDateOptions): DateParts | null {
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
  // Date.UTC maps years 0–99 to 1900–1999.
  if (year < 100) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (timePart !== undefined) {
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded repetition only
    const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timePart);
    if (timeMatch === null) return null;
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
    seconds = timeMatch[3] === undefined ? 0 : Number(timeMatch[3]);
    if (hours > 23 || minutes > 59 || seconds > 59) return null;
  }

  // Reject invalid calendar dates such as 30 February.
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, hours, minutes, seconds };
}

/**
 * Convert wall-clock time in an IANA time zone to a UTC timestamp. Without a
 * time zone, the runtime's local time zone is used.
 */
function wallClockToTime(parts: DateParts, timeZone?: string): number {
  const { year, month, day, hours, minutes, seconds } = parts;
  if (timeZone === undefined) {
    return new Date(year, month - 1, day, hours, minutes, seconds, 0).getTime();
  }
  const wallClock = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  // Correct by the zone's offset, then once more in case the first guess
  // landed on the other side of a DST transition.
  const firstGuess = wallClock - timeZoneOffset(wallClock, timeZone);
  return wallClock - timeZoneOffset(firstGuess, timeZone);
}

/** Offset of a time zone from UTC at the given instant, in milliseconds. */
function timeZoneOffset(time: number, timeZone: string): number {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
      .formatToParts(new Date(time))
      .map((part) => [part.type, Number(part.value)])
  );
  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  );
  return asUtc - (time - (((time % 1000) + 1000) % 1000));
}

/** True when the value is an IANA time zone name known to the runtime. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
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
 * Date values are interpreted as wall-clock time in `timeZone` (the user's
 * zone), falling back to the runtime's local time zone.
 */
export function compileFilterPredicates(
  specs: SearchFilterSpec[],
  timeZone?: string
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
    const parts = parseDateParts(spec.value, {});
    if (parts === null) continue;
    const timePart = spec.value.trim().split(/[T ]/)[1];
    if (timePart !== undefined) {
      const time = wallClockToTime(parts, timeZone);
      // "=" matches the whole minute (or second, when given), like a date-only
      // value matches the whole day; "<" and ">" compare to the exact instant.
      const end = time + (timePart.split(':').length === 3 ? 1000 : 60_000);
      const { operator } = spec;
      predicates.push((item) => {
        const actual = item.lastModified.getTime();
        if (operator === '=') return actual >= time && actual < end;
        return compareSize(actual, time, operator);
      });
      continue;
    }
    const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    const startTime = wallClockToTime({ ...parts, hours: 0, minutes: 0, seconds: 0 }, timeZone);
    const endTime = wallClockToTime(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
        hours: 0,
        minutes: 0,
        seconds: 0
      },
      timeZone
    );
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
