import type { Picture } from '@sveltejs/enhanced-img';

export interface Product {
  id: string;
  name: string;
  initials: string;
  color: string;
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
    logo: LOGOS['trino'],
    defaultName: 'SQL Editor'
  },
  {
    id: 'superset',
    name: 'Superset',
    initials: 'SU',
    color: '#1FA7E0',
    logo: LOGOS['superset'],
    defaultName: 'Dashboards'
  },
  {
    id: 'airflow',
    name: 'Airflow',
    initials: 'AF',
    color: '#017CEE',
    logo: LOGOS['airflow'],
    defaultName: 'Pipelines'
  },
  {
    id: 'nifi',
    name: 'NiFi',
    initials: 'NF',
    color: '#728E2B',
    logo: LOGOS['nifi'],
    defaultName: 'Data Flow'
  },
  {
    id: 'druid',
    name: 'Druid',
    initials: 'DR',
    color: '#29F1FB',
    logo: LOGOS['druid'],
    defaultName: 'Analytics'
  },
  {
    id: 'opensearch',
    name: 'OpenSearch',
    initials: 'OS',
    color: '#005EB8',
    logo: LOGOS['opensearch'],
    defaultName: 'Search'
  },
  {
    id: 'hdfs',
    name: 'HDFS',
    initials: 'HF',
    color: '#FEDB5F',
    logo: LOGOS['hdfs'],
    defaultName: 'Storage'
  },
  {
    id: 'hbase',
    name: 'HBase',
    initials: 'HB',
    color: '#C02228',
    logo: LOGOS['hbase'],
    defaultName: 'Database'
  },
  {
    id: 'spark',
    name: 'Spark',
    initials: 'SP',
    color: '#E25A1C',
    logo: LOGOS['spark'],
    defaultName: 'Processing'
  },
  {
    id: 'custom',
    name: 'Custom Link',
    initials: 'CL',
    color: '#64748B',
    logo: null,
    defaultName: ''
  }
];

export function getProduct(productId: string): Product {
  return PRODUCTS.find((product) => product.id === productId) ?? PRODUCTS[PRODUCTS.length - 1];
}

export function handleProductLogoError(event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  image.style.display = 'none';

  const fallback = image.nextElementSibling;
  if (fallback) {
    fallback.classList.remove('hidden');
    fallback.classList.add('flex');
  }
}
