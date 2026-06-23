import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { SuperValidated } from 'sveltekit-superforms';
import StorageConnectForm from './StorageConnectForm.svelte';
import type { ConnectionMetadata } from '$lib/server/storage/types.js';

// Mock paraglide messages
vi.mock('$lib/paraglide/messages.js', () => ({
  storage_connect_title: () => 'Connect to storage',
  storage_connect_subtitle: () => 'Configure a storage backend to browse buckets and objects.',
  storage_connect_reconnecting: () => 'Reconnecting…',
  storage_connect_saved: () => 'Saved connections',
  storage_connect_no_saved: () => 'No saved connections yet',
  storage_connect_error_unreachable: () =>
    'Could not reconnect — the storage endpoint may be unavailable.',
  storage_connect_type: () => 'Backend type',
  storage_connect_type_s3: () => 'S3-compatible',
  storage_connect_type_hdfs: () => 'HDFS',
  storage_connect_endpoint: () => 'Endpoint URL',
  storage_connect_endpoint_placeholder: () => 'https://minio.example.com:9000',
  storage_connect_endpoint_hint: () => 'Leave blank to use AWS S3',
  storage_connect_path_style: () => 'Use path-style addressing',
  storage_connect_path_style_hint: () =>
    'Enable for MinIO and most self-hosted S3 providers. Disable for virtual-hosted-style access.',
  storage_connect_region: () => 'Region',
  storage_connect_access_key: () => 'Access key ID',
  storage_connect_secret_key: () => 'Secret access key',
  storage_connect_submit: () => 'Connect',
  storage_connect_forget_label: ({ endpoint }: { endpoint: string }) =>
    `Forget connection to ${endpoint}`,
  storage_connect_forget_confirm: ({ endpoint }: { endpoint: string }) =>
    `Remove ${endpoint} from saved connections?`,
  storage_connect_forget_cancel: () => 'Cancel',
  storage_connect_forget: () => 'Forget'
}));

function createMockForm(overrides: Record<string, unknown> = {}): SuperValidated<
  {
    type: 's3' | 'hdfs';
    endpoint: string;
    pathStyle: boolean;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  },
  string
