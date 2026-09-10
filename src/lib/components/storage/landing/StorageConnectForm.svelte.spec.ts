import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComponentProps } from 'svelte';
import StorageConnectForm from './StorageConnectForm.svelte';
import type { ConnectionMetadata } from '$lib/server/storage/types.js';

type ConnectionFormProp = ComponentProps<typeof StorageConnectForm>['connectionForm'];

// Note: $app/navigation is not mocked; invalidateAll is a no-op in test environments.

// Mock feature flags to disable auto-connect
vi.mock('$lib/client/feature-flags.js', () => ({
  storageAutoConnectEnabled: false,
  storageAutoConnectTimeoutMs: 15_000
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
  storage_connect_testing: () => 'Testing connection...',
  storage_connect_additional_buckets: () => 'Additional buckets',
  storage_connect_additional_buckets_hint: () => 'One per line',
  storage_connect_forget_cancel: () => 'Cancel',
  storage_connect_forget: () => 'Forget',
  storage_connect_forget_label: ({ endpoint }: { endpoint: string }) =>
    `Forget connection to ${endpoint}`,
  storage_connect_forget_confirm: ({ endpoint }: { endpoint: string }) =>
    `Remove ${endpoint} from saved connections?`,
  storage_connect_error_unreachable: () => 'Could not connect',
  storage_connect_manage: () => 'Manage connections',
  storage_connect_edit: () => 'Edit',
  storage_more_options: () => 'More options',
  storage_sidebar_resize_handle: () => 'Resize sidebar',
  storage_connections_delete_confirm: ({ label }: { label: string }) =>
    `Delete connection to ${label}?`,
  storage_connections_delete_cancel: () => 'Cancel',
  storage_connections_delete_confirm_button: () => 'Delete',
  storage_connect_copy: () => 'Copy',
  storage_connect_copied: () => 'Copied',
  storage_connect_copy_all: () => 'Copy all'
}));

const defaultFormData = {
  id: '00000000-0000-0000-0000-000000000001',
  type: 's3' as const,
  host: '',
  port: undefined,
  tls: { verification: 'Full' as const },
  accessStyle: 'VirtualHosted' as const,
  region: { name: 'us-east-1' },
  credentials: { accessKey: '', secretKey: '' }
};

function createMockForm(overrides: Record<string, unknown> = {}): ConnectionFormProp {
  const { data: dataOverride, ...restOverrides } = overrides;
  return {
    valid: true,
    posted: false,
    errors: {},
    data: { ...defaultFormData, ...((dataOverride as object) ?? {}) },
    id: 'test-form',
    constraints: {},
    shape: {},
    message: undefined,
    tainted: undefined,
    ...restOverrides
  } as unknown as ConnectionFormProp;
}

function makeConnection(overrides: Partial<ConnectionMetadata> = {}): ConnectionMetadata {
  return {
    id: 'conn-1',
    name: 'My Connection',
    endpoint: 'https://example.com',
    ...overrides
  };
}

function renderForm(
  formOverrides: Record<string, unknown> = {},
  connections: ConnectionMetadata[] = [],
  connectError: string | null = null
) {
  return render(StorageConnectForm, {
    connectionForm: createMockForm(formOverrides),
    connections,
    connectError
  });
}

