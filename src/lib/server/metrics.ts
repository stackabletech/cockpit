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
  labelNames: ['outcome', 'truncated'],
  registers: [register]
});

export const storageSearchHistoryTotal = new Counter({
  name: 'storage_search_history_total',
  help: 'Recent storage search history operations executed through the Stackable UI',
  labelNames: ['operation', 'outcome'],
  registers: [register]
});
