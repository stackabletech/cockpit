import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import HdfsAuthFields from './HdfsAuthFields.svelte';

const baseProps = {
  auth: 'simple' as const,
  servicePrincipal: '',
  devUser: '',
  hdfsUser: 'alice',
  kerberosAvailable: true
};

describe('HdfsAuthFields', () => {
  it('disables Kerberos and explains why when the server has no keytab', async () => {
    render(HdfsAuthFields, { ...baseProps, kerberosAvailable: false });
    await expect.element(page.getByRole('option', { name: 'Kerberos' })).toBeDisabled();
    await expect
      .element(page.getByText('Kerberos needs a keytab configured on the cockpit server.'))
      .toBeInTheDocument();
  });

  it('shows the service principal field and calls back when Kerberos is selected', async () => {
    const onKerberosSelected = vi.fn();
    render(HdfsAuthFields, { ...baseProps, onKerberosSelected });
    await expect.element(page.getByLabelText('Service principal')).not.toBeInTheDocument();

    await userEvent.selectOptions(page.getByLabelText('Authentication'), 'kerberos');

    await expect.element(page.getByLabelText('Service principal')).toBeInTheDocument();
    await expect
      .element(page.getByText("Connects with cockpit's Kerberos identity, acting as alice."))
      .toBeInTheDocument();
    expect(onKerberosSelected).toHaveBeenCalledTimes(1);
  });

  it('asks for the proxied user without single sign-on', async () => {
    render(HdfsAuthFields, { ...baseProps, auth: 'kerberos', hdfsUser: null });
    await expect.element(page.getByLabelText('HDFS user')).toBeInTheDocument();
    await expect.element(page.getByText(/cockpit acts as this HDFS user/)).toBeInTheDocument();
  });
});
