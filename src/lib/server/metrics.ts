import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.25, 1.0],
  registers: [register]
});

export const trinoQueryTotal = new Counter({
  name: 'trino_query_total',
  help: 'Total Trino queries submitted through Stackable UI',
  labelNames: ['outcome'],
  registers: [register]
});

export const trinoActiveQueries = new Gauge({
  name: 'trino_active_queries',
  help: 'Number of active Trino queries submitted through Stackable UI',
  registers: [register]
});

export const storageSearchTotal = new Counter({
  name: 'storage_search_total',
  help: 'Bucket-scoped storage searches executed through the Stackable UI',
  labelNames: ['outcome'],
  registers: [register]
});

export const storageSearchHistoryTotal = new Counter({
  name: 'storage_search_history_total',
  help: 'Recent storage search history operations executed through the Stackable UI',
  labelNames: ['operation', 'outcome'],
  registers: [register]
});

export const storageTransferItemsTotal = new Counter({
  name: 'storage_transfer_items_total',
  help: 'Selected items of storage copy, move and rename transfers, by final status',
  labelNames: ['op', 'status'],
  registers: [register]
});

export const storageTransferDuration = new Histogram({
  name: 'storage_transfer_duration_seconds',
  help: 'Duration of storage copy, move and rename transfers in seconds',
  labelNames: ['op'],
  buckets: [1, 10, 60, 300, 1800],
  registers: [register]
});

export const storageArchiveCacheBytes = new Gauge({
  name: 'storage_archive_cache_bytes',
  help: 'Bytes of archive files cached on local disk for archive previews',
  registers: [register]
});

export const storageArchiveCacheEvictionsTotal = new Counter({
  name: 'storage_archive_cache_evictions_total',
  help: 'Archive files removed from the local archive preview cache, by reason',
  labelNames: ['reason'],
  registers: [register]
});
