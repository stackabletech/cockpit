<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { formatFileSize, keyToName } from '$lib/storage/utils.js';
  import TimestampDisplay from '$lib/components/storage/shared/TimestampDisplay.svelte';
  import type { FileDetails as FileDetailsType } from '$lib/storage/details-types.js';

  interface Props {
    details: FileDetailsType;
    bucket: string;
  }

  let { details, bucket }: Props = $props();
</script>

<div class="overflow-x-auto">
  <table class="table-sm table">
    <tbody>
      <tr>
        <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_name()}</td>
        <td class="font-mono text-sm">{keyToName(details.key)}</td>
      </tr>
      <tr>
        <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_file_path()}</td>
        <td class="font-mono text-sm break-all">s3://{bucket}/{details.key}</td>
      </tr>
      <tr>
        <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_size()}</td>
        <td class="font-mono text-sm">{formatFileSize(details.size)} ({details.size.toLocaleString()} bytes)</td>
      </tr>
      <tr>
        <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_last_modified()}</td>
        <td><TimestampDisplay date={details.lastModified} /></td>
      </tr>
      {#if details.contentType}
        <tr>
          <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_content_type()}</td>
          <td class="font-mono text-sm">{details.contentType}</td>
        </tr>
      {/if}
      {#if details.etag}
        <tr>
          <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_etag()}</td>
          <td class="font-mono text-sm truncate max-w-xs" title={details.etag}>{details.etag}</td>
        </tr>
      {/if}
      {#if details.versionId}
        <tr>
          <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_version_id()}</td>
          <td class="font-mono text-sm truncate max-w-xs" title={details.versionId}>{details.versionId}</td>
        </tr>
      {/if}
      {#if details.storageClass}
        <tr>
          <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_storage_class()}</td>
          <td class="font-mono text-sm">{details.storageClass}</td>
        </tr>
      {/if}
      <tr>
        <td class="text-base-content/60 font-medium whitespace-nowrap">{m.storage_details_is_delete_marker()}</td>
        <td>{details.isDeleteMarker ? m.storage_details_yes() : m.storage_details_no()}</td>
      </tr>
    </tbody>
  </table>

  {#if details.customMetadata && Object.keys(details.customMetadata).length > 0}
    <h4 class="text-base-content/70 mt-4 mb-2 text-xs font-semibold tracking-wide uppercase">
      Custom Metadata
    </h4>
    <table class="table-sm table">
      <tbody>
        {#each Object.entries(details.customMetadata) as [key, value]}
          <tr>
            <td class="text-base-content/60 font-medium font-mono text-xs">{key}</td>
            <td class="font-mono text-xs break-all">{value}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
