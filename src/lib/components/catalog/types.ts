export type TreeNode = {
  name: string;
  type: 'catalog' | 'schema' | 'table' | 'view' | 'materialized_view' | 'column';
  dataType?: string;
  children?: TreeNode[];
  loading?: boolean;
  error?: boolean;
};
