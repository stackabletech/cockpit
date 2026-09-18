import type { S3ConnectionConfig } from './types.js';

interface TokenEntry {
  config: S3ConnectionConfig;
  createdAt: number;
}

const tokens = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 30_000;

let lastCleanup = Date.now();

function cleanupExpired(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - TOKEN_TTL_MS;
  for (const [key, entry] of tokens) {
    if (entry.createdAt < cutoff) tokens.delete(key);
  }
}

export function createDownloadToken(config: S3ConnectionConfig): string {
  cleanupExpired();
  const token = crypto.randomUUID();
  tokens.set(token, { config, createdAt: Date.now() });
  return token;
}

export function consumeDownloadToken(token: string): S3ConnectionConfig | null {
  cleanupExpired();
  const entry = tokens.get(token);
  if (!entry) return null;
  tokens.delete(token);
  if (Date.now() - entry.createdAt > TOKEN_TTL_MS) return null;
  return entry.config;
}
