import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import StorageConnectForm from './StorageConnectForm.svelte';

// Mock feature flags to disable auto-connect
vi.mock('$lib/client/feature-flags.js', () => ({
  storageAutoConnectEnabled: false
}));

// Mock connection-storage module
vi.mock('$lib/storage/connection-storage.js', () => ({
  saveConnectionLocally: vi.fn(),
  loadConnectionLocally: vi.fn(() => null),
  loadAllConnectionsLocally: vi.fn(() => []),
  removeConnectionLocally: vi.fn()
}));

// Mock paraglide messages
vi.mock('$lib/paraglide/messages.js', () => ({
  storage_connect_title: () => 'Connect to Storage',
  storage_connect_subtitle: () => 'Enter your connection details',
  storage_connect_reconnecting: () => 'Reconnecting...',
  storage_connect_saved: () => 'Saved connections',
  storage_connect_no_saved: () => 'No saved connections yet',
  storage_connect_type: () => 'Backend type',
  storage_connect_type_s3: () => 'Amazon S3',
  storage_connect_type_hdfs: () => 'HDFS',
  storage_connect_endpoint: () => 'Endpoint URL',
  storage_connect_endpoint_placeholder: () => 'https://s3.example.com',
  storage_connect_endpoint_hint: () => 'Leave empty for AWS S3',
  storage_connect_path_style: () => 'Path-style addressing',
  storage_connect_path_style_hint: () => 'Use path-style URLs',
  storage_connect_region: () => 'Region',
  storage_connect_access_key: () => 'Access key ID',
  storage_connect_secret_key: () => 'Secret access key',
  storage_connect_submit: () => 'Connect',
  storage_connect_forget_label: ({ endpoint }: { endpoint: string }) => `Forget ${endpoint}`,
  storage_connect_forget_confirm: ({ endpoint }: { endpoint: string }) =>
    `Forget connection to ${endpoint}?`,
  storage_connect_forget_cancel: () => 'Cancel',
  storage_connect_forget: () => 'Forget'
}));

function createMockForm(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    posted: false,
    errors: {},
    data: {
      type: 's3' as const,
      endpoint: '',
      pathStyle: true,
      region: 'eu-central-1',
      accessKeyId: '',
      secretAccessKey: ''
    },
    id: 'test-form',
    constraints: {},
    shape: {},
    message: undefined,
    tainted: undefined,
    ...overrides
  };
}

describe('StorageConnectForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the form title and subtitle', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect.element(page.getByText('Connect to Storage')).toBeInTheDocument();
    await expect.element(page.getByText('Enter your connection details')).toBeInTheDocument();
  });

  it('should render all form fields with labels', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect.element(page.getByLabelText('Backend type')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Endpoint URL')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Path-style addressing')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Region')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Access key ID')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Secret access key')).toBeInTheDocument();
  });

  it('should render backend type as a select with S3 option', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    const select = page.getByLabelText('Backend type');
    await expect.element(select).toBeInTheDocument();
    await expect.element(page.getByText('Amazon S3')).toBeInTheDocument();
    await expect.element(page.getByText('HDFS')).toBeInTheDocument();
  });

  it('should render endpoint as url input', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    const input = page.getByLabelText('Endpoint URL');
    await expect.element(input).toHaveAttribute('type', 'url');
  });

  it('should render path-style as a checkbox', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    const toggle = page.getByLabelText('Path-style addressing');
    await expect.element(toggle).toHaveAttribute('type', 'checkbox');
  });

  it('should render secret access key as password input', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    const input = page.getByLabelText('Secret access key');
    await expect.element(input).toHaveAttribute('type', 'password');
  });

  it('should render connect button', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect.element(page.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('should show no saved connections message when none exist', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect.element(page.getByText('No saved connections yet')).toBeInTheDocument();
  });

  it('should show saved connections when present', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      {
        type: 's3',
        endpoint: 'https://minio.example.com',
        pathStyle: true,
        region: 'us-east-1',
        accessKeyId: 'AKIA123',
        secretAccessKey: 'secret'
      }
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect.element(page.getByText('minio.example.com')).toBeInTheDocument();
  });

  it('should show forget button for saved connections', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      {
        type: 's3',
        endpoint: 'https://s3.test.io',
        pathStyle: true,
        region: 'eu-west-1',
        accessKeyId: '',
        secretAccessKey: ''
      }
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect
      .element(page.getByRole('button', { name: 'Forget s3.test.io' }))
      .toBeInTheDocument();
  });

  it('should open forget confirmation dialog when forget button clicked', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      {
        type: 's3',
        endpoint: 'https://s3.remove.io',
        pathStyle: true,
        region: 'eu-west-1',
        accessKeyId: '',
        secretAccessKey: ''
      }
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    const forgetBtn = page.getByRole('button', { name: 'Forget s3.remove.io' });
    await forgetBtn.click();

    await expect.element(page.getByText('Forget connection to s3.remove.io?')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Forget', exact: true }))
      .toBeInTheDocument();
  });

  it('should show multiple saved connections', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      {
        type: 's3',
        endpoint: 'https://first.example.com',
        pathStyle: true,
        region: 'us-east-1',
        accessKeyId: '',
        secretAccessKey: ''
      },
      {
        type: 's3',
        endpoint: 'https://second.example.com',
        pathStyle: false,
        region: 'eu-west-1',
        accessKeyId: faker.string.alphanumeric(20),
        secretAccessKey: faker.string.alphanumeric(40)
      },
      {
        type: 's3',
        endpoint: '',
        pathStyle: false,
        region: 'us-west-2',
        accessKeyId: '',
        secretAccessKey: ''
      }
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect.element(page.getByText('first.example.com')).toBeInTheDocument();
    await expect.element(page.getByText('second.example.com')).toBeInTheDocument();
    await expect.element(page.getByText('AWS S3', { exact: true })).toBeInTheDocument();
  });

  it('should render saved connections in a list role', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      {
        type: 's3',
        endpoint: 'https://listed.example.com',
        pathStyle: true,
        region: 'us-east-1',
        accessKeyId: '',
        secretAccessKey: ''
      }
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect.element(page.getByRole('list')).toBeInTheDocument();
    await expect.element(page.getByRole('listitem')).toBeInTheDocument();
  });

  it('should render endpoint hint text', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    await expect.element(page.getByText('Leave empty for AWS S3')).toBeInTheDocument();
  });

  it('should render form with POST method', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() as any });

    const form = page.getByRole('button', { name: 'Connect' }).element().closest('form');
    expect(form?.getAttribute('method')).toBe('POST');
  });
});
