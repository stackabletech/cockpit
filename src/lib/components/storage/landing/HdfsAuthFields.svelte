<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    auth: 'simple' | 'kerberos';
    servicePrincipal: string | undefined;
    devUser: string | undefined;
    /** SSO username; `null` without OIDC, where the user is entered here. */
    hdfsUser: string | null;
    /** Whether the server has a Kerberos keytab configured. */
    kerberosAvailable: boolean;
    devUserError?: string | string[];
    /** Called when Kerberos is selected, e.g. to switch TLS on. */
    onKerberosSelected?: () => void;
  }

  let {
    auth = $bindable(),
    servicePrincipal = $bindable(),
    devUser = $bindable(),
    hdfsUser,
    kerberosAvailable,
    devUserError,
    onKerberosSelected
  }: Props = $props();

  const uid = $props.id();
  const kerberos = $derived(auth === 'kerberos');
</script>

<div>
  <label for="{uid}-auth" class="label mb-1 text-sm font-medium">
    {m.storage_connect_hdfs_auth()}
  </label>
  <select
    id="{uid}-auth"
    name="auth"
    class="select w-full"
    aria-describedby={kerberosAvailable ? undefined : `${uid}-auth-hint`}
    bind:value={auth}
    onchange={() => {
      if (auth === 'kerberos') onKerberosSelected?.();
    }}
  >
    <option value="simple">{m.storage_connect_hdfs_auth_simple()}</option>
    <option value="kerberos" disabled={!kerberosAvailable}>
      {m.storage_connect_hdfs_auth_kerberos()}
    </option>
  </select>
  {#if !kerberosAvailable}
    <p id="{uid}-auth-hint" class="text-base-content/50 mt-1 text-xs">
      {m.storage_connect_hdfs_auth_kerberos_unavailable()}
    </p>
  {/if}
</div>

{#if kerberos}
  <div>
    <label for="{uid}-spn" class="label mb-1 text-sm font-medium">
      {m.storage_connect_hdfs_service_principal()}
    </label>
    <input
      id="{uid}-spn"
      name="servicePrincipal"
      type="text"
      class="input w-full"
      placeholder={m.storage_connect_hdfs_service_principal_placeholder()}
      aria-describedby="{uid}-spn-hint"
      bind:value={servicePrincipal}
    />
    <p id="{uid}-spn-hint" class="text-base-content/50 mt-1 text-xs">
      {m.storage_connect_hdfs_service_principal_hint()}
    </p>
  </div>
{/if}

{#if hdfsUser}
  <p class="text-base-content/70 text-sm">
    {kerberos
      ? m.storage_connect_hdfs_user_sso_kerberos({ username: hdfsUser })
      : m.storage_connect_hdfs_user_sso({ username: hdfsUser })}
  </p>
{:else}
  <div>
    <label for="{uid}-hdfs-user" class="label mb-1 text-sm font-medium">
      {m.storage_connect_hdfs_user()}
    </label>
    <input
      id="{uid}-hdfs-user"
      name="devUser"
      type="text"
      class={['input w-full', devUserError && 'input-error']}
      autocomplete="username"
      aria-describedby="{uid}-hdfs-user-hint"
      bind:value={devUser}
    />
    <p id="{uid}-hdfs-user-hint" class="text-base-content/50 mt-1 text-xs">
      {kerberos ? m.storage_connect_hdfs_user_proxy_hint() : m.storage_connect_hdfs_user_hint()}
    </p>
    {#if devUserError}
      <p class="text-error mt-1 text-xs">{devUserError}</p>
    {/if}
  </div>
{/if}
