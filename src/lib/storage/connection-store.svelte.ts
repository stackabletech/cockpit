/**
 * Client-side store for the active storage connection ID and the list of
 * saved connections returned by the server.
 *
 * This module is client-safe. It never imports server-only code.
 */

import { SvelteURL } from 'svelte/reactivity';

export interface ConnectionListItem {
  id: string;
  name: string;
  endpoint: string | null;
  additionalBuckets: string[];
  createdAt: string;
  updatedAt: string;
}

export function connectionHostname(connection: ConnectionListItem | null): string {
  if (!connection?.endpoint) return '';
  try {
    return new SvelteURL(
      connection.endpoint.includes('://') ? connection.endpoint : `//${connection.endpoint}`,
      'http://localhost'
    ).hostname;
  } catch {
    const endpoint = connection.endpoint;
    if (!endpoint.startsWith('[')) return endpoint;
    const closingBracket = endpoint.indexOf(']');
    if (closingBracket <= 1) return endpoint;
    const suffix = endpoint.slice(closingBracket + 1);
    const isPort =
      suffix.startsWith(':') &&
      suffix.length > 1 &&
      [...suffix.slice(1)].every((char) => char >= '0' && char <= '9');
    return suffix === '' || isPort ? endpoint.slice(1, closingBracket) : endpoint;
  }
}

class ConnectionStore {
  activeConnectionId = $state<string | null>(null);
  connections = $state<ConnectionListItem[]>([]);

  get activeConnection(): ConnectionListItem | null {
    return this.connections.find((c) => c.id === this.activeConnectionId) ?? null;
  }
}

export const connectionStore = new ConnectionStore();
