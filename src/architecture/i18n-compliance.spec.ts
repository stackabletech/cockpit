/**
 * i18n Compliance
 *
 * All user-visible strings must be served through Paraglide-JS message
 * functions so that the application renders correctly in both English (en)
 * and German (de).
 *
 * Rules:
 *   a) Both locale files (messages/en.json, messages/de.json) must have the
 *      same top-level keys — missing translations break the German locale.
 *   b) Svelte components must not use hardcoded English strings in static
 *      aria-label="..." attributes (dynamic bindings are allowed).
 *   c) Every message key must be referenced somewhere in `src/` so dead keys
 *      are caught at CI time rather than accumulating in the locale files.
 *      Pre-existing unused keys are tracked in KNOWN_UNUSED_KEYS; remove an
 *      entry from that list as soon as the key is used or deleted.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findFiles } from './helpers';

/**
 * Keys present in messages/*.json but not referenced anywhere in src/.
 * These predate the unused-key rule and belong to planned features or
 * removed UI. As keys are used or removed, delete them from this list — it
 * must never grow.
 */
const KNOWN_UNUSED_KEYS = [
  'nav_badge_soon',
  'trino_first_page',
  'trino_prev_page',
  'trino_next_page',
  'trino_last_page',
  'trino_connection_error',
  'trino_catalog_label',
  'trino_schema_label',
  'storage_connect_reconnecting',
  'storage_connect_timeout',
  'storage_connect_cancel',
  'storage_connect_forget_confirm',
  'storage_connect_forget_cancel',
  'storage_connect_name',
  'storage_connect_name_placeholder',
  'storage_connect_additional_buckets',
  'storage_connect_additional_buckets_hint',
  'storage_connect_duplicate_warning',
  'storage_connect_delete_label',
  'storage_connect_delete_confirm_title',
  'storage_connect_delete_confirm_message',
  'storage_connect_delete_confirm_button',
  'storage_connect_delete_cancel',
  'storage_connect_add_new',
  'storage_connect_testing',
  'storage_connection_edit_success',
  'storage_connection_edit_not_found',
  'storage_folders',
  'storage_paste',
  'storage_paste_plural',
  'storage_danger_zone',
  'storage_download_error_title',
  'storage_preview_fetch_more',
  'storage_preview_csv_columns',
  'storage_preview_pdf_too_large',
  'storage_upload_selected',
  'storage_upload_uploading',
  'storage_upload_success',
  'storage_upload_overwrite_title',
  'storage_upload_overwrite_message',
  'storage_upload_overwrite_replace',
  'storage_upload_overwrite_rename',
  'storage_upload_rename_confirm',
  'storage_upload_retry',
  'storage_preview_parquet_row_group',
  'storage_archive_exit',
  'storage_details_title',
  'storage_details_property',
  'storage_details_value',
  'storage_details_tree_visualization',
  'storage_details_lifecycle_rule_id',
  'storage_details_lifecycle_status',
  'storage_details_error_not_connected',
  'storage_details_error_fetch_file',
  'storage_details_error_fetch_bucket',
  'storage_details_error_fetch_dir_meta',
  'storage_details_tab_overview',
  'storage_details_tab_lifecycle',
  'storage_details_bucket_name',
  'storage_details_object_lock',
  'storage_action_move_error_not_connected',
  'storage_action_move_error_access_denied',
  'storage_operations_progress',
  'storage_operations_error_generic',
  'storage_rename_error_not_connected'
];

/** Every message key referenced as `m.<key>(...)` in src/** (excluding the generated paraglide output). */
function collectUsedKeys(): Set<string> {
  const used = new Set<string>();
  for (const file of findFiles('src', /\.(ts|svelte)$/, [/paraglide/])) {
    const content = readFileSync(file, 'utf-8');
    for (const match of content.matchAll(/\bm\.([a-zA-Z0-9_]+)\b/g)) used.add(match[1]);
  }
  return used;
}

describe('i18n Compliance', () => {
  it('messages/en.json and messages/de.json must have the same top-level keys', () => {
    const en: Record<string, unknown> = JSON.parse(readFileSync('messages/en.json', 'utf-8'));
    const de: Record<string, unknown> = JSON.parse(readFileSync('messages/de.json', 'utf-8'));

    const enKeys = Object.keys(en).sort();
    const deKeys = Object.keys(de).sort();

    const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
    const missingInEn = deKeys.filter((k) => !enKeys.includes(k));

    expect(missingInDe).toStrictEqual([]);
    expect(missingInEn).toStrictEqual([]);
  });

  it('every message key must be referenced in the source code', () => {
    const en: Record<string, unknown> = JSON.parse(readFileSync('messages/en.json', 'utf-8'));
    const used = collectUsedKeys();

    const unused = Object.keys(en)
      .filter((key) => !key.startsWith('$'))
      .filter((key) => !used.has(key));

    const newUnused = unused.filter((key) => !KNOWN_UNUSED_KEYS.includes(key));
    expect(newUnused).toStrictEqual([]);
  });

  it('Svelte components must not use static English strings in aria-label attributes', () => {
    const KNOWN_VIOLATIONS = [
      'ToastHost.svelte',
      'TextEditor.svelte',
      'ContextMenu.svelte',
      'FileRow.svelte',
      'FolderRow.svelte',
      'ObjectTable.svelte',
      'StorageBreadcrumb.svelte',
      'CsvPreview.svelte',
      'ParquetPreview.svelte',
      'TextPreview.svelte'
    ];

    const STATIC_ARIA_RE = /aria-label="[A-Za-z][^"]{2,}"/;

    const files = findFiles('src', /\.svelte$/);
    const allViolations = files.filter((file) => {
      const content = readFileSync(file, 'utf-8');
      return STATIC_ARIA_RE.test(content);
    });

    const newViolations = allViolations.filter(
      (f) => !KNOWN_VIOLATIONS.some((kv) => f.endsWith(kv))
    );
    expect(newViolations).toStrictEqual([]);
  });
});
