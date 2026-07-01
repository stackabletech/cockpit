import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComponentProps } from 'svelte';
import StorageConnectForm from './StorageConnectForm.svelte';
import type { SavedConnection } from '$lib/storage/connection-storage.js';

type ConnectionFormProp = ComponentProps<typeof StorageConnectForm>['connectionForm'];

/** Build a minimal StoredConnection fixture with a stable UUID. */
function makeConn(
  overrides: Partial<Omit<SavedConnection, 'id'>> & { id?: string } = {}
): SavedConnection {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    type: 's3',
    host: 'minio.example.com',
    port: undefined,
    tls: { verification: 'Full' },
    accessStyle: 'Path',
    region: { name: 'us-east-1' },
    credentials: { accessKey: '', secretKey: '' },
    ...overrides
  } as SavedConnection;
}

// Mock feature flags to disable auto-connect
vi.mock('$lib/client/feature-flags.js', () => ({
  storageAutoConnectEnabled: false
}));

// Mock connection-storage module
vi.mock('$lib/storage/connection-storage.js', () => ({
  saveConnectionLocally: vi.fn(),
  loadConnectionLocally: vi.fn(() => null),
  loadAllConnectionsLocally: vi.fn(() => []),
  removeConnectionLocally: vi.fn(),
  updateConnectionLocally: vi.fn(),
  removeConnectionById: vi.fn(),
  loadConnectionById: vi.fn(() => null)
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
  storage_connect_host: () => 'Host',
  storage_connect_host_placeholder: () => 'minio.example.com',
  storage_connect_port: () => 'Port',
  storage_connect_port_placeholder: () => '9000',
  storage_connect_port_hint: () => 'Leave blank for default port',
  storage_connect_tls: () => 'Use TLS',
  storage_connect_tls_hint: () => 'Encrypt with TLS/HTTPS',
  storage_connect_tls_verification: () => 'Verify certificate',
  storage_connect_tls_verification_hint: () => 'Disable for self-signed certificates',
  storage_connect_access_style: () => 'Access style',
  storage_connect_access_style_path: () => 'Path',
  storage_connect_access_style_virtual_hosted: () => 'Virtual hosted',
  storage_connect_region: () => 'Region',
  storage_connect_access_key: () => 'Access key',
  storage_connect_secret_key: () => 'Secret key',
  storage_connect_submit: () => 'Connect',
  storage_connect_forget_label: ({ endpoint }: { endpoint: string }) => `Forget ${endpoint}`,
  storage_connect_forget_confirm: ({ endpoint }: { endpoint: string }) =>
    `Forget connection to ${endpoint}?`,
  storage_connect_forget_cancel: () => 'Cancel',
  storage_connect_forget: () => 'Forget',
  storage_connect_manage: () => 'Manage connections'
}));

function createMockForm(overrides: Record<string, unknown> = {}): ConnectionFormProp {
  return {
    valid: true,
    posted: false,
    errors: {},
    data: {
      id: '00000000-0000-0000-0000-000000000001',
      type: 's3' as const,
      host: '',
      port: undefined,
      tls: { verification: 'Full' as const },
      accessStyle: 'VirtualHosted' as const,
      region: { name: 'us-east-1' },
      credentials: { accessKey: '', secretKey: '' }
    },
    id: 'test-form',
    constraints: {},
    shape: {},
    message: undefined,
    tainted: undefined,
    ...overrides
  } as unknown as ConnectionFormProp;
}

