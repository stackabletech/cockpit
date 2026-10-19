/**
 * Insert a ` (n)` copy number into the last segment of a storage key, leaving
 * every parent folder segment untouched.
 *
 * - Folders (trailing `/`) get the number at the end: `v1.2/` → `v1.2 (1)/`.
 * - Files get it before the last extension: `report.v2.csv` → `report.v2 (1).csv`,
 *   `archive.tar.gz` → `archive.tar (1).gz`.
 * - A leading dot is not an extension: `.env` → `.env (1)`.
 *
 * Shared by the server (copy/move conflicts) and the client (create) so both
 * name duplicates the same way.
 */
export function numberedName(key: string, counter: number): string {
  const isFolder = key.endsWith('/');
  const path = isFolder ? key.slice(0, -1) : key;
  const nameStart = path.lastIndexOf('/') + 1;
  const name = path.slice(nameStart);
  const dot = isFolder ? -1 : name.lastIndexOf('.');
  const extensionStart = dot > 0 ? dot : name.length;
  return (
    path.slice(0, nameStart) +
    `${name.slice(0, extensionStart)} (${counter})${name.slice(extensionStart)}` +
    (isFolder ? '/' : '')
  );
}
