/** Minimal storage connection metadata safe to expose to client components. */
export interface ConnectionMetadata {
  id: string;
  name: string;
  endpoint: string | null;
}
