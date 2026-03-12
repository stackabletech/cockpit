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
  help: 'Total Trino queries submitted through the proxy',
  labelNames: ['outcome'],
  registers: [register]
});

export const trinoActiveQueries = new Gauge({
  name: 'trino_active_queries',
  help: 'Number of currently running Trino queries',
  registers: [register]
});
