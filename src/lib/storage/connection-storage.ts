export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number | null;
  type: 's3';
  region: { name: string };
  credentials?: { accessKey: string; secretKey: string };
}