> {
  return {
    valid: true,
    posted: false,
    errors: {},
    data: {
      type: 's3',
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
  } as unknown as SuperValidated<
    {
      type: 's3' | 'hdfs';
      endpoint: string;
      pathStyle: boolean;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
    string
  >;
}

function createConnection(overrides: Partial<ConnectionMetadata> = {}): ConnectionMetadata {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    name: overrides.name ?? 'My Connection',
    type: 's3',
    endpoint: overrides.endpoint,
    updatedAt: overrides.updatedAt ?? new Date('2025-01-01'),
    ...overrides
  };
}

describe('StorageConnectForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the form title and subtitle', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByText('Connect to storage')).toBeInTheDocument();
    await expect
      .element(page.getByText('Configure a storage backend to browse buckets and objects.'))
      .toBeInTheDocument();
  });

  it('should render all form fields with labels', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByLabelText('Backend type')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Endpoint URL')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Use path-style addressing')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Region')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Access key ID')).toBeInTheDocument();
    await expect.element(page.getByLabelText('Secret access key')).toBeInTheDocument();
  });

  it('should render backend type as a select with S3 option', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const select = page.getByLabelText('Backend type');
    await expect.element(select).toBeInTheDocument();
    await expect.element(page.getByText('S3-compatible')).toBeInTheDocument();
    await expect.element(page.getByText('HDFS')).toBeInTheDocument();
  });

  it('should render endpoint as url input', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const input = page.getByLabelText('Endpoint URL');
    await expect.element(input).toHaveAttribute('type', 'url');
  });

  it('should render path-style as a checkbox', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const toggle = page.getByLabelText('Use path-style addressing');
    await expect.element(toggle).toHaveAttribute('type', 'checkbox');
  });

  it('should render secret access key as password input', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    const input = page.getByLabelText('Secret access key');
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

  it('should show saved connections when present', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-1',
          name: 'Minio',
          endpoint: 'https://minio.example.com'
        })
      ],
      connectError: null
    });

    await expect.element(page.getByText('Minio', { exact: true })).toBeInTheDocument();
  });

  it('should show forget button for saved connections', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-2',
          name: 'Test IO',
          endpoint: 'https://s3.test.io'
        })
      ],
      connectError: null
    });

    await expect
      .element(page.getByRole('button', { name: 'Forget connection to Test IO' }))
      .toBeInTheDocument();
  });

  it('should open forget confirmation dialog when forget button clicked', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-3',
          name: 'Remove IO',
          endpoint: 'https://s3.remove.io'
        })
      ],
      connectError: null
    });

    const forgetBtn = page.getByRole('button', { name: 'Forget connection to Remove IO' });
    await forgetBtn.click();

    await expect
      .element(page.getByText('Remove Remove IO from saved connections?'))
      .toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Forget', exact: true }))
      .toBeInTheDocument();
  });

  it('should show multiple saved connections', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-4',
          name: 'First Example',
          endpoint: 'https://first.example.com'
        }),
        createConnection({
          id: 'conn-5',
          name: 'Second Example',
          endpoint: 'https://second.example.com'
        }),
        createConnection({
          id: 'conn-6',
          name: 'AWS S3',
          endpoint: undefined
        })
      ],
      connectError: null
    });

    await expect.element(page.getByText('First Example')).toBeInTheDocument();
    await expect.element(page.getByText('Second Example')).toBeInTheDocument();
    await expect.element(page.getByText('AWS S3', { exact: true })).toBeInTheDocument();
  });

  it('should render saved connections in a list role', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-7',
          name: 'Listed Example',
          endpoint: 'https://listed.example.com'
        })
      ],
      connectError: null
    });

    await expect.element(page.getByRole('list')).toBeInTheDocument();
    await expect.element(page.getByRole('listitem')).toBeInTheDocument();
  });

  it('should render endpoint hint text', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByText('Leave blank to use AWS S3')).toBeInTheDocument();
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

  it('should close forget dialog when cancel is clicked', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-8',
          name: 'Cancel IO',
          endpoint: 'https://s3.cancel.io'
        })
      ],
      connectError: null
    });

    await page.getByRole('button', { name: 'Forget connection to Cancel IO' }).click();
    await expect
      .element(page.getByText('Remove Cancel IO from saved connections?'))
      .toBeInTheDocument();

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .element(page.getByText('Remove Cancel IO from saved connections?'))
      .not.toBeInTheDocument();
  });

  it('should submit deleteConnection form action when forget is confirmed', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-9',
          name: 'Forget IO',
          endpoint: 'https://s3.forget.io'
        })
      ],
      connectError: null
    });

    await page.getByRole('button', { name: 'Forget connection to Forget IO' }).click();

    const forgetForm = page
      .getByRole('button', { name: 'Forget', exact: true })
      .element()
      .closest('form');
    expect(forgetForm?.getAttribute('action')).toContain('deleteConnection');
    expect(forgetForm?.getAttribute('method')).toBe('POST');

    const hiddenInput = forgetForm?.querySelector('input[name="connectionId"]') as HTMLInputElement;
    expect(hiddenInput?.value).toBe('conn-9');
  });

  it('should submit use form action when saved connection is clicked', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-10',
          name: 'Select IO',
          endpoint: 'https://s3.select.io'
        })
      ],
      connectError: null
    });

    const connectionBtn = page.getByRole('button', { name: 'Select IO', exact: true });
    const useForm = connectionBtn.element().closest('form');
    expect(useForm?.getAttribute('action')).toContain('use');
    expect(useForm?.getAttribute('method')).toBe('POST');

    const hiddenInput = useForm?.querySelector('input[name="connectionId"]') as HTMLInputElement;
    expect(hiddenInput?.value).toBe('conn-10');
  });

  it('should show saved connections heading when connections exist', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-11',
          name: 'Heading Example',
          endpoint: 'https://heading.example.com'
        })
      ],
      connectError: null
    });

    await expect.element(page.getByText('Saved connections')).toBeInTheDocument();
  });

  it('should display endpoint error when form has endpoint errors', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: { endpoint: 'Must be a valid URL' }
      }),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByText('Must be a valid URL')).toBeInTheDocument();
    const input = page.getByLabelText('Endpoint URL');
    const classes = input.element().className;
    expect(classes).toContain('input-error');
  });

  it('should display region error when form has region errors', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: { region: 'Region is required' }
      }),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByText('Region is required')).toBeInTheDocument();
    const input = page.getByLabelText('Region');
    expect(input.element().className).toContain('input-error');
  });

  it('should display accessKeyId error', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: {
          accessKeyId: 'Access key ID is required when secret access key is provided'
        }
      }),
      connections: [],
      connectError: null
    });

    await expect
      .element(page.getByText('Access key ID is required when secret access key is provided'))
      .toBeInTheDocument();
    const input = page.getByLabelText('Access key ID');
    expect(input.element().className).toContain('input-error');
  });

  it('should display secretAccessKey error', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: {
          secretAccessKey: 'Secret access key is required when access key ID is provided'
        }
      }),
      connections: [],
      connectError: null
    });

    await expect
      .element(page.getByText('Secret access key is required when access key ID is provided'))
      .toBeInTheDocument();
    const input = page.getByLabelText('Secret access key');
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

  it('should display connectError when provided', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: 'Could not reconnect — the storage endpoint may be unavailable.'
    });

    await expect
      .element(page.getByText('Could not reconnect — the storage endpoint may be unavailable.'))
      .toBeInTheDocument();
  });

  it('should display multiple field errors simultaneously', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm({
        errors: {
          endpoint: 'Must be a valid URL',
          region: 'Region is required',
          accessKeyId: 'Access key required',
          secretAccessKey: 'Secret key required'
        },
        message: 'Validation failed'
      }),
      connections: [],
      connectError: null
    });

    await expect.element(page.getByText('Must be a valid URL')).toBeInTheDocument();
    await expect.element(page.getByText('Region is required')).toBeInTheDocument();
    await expect.element(page.getByText('Access key required')).toBeInTheDocument();
    await expect.element(page.getByText('Secret key required')).toBeInTheDocument();
    await expect.element(page.getByText('Validation failed')).toBeInTheDocument();
  });

  it('should close forget dialog via backdrop button', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-12',
          name: 'Backdrop IO',
          endpoint: 'https://s3.backdrop.io'
        })
      ],
      connectError: null
    });

    await page.getByRole('button', { name: 'Forget connection to Backdrop IO' }).click();
    await expect
      .element(page.getByText('Remove Backdrop IO from saved connections?'))
      .toBeInTheDocument();

    // Click the backdrop close button
    await page.getByRole('button', { name: 'close' }).click();
    await expect
      .element(page.getByText('Remove Backdrop IO from saved connections?'))
      .not.toBeInTheDocument();
  });

  it('should render connection name as label', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-13',
          name: 'My Minio',
          endpoint: 'https://minio.internal:9000'
        })
      ],
      connectError: null
    });

    await expect.element(page.getByText('My Minio')).toBeInTheDocument();
  });

  it('should use conn.name for forget dialog confirmation', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [
        createConnection({
          id: 'conn-14',
          name: 'Production S3',
          endpoint: 'https://s3.prod.io'
        })
      ],
      connectError: null
    });

    await page.getByRole('button', { name: 'Forget connection to Production S3' }).click();

    await expect
      .element(page.getByText('Remove Production S3 from saved connections?'))
      .toBeInTheDocument();
  });

  it('should not show connectError when null', async () => {
    render(StorageConnectForm, {
      connectionForm: createMockForm(),
      connections: [],
      connectError: null
    });

    await expect
      .element(page.getByText('Could not reconnect — the storage endpoint may be unavailable.'))
      .not.toBeInTheDocument();
  });
});
