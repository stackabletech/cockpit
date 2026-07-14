/**
 * Client-side store for the active storage connection ID and the list of
 * saved connections returned by the server.
 *
 * This module is client-safe. It never imports server-only code.
 */

export interface ConnectionListItem {
  id: string;
  name: string;
  endpoint: string | null;
  additionalBuckets: string[];
  createdAt: string;
  updatedAt: string;
}

class ConnectionStore {
  activeConnectionId = $state<string | null>(null);
  connections = $state<ConnectionListItem[]>([]);

  get activeConnection(): ConnectionListItem | null {
    return this.connections.find((c) => c.id === this.activeConnectionId) ?? null;
  }
}

export const connectionStore = new ConnectionStore();
