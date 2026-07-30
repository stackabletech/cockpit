export interface Product {
  id: string;
  name: string;
  initials: string;
  color: string;
  logoPath: string | null;
  defaultName: string;
}

export const PRODUCTS: Product[] = [
  {
    id: 'trino',
    name: 'Trino',
    initials: 'TR',
    color: '#DD0031',
    logoPath: '/logos/trino.png',
    defaultName: 'SQL Editor'
  },
  {
    id: 'superset',
    name: 'Superset',
    initials: 'SU',
    color: '#1FA7E0',
    logoPath: '/logos/superset.png',
    defaultName: 'Dashboards'
  },
  {
    id: 'airflow',
    name: 'Airflow',
    initials: 'AF',
    color: '#017CEE',
    logoPath: '/logos/airflow.png',
    defaultName: 'Pipelines'
  },
  {
    id: 'nifi',
    name: 'NiFi',
    initials: 'NF',
    color: '#728E2B',
    logoPath: '/logos/nifi.png',
    defaultName: 'Data Flow'
  },
  {
    id: 'kafka',
    name: 'Kafka',
    initials: 'KF',
    color: '#231F20',
    logoPath: '/logos/kafka.png',
    defaultName: 'Event Stream'
  },
  {
    id: 'druid',
    name: 'Druid',
    initials: 'DR',
    color: '#29F1FB',
    logoPath: '/logos/druid.png',
    defaultName: 'Analytics'
  },
  {
    id: 'opensearch',
    name: 'OpenSearch',
    initials: 'OS',
    color: '#005EB8',
    logoPath: '/logos/opensearch.png',
    defaultName: 'Search'
  },
  {
    id: 'hdfs',
    name: 'HDFS',
    initials: 'HF',
    color: '#FEDB5F',
    logoPath: '/logos/hdfs.png',
    defaultName: 'Storage'
  },
  {
    id: 'hbase',
    name: 'HBase',
    initials: 'HB',
    color: '#C02228',
    logoPath: '/logos/hbase.png',
    defaultName: 'Database'
  },
  {
    id: 'spark',
    name: 'Spark',
    initials: 'SP',
    color: '#E25A1C',
    logoPath: '/logos/spark.png',
    defaultName: 'Processing'
  },
  {
    id: 'zookeeper',
    name: 'ZooKeeper',
    initials: 'ZK',
    color: '#314D45',
    logoPath: '/logos/zookeeper.png',
    defaultName: 'Coordinator'
  },
  {
    id: 'hive',
    name: 'Hive',
    initials: 'HV',
    color: '#FDEE21',
    logoPath: '/logos/hive.png',
    defaultName: 'Warehouse'
  },
  {
    id: 'opa',
    name: 'OPA',
    initials: 'OP',
    color: '#7D56F4',
    logoPath: '/logos/openpolicyagent.png',
    defaultName: 'Policy'
  },
  {
    id: 'custom',
    name: 'Custom Link',
    initials: 'CL',
    color: '#64748B',
    logoPath: null,
    defaultName: ''
  }
];
