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

export const opaRequestDuration = new Histogram({
  name: 'opa_request_duration_seconds',
  help: 'Duration of OPA policy evaluation requests in seconds',
  labelNames: ['outcome'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1.0],
  registers: [register]
});

export const opaRequestTotal = new Counter({
  name: 'opa_request_total',
  help: 'Total OPA policy evaluation requests',
  labelNames: ['outcome'],
  registers: [register]
});
