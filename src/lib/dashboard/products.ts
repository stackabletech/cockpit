import type { Picture } from '@sveltejs/enhanced-img';

export interface Product {
  id: string;
  name: string;
  initials: string;
  /** Brand colour, used as the background of the initials badge. */
  color: string;
  /** Text colour for the initials badge; chosen for WCAG AA contrast on `color`. */
  textColor: '#000000' | '#FFFFFF';
  logo: Picture | null;
  defaultName: string;
}

const logos = import.meta.glob<Picture>('../logos/*.png', {
  eager: true,
  import: 'default',
  query: { enhanced: true, imgWidth: '40' }
});

const LOGOS: Record<string, Picture> = {
  trino: logos['../logos/trino.png'],
  superset: logos['../logos/superset.png'],
  airflow: logos['../logos/airflow.png'],
  nifi: logos['../logos/nifi.png'],
  druid: logos['../logos/druid.png'],
  opensearch: logos['../logos/opensearch.png'],
  hdfs: logos['../logos/hdfs.png'],
  hbase: logos['../logos/hbase.png'],
  spark: logos['../logos/spark.png']
};

export const PRODUCTS: Product[] = [
  {
    id: 'trino',
    name: 'Trino',
    initials: 'TR',
    color: '#DD0031',
    textColor: '#FFFFFF',
    logo: LOGOS['trino'],
    defaultName: 'SQL Editor'
  },
  {
    id: 'superset',
    name: 'Superset',
    initials: 'SU',
    color: '#1FA7E0',
    textColor: '#000000',
    logo: LOGOS['superset'],
    defaultName: 'Dashboards'
  },
  {
    id: 'airflow',
    name: 'Airflow',
    initials: 'AF',
    color: '#017CEE',
    textColor: '#000000',
    logo: LOGOS['airflow'],
    defaultName: 'Pipelines'
  },
  {
    id: 'nifi',
    name: 'NiFi',
    initials: 'NF',
    color: '#728E2B',
    textColor: '#000000',
    logo: LOGOS['nifi'],
    defaultName: 'Data Flow'
  },
  {
    id: 'druid',
    name: 'Druid',
    initials: 'DR',
    color: '#29F1FB',
    textColor: '#000000',
    logo: LOGOS['druid'],
    defaultName: 'Analytics'
  },
  {
    id: 'opensearch',
    name: 'OpenSearch',
    initials: 'OS',
    color: '#005EB8',
    textColor: '#FFFFFF',
    logo: LOGOS['opensearch'],
    defaultName: 'Search'
  },
  {
    id: 'hdfs',
    name: 'HDFS',
    initials: 'HF',
    color: '#FEDB5F',
    textColor: '#000000',
    logo: LOGOS['hdfs'],
    defaultName: 'Storage'
  },
  {
    id: 'hbase',
    name: 'HBase',
    initials: 'HB',
    color: '#C02228',
    textColor: '#FFFFFF',
    logo: LOGOS['hbase'],
    defaultName: 'Database'
  },
  {
    id: 'spark',
    name: 'Spark',
    initials: 'SP',
    color: '#E25A1C',
    textColor: '#000000',
    logo: LOGOS['spark'],
    defaultName: 'Processing'
  },
  {
    id: 'custom',
    name: 'Custom Link',
    initials: 'CL',
    color: '#64748B',
    textColor: '#FFFFFF',
    logo: null,
    defaultName: ''
  }
];

export function getProduct(productId: string): Product {
  return PRODUCTS.find((product) => product.id === productId) ?? PRODUCTS[PRODUCTS.length - 1];
}
