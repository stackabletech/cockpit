/**
 * Helpers for HDFS paths. Client-safe — no server-only code imported here.
 */

/**
 * Normalise an absolute HDFS base path: leading `/`, no duplicate or trailing
 * slashes. Returns `null` for relative paths and for `.` / `..` segments.
 */
export function normaliseHdfsBasePath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..')) return null;
  return '/' + segments.join('/');
}

/** Join an absolute base path and a relative key (directories end in `/`). */
export function joinHdfsPath(basePath: string, key: string): string {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const rel = key.endsWith('/') ? key.slice(0, -1) : key;
  if (!rel) return base || '/';
  return `${base}/${rel}`;
}
