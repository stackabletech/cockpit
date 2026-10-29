/**
 * Ids of the products a bookmark can point to; `custom` is a plain link. Kept
 * apart from `products.ts` so the server can validate ids without loading the
 * logos and messages.
 */
export const PRODUCT_IDS = [
  'trino',
  'superset',
  'airflow',
  'nifi',
  'druid',
  'opensearch',
  'hdfs',
  'hbase',
  'spark',
  'custom'
] as const;

export type ProductId = (typeof PRODUCT_IDS)[number];
