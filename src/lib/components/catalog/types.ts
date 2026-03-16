export type TreeNode = {
  name: string;
  type: 'catalog' | 'schema' | 'table' | 'view' | 'column';
  dataType?: string;
  children?: TreeNode[];
  loading?: boolean;
  error?: boolean;
};
