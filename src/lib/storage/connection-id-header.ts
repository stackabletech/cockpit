/**
 * HTTP header name used to pass the S3 connection UUID from the browser to
 * the backend API endpoints. Client-safe — no server-only code imported here.
 *
 * The server middleware looks up the connection by this ID and the
 * authenticated user ID, then decrypts the stored credentials.
 */
export const STORAGE_CONNECTION_ID_HEADER = 'x-storage-connection-id';

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number | null;
  type: 's3';
  region: { name: string };
  credentials?: { accessKey: string; secretKey: string };
}