describe('StorageConnectForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the form title and subtitle', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByText('Connect to Storage')).toBeInTheDocument();
    await expect.element(page.getByText('Enter your connection details')).toBeInTheDocument();
  });

  it('should render all form fields with labels', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByLabelText('Backend type')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Host')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Port')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Use TLS')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Access style')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Region')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Access key')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Secret key')).toBeInTheDocument();
  });

  it('should render backend type as a select with S3 option', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    const select = page.getByLabelText('Backend type');
    await expect.element(select).toBeInTheDocument();
    await expect.element(page.getByText('Amazon S3')).toBeInTheDocument();
    await expect.element(page.getByText('HDFS')).toBeInTheDocument();
  });

  it('should render host as text input', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    const input = page.getByLabelText('Host');
    await expect.element(input).toHaveAttribute('type', 'text');
  });

  it('should render port as number input', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    const input = page.getByLabelText('Port');
    await expect.element(input).toHaveAttribute('type', 'number');
  });

  it('should render TLS as a checkbox toggle', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    const toggle = page.getByLabelText('Use TLS');
    await expect.element(toggle).toHaveAttribute('type', 'checkbox');
  });

  it('should show verify certificate toggle when TLS is enabled', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({ data: { tls: { verification: 'Full' } } })
    });

    await expect.element(page.getByLabelText('Verify certificate')).toBeInTheDocument();
  });

  it('should hide verify certificate toggle when TLS is disabled', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({ data: { tls: undefined } })
    });

    await expect.element(page.getByLabelText('Verify certificate')).not.toBeInTheDocument();
  });

  it('should render secret key as password input', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    const input = page.getByLabelText('Secret key');
    await expect.element(input).toHaveAttribute('type', 'password');
  });

  it('should render connect button', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('should show no saved connections message when none exist', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByText('No saved connections yet')).toBeInTheDocument();
  });

  it('should show saved connections when present', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      makeConn({
        host: 'minio.example.com',
        port: 9000,
        region: { name: 'us-east-1' },
        credentials: { accessKey: 'AKIA123', secretKey: 'secret' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByText('minio.example.com:9000')).toBeInTheDocument();
  });

  it('should show forget button for saved connections', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      makeConn({
        id: '00000000-0000-0000-0000-000000000011',
        host: 's3.test.io',
        region: { name: 'eu-west-1' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect
      .element(page.getByRole('button', { name: 'Forget s3.test.io' }))
      .toBeInTheDocument();
  });

  it('should open forget confirmation dialog when forget button clicked', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      makeConn({
        id: '00000000-0000-0000-0000-000000000012',
        host: 's3.remove.io',
        region: { name: 'eu-west-1' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

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
      makeConn({
        id: '00000000-0000-0000-0000-000000000013',
        host: 'first.example.com',
        region: { name: 'us-east-1' }
      }),
      makeConn({
        id: '00000000-0000-0000-0000-000000000014',
        host: 'second.example.com',
        port: 9000,
        accessStyle: 'VirtualHosted',
        region: { name: 'eu-west-1' },
        credentials: { accessKey: 'KEY', secretKey: 'SECRET' }
      }),
      makeConn({
        id: '00000000-0000-0000-0000-000000000015',
        name: 'Production',
        host: 'prod.example.com',
        region: { name: 'us-west-2' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByText('first.example.com')).toBeInTheDocument();
    await expect.element(page.getByText('second.example.com:9000')).toBeInTheDocument();
    await expect.element(page.getByText('Production', { exact: true })).toBeInTheDocument();
  });

  it('should render saved connections in a list role', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      makeConn({
        id: '00000000-0000-0000-0000-000000000016',
        host: 'listed.example.com',
        region: { name: 'us-east-1' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByRole('list')).toBeInTheDocument();
    await expect.element(page.getByRole('listitem')).toBeInTheDocument();
  });

  it('should render port hint text', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByText('Leave blank for default port')).toBeInTheDocument();
  });

  it('should render form with POST method', async () => {
    render(StorageConnectForm, { connectionForm: createMockForm() });

    const form = page.getByRole('button', { name: 'Connect' }).element().closest('form');
    expect(form?.getAttribute('method')).toBe('POST');
  });

  it('should close forget dialog when cancel is clicked', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      makeConn({
        id: '00000000-0000-0000-0000-000000000017',
        host: 's3.cancel.io',
        region: { name: 'eu-west-1' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    await page.getByRole('button', { name: 'Forget s3.cancel.io' }).click();
    await expect.element(page.getByText('Forget connection to s3.cancel.io?')).toBeInTheDocument();

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .element(page.getByText('Forget connection to s3.cancel.io?'))
      .not.toBeInTheDocument();
  });

  it('should remove connection when forget is confirmed', async () => {
    const { loadAllConnectionsLocally, removeConnectionLocally } =
      await import('$lib/storage/connection-storage.js');
    const conn = makeConn({
      id: '00000000-0000-0000-0000-000000000018',
      host: 's3.forget.io',
      region: { name: 'eu-west-1' }
    });
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([conn]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    await page.getByRole('button', { name: 'Forget s3.forget.io' }).click();
    // After clicking forget, mock returns empty list
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([]);
    await page.getByRole('button', { name: 'Forget', exact: true }).click();

    expect(removeConnectionLocally).toHaveBeenCalledWith(conn);
    await expect.element(page.getByText('No saved connections yet')).toBeInTheDocument();
  });

  it('should display host error when form has host errors', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: { host: ['Host is required'] }
      })
    });

    await expect.element(page.getByText('Host is required')).toBeInTheDocument();
    const input = page.getByLabelText('Host');
    const classes = input.element().className;
    expect(classes).toContain('input-error');
  });

  it('should display region error when form has region errors', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: { region: { name: ['Region name is required'] } }
      })
    });

    await expect.element(page.getByText('Region name is required')).toBeInTheDocument();
    const input = page.getByLabelText('Region');
    expect(input.element().className).toContain('input-error');
  });

  it('should display access key error', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: {
          credentials: { accessKey: ['Access key is required when secret key is provided'] }
        }
      })
    });

    await expect
      .element(page.getByText('Access key is required when secret key is provided'))
      .toBeInTheDocument();
    const input = page.getByLabelText('Access key');
    expect(input.element().className).toContain('input-error');
  });

  it('should display secret key error', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: {
          credentials: { secretKey: ['Secret key is required when access key is provided'] }
        }
      })
    });

    await expect
      .element(page.getByText('Secret key is required when access key is provided'))
      .toBeInTheDocument();
    const input = page.getByLabelText('Secret key');
    expect(input.element().className).toContain('input-error');
  });

  it('should display server message when present', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        message: 'Connection refused: unable to reach endpoint'
      })
    });

    await expect
      .element(page.getByText('Connection refused: unable to reach endpoint'))
      .toBeInTheDocument();
  });

  it('should fill form fields when a saved connection is clicked', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      makeConn({
        id: '00000000-0000-0000-0000-000000000021',
        host: 's3.select.io',
        port: 9000,
        accessStyle: 'VirtualHosted',
        region: { name: 'ap-southeast-1' },
        credentials: { accessKey: 'AKIASELECT', secretKey: 'secretselect' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    // Click the saved connection button
    await page.getByRole('button', { name: 's3.select.io:9000', exact: true }).click();

    // Verify form fields are filled
    await expect.element(page.getByLabelText('Host')).toHaveValue('s3.select.io');
    await expect.element(page.getByLabelText('Region')).toHaveValue('ap-southeast-1');
    await expect.element(page.getByLabelText('Access key')).toHaveValue('AKIASELECT');
    await expect.element(page.getByLabelText('Secret key')).toHaveValue('secretselect');
  });

  it('should show saved connections heading when connections exist', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      makeConn({
        id: '00000000-0000-0000-0000-000000000022',
        host: 'heading.example.com',
        region: { name: 'us-east-1' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    await expect.element(page.getByText('Saved connections')).toBeInTheDocument();
  });

  it('should display multiple field errors simultaneously', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: {
          host: ['Host is required'],
          region: { name: ['Region name is required'] },
          credentials: {
            accessKey: ['Access key required'],
            secretKey: ['Secret key required']
          }
        },
        message: 'Validation failed'
      })
    });

    await expect.element(page.getByText('Host is required')).toBeInTheDocument();
    await expect.element(page.getByText('Region name is required')).toBeInTheDocument();
    await expect.element(page.getByText('Access key required')).toBeInTheDocument();
    await expect.element(page.getByText('Secret key required')).toBeInTheDocument();
    await expect.element(page.getByText('Validation failed')).toBeInTheDocument();
  });

  it('should close forget dialog via backdrop button', async () => {
    const { loadAllConnectionsLocally } = await import('$lib/storage/connection-storage.js');
    vi.mocked(loadAllConnectionsLocally).mockReturnValue([
      makeConn({
        id: '00000000-0000-0000-0000-000000000023',
        host: 's3.backdrop.io',
        region: { name: 'eu-west-1' }
      })
    ]);

    render(StorageConnectForm, { connectionForm: createMockForm() });

    await page.getByRole('button', { name: 'Forget s3.backdrop.io' }).click();
    await expect
      .element(page.getByText('Forget connection to s3.backdrop.io?'))
      .toBeInTheDocument();

    // Click the backdrop close button
    await page.getByRole('button', { name: 'close' }).click();
    await expect
      .element(page.getByText('Forget connection to s3.backdrop.io?'))
      .not.toBeInTheDocument();
  });
});