describe('StorageConnectForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the form title and subtitle', async () => {
    renderForm();

    await expect.element(page.getByText('Connect to Storage')).toBeInTheDocument();
    await expect.element(page.getByText('Enter your connection details')).toBeInTheDocument();
  });

  it('should show "No saved connections" when the store is empty', async () => {
    renderForm();

    await expect.element(page.getByText('No saved connections yet')).toBeInTheDocument();
  });

  it('should show saved connections from the connection store', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'My MinIO', endpoint: 'https://minio.example.com' })
    ]);

    await expect.element(page.getByText('My MinIO').first()).toBeInTheDocument();
  });

  it('should show delete buttons for saved connections', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'Test S3', endpoint: 'https://s3.test.io' })
    ]);

    await expect
      .element(page.getByRole('button', { name: 'Forget connection to Test S3' }))
      .toBeInTheDocument();
  });

  it('should render multiple saved connections', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'First', endpoint: 'https://first.example.com' }),
      makeConnection({ id: 'conn-2', name: 'Second', endpoint: 'https://second.example.com' })
    ]);

    // Use .first() to avoid strict-mode violation: the name appears in both the
    // <span> label and the containing <button> (which inherits its text content).
    await expect.element(page.getByText('First').first()).toBeInTheDocument();
    await expect.element(page.getByText('Second').first()).toBeInTheDocument();
  });

  it('should show connection name for null endpoint', async () => {
    renderForm({}, [makeConnection({ id: 'conn-1', name: 'AWS Connection', endpoint: null })]);

    await expect.element(page.getByText('AWS Connection').first()).toBeInTheDocument();
  });

  it('should render the connection form fields', async () => {
    renderForm();

    await expect.element(page.getByLabelText('Backend type')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Host')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Port')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Use TLS')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Access style')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Region')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Access key')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Secret key')).toBeInTheDocument();
  });

  it('should render the form with POST method to ?/connect', async () => {
    renderForm();

    const connectBtn = page.getByRole('button', { name: 'Connect' });
    await expect.element(connectBtn).toBeInTheDocument();
    const form = connectBtn.element().closest('form');
    expect(form?.getAttribute('method')).toBe('POST');
    expect(form?.getAttribute('action')).toContain('/connect');
  });

  it('should render host as text input', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const input = page.getByLabelText('Host');
    await expect.element(input).toHaveAttribute('type', 'text');
  });

  it('should render port as number input', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const input = page.getByLabelText('Port');
    await expect.element(input).toHaveAttribute('type', 'number');
  });

  it('should render TLS as a checkbox toggle', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const toggle = page.getByLabelText('Use TLS');
    await expect.element(toggle).toHaveAttribute('type', 'checkbox');
  });

  it('should show verify certificate toggle when TLS is enabled', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({ data: { tls: { verification: 'Full' } } }),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByLabelText('Verify certificate')).toBeInTheDocument();
  });

  it('should hide verify certificate toggle when TLS is disabled', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({ data: { tls: undefined } }),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByLabelText('Verify certificate')).not.toBeInTheDocument();
  });

  it('should render secret key as password input', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const input = page.getByLabelText('Secret key');
    await expect.element(input).toHaveAttribute('type', 'password');
  });

  it('should render connect button', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('should show no saved connections message when none exist', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByText('No saved connections yet')).toBeInTheDocument();
  });

  it('should render connections in a list role', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'Listed', endpoint: 'https://listed.example.com' })
    ]);

    await expect
      .element(page.getByRole('list', { name: 'Saved connections' }).first())
      .toBeInTheDocument();
    await expect.element(page.getByRole('listitem').first()).toBeInTheDocument();
  });

  it('should render port hint text', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByText('Leave blank for default port')).toBeInTheDocument();
  });

  it('should render form with POST method', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const form = page.getByRole('button', { name: 'Connect' }).element().closest('form');
    expect(form?.getAttribute('method')).toBe('POST');
  });

  it('should display host error when form has host errors', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: { host: ['Host is required'] }
      }),
      connections: [],
      connectError: null
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
      }),
      connections: [],
      connectError: null
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
      }),
      connections: [],
      connectError: null
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
      }),
      connections: [],
      connectError: null
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
      }),
      connections: [],
      connectError: null
    });

    await expect
      .element(page.getByText('Connection refused: unable to reach endpoint'))
      .toBeInTheDocument();
  });

  it('should show saved connections heading when connections exist', async () => {
    renderForm({}, [
      makeConnection({ id: 'conn-1', name: 'Heading', endpoint: 'https://heading.example.com' })
    ]);

    await expect.element(page.getByText('Saved connections').first()).toBeInTheDocument();
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
      }),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByText('Host is required')).toBeInTheDocument();
    await expect.element(page.getByText('Region name is required')).toBeInTheDocument();
    await expect.element(page.getByText('Access key required')).toBeInTheDocument();
    await expect.element(page.getByText('Secret key required')).toBeInTheDocument();
    await expect.element(page.getByText('Validation failed')).toBeInTheDocument();
  });
});
