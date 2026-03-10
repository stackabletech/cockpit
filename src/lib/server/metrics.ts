import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

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
