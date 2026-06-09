import IconPdf from 'virtual:icons/vscode-icons/file-type-pdf2';
import IconMarkdown from 'virtual:icons/vscode-icons/file-type-markdown';
import IconExcel from 'virtual:icons/vscode-icons/file-type-excel';
import IconWord from 'virtual:icons/vscode-icons/file-type-word';
import IconCss from 'virtual:icons/vscode-icons/file-type-css';
import IconHtml from 'virtual:icons/vscode-icons/file-type-html';
import IconJs from 'virtual:icons/vscode-icons/file-type-js';
import IconTs from 'virtual:icons/vscode-icons/file-type-typescript';
import IconJson from 'virtual:icons/vscode-icons/file-type-json';
import IconImage from 'virtual:icons/vscode-icons/file-type-image';
import IconSvg from 'virtual:icons/vscode-icons/file-type-svg';
import IconZip from 'virtual:icons/vscode-icons/file-type-zip';
import IconText from 'virtual:icons/vscode-icons/file-type-text';
import IconDocument from 'virtual:icons/vscode-icons/default-file';
import IconYaml from 'virtual:icons/vscode-icons/file-type-yaml';
import IconToml from 'virtual:icons/vscode-icons/file-type-toml';
import IconXml from 'virtual:icons/vscode-icons/file-type-xml';
import IconSql from 'virtual:icons/vscode-icons/file-type-sql';
import IconAudio from 'virtual:icons/vscode-icons/file-type-audio';
import IconVideo from 'virtual:icons/vscode-icons/file-type-video';
import IconFont from 'virtual:icons/vscode-icons/file-type-font';
import IconPython from 'virtual:icons/vscode-icons/file-type-python';
import IconRuby from 'virtual:icons/vscode-icons/file-type-ruby';
import IconRust from 'virtual:icons/vscode-icons/file-type-rust';
import IconGo from 'virtual:icons/vscode-icons/file-type-go';
import IconJava from 'virtual:icons/vscode-icons/file-type-java';
import IconPhp from 'virtual:icons/vscode-icons/file-type-php';
import IconShell from 'virtual:icons/vscode-icons/file-type-shell';
import IconLog from 'virtual:icons/vscode-icons/file-type-log';
import IconParquet from 'virtual:icons/vscode-icons/file-type-parquet';
import IconDb from 'virtual:icons/vscode-icons/file-type-db';
import type { Component } from 'svelte';

export type FileIconKind =
  | 'pdf'
  | 'markdown'
  | 'excel'
  | 'word'
  | 'css'
  | 'html'
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'image'
  | 'svg'
  | 'archive'
  | 'text'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'sql'
  | 'audio'
  | 'video'
  | 'font'
  | 'python'
  | 'ruby'
  | 'rust'
  | 'go'
  | 'java'
  | 'php'
  | 'shell'
  | 'log'
  | 'parquet'
  | 'database'
  | 'document';

export interface IconConfig {
  component: Component;
}

export const FILE_ICON_CONFIG: Record<FileIconKind, IconConfig> = {
  pdf: { component: IconPdf },
  markdown: { component: IconMarkdown },
  excel: { component: IconExcel },
  word: { component: IconWord },
  css: { component: IconCss },
  html: { component: IconHtml },
  javascript: { component: IconJs },
  typescript: { component: IconTs },
  json: { component: IconJson },
  image: { component: IconImage },
  svg: { component: IconSvg },
  archive: { component: IconZip },
  text: { component: IconText },
  yaml: { component: IconYaml },
  toml: { component: IconToml },
  xml: { component: IconXml },
  sql: { component: IconSql },
  audio: { component: IconAudio },
  video: { component: IconVideo },
  font: { component: IconFont },
  python: { component: IconPython },
  ruby: { component: IconRuby },
  rust: { component: IconRust },
  go: { component: IconGo },
  java: { component: IconJava },
  php: { component: IconPhp },
  shell: { component: IconShell },
  log: { component: IconLog },
  parquet: { component: IconParquet },
  database: { component: IconDb },
  document: { component: IconDocument }
};

// Content type patterns to icon kind mappings
const MARKDOWN_TYPES = new Set(['text/markdown', 'text/x-markdown']);

const EXCEL_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template'
]);

const WORD_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template'
]);

const ARCHIVE_TYPES = new Set(['application/gzip', 'application/zip', 'application/x-tar']);

const EXT_KIND = new Map<string, FileIconKind>([
  ['pdf', 'pdf'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['xls', 'excel'],
  ['xlsx', 'excel'],
  ['doc', 'word'],
  ['docx', 'word'],
  ['css', 'css'],
  ['html', 'html'],
  ['htm', 'html'],
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['ts', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['png', 'image'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['gif', 'image'],
  ['bmp', 'image'],
  ['ico', 'image'],
  ['tiff', 'image'],
  ['avif', 'image'],
  ['webp', 'image'],
  ['svg', 'svg'],
  ['zip', 'archive'],
  ['tar', 'archive'],
  ['gz', 'archive'],
  ['tgz', 'archive'],
  ['bz2', 'archive'],
  ['xz', 'archive'],
  ['zst', 'archive'],
  ['txt', 'text'],
  ['csv', 'text'],
  ['tsv', 'text'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['xml', 'xml'],
  ['sql', 'sql'],
  ['log', 'log'],
  ['py', 'python'],
  ['pyw', 'python'],
  ['rb', 'ruby'],
  ['rs', 'rust'],
  ['go', 'go'],
  ['java', 'java'],
  ['class', 'java'],
  ['jar', 'java'],
  ['php', 'php'],
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['fish', 'shell'],
  ['parquet', 'parquet'],
  ['db', 'database'],
  ['sqlite', 'database'],
  ['sqlite3', 'database']
]);

export function fileIconKind(contentType: string | undefined, key?: string): FileIconKind {
  if (!contentType) {
    if (key) {
      const ext = key.split('.').at(-1)?.toLowerCase();
      const kind = ext ? EXT_KIND.get(ext) : undefined;
      if (kind) return kind;
    }
    return 'document';
  }
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('font/')) return 'font';
  if (contentType === 'application/pdf') return 'pdf';
  if (MARKDOWN_TYPES.has(contentType)) return 'markdown';
  if (EXCEL_TYPES.has(contentType)) return 'excel';
  if (WORD_TYPES.has(contentType)) return 'word';
  if (contentType === 'text/css') return 'css';
  if (contentType === 'text/html') return 'html';
  if (contentType === 'application/javascript' || contentType === 'text/javascript')
    return 'javascript';
  if (contentType === 'text/typescript' || contentType === 'application/typescript')
    return 'typescript';
  if (contentType === 'application/json') return 'json';
  if (ARCHIVE_TYPES.has(contentType)) return 'archive';
  if (contentType === 'application/xml' || contentType === 'text/xml') return 'xml';
  if (contentType === 'text/yaml' || contentType === 'application/yaml') return 'yaml';
  if (contentType === 'application/toml') return 'toml';
  if (contentType === 'application/sql' || contentType === 'text/x-sql') return 'sql';
  if (contentType === 'application/vnd.apache.parquet' || contentType === 'application/x-parquet')
    return 'parquet';
  if (contentType === 'text/x-python' || contentType === 'application/x-python-code')
    return 'python';
  if (contentType === 'text/x-ruby') return 'ruby';
  if (contentType === 'text/x-go') return 'go';
  if (contentType === 'text/x-java-source' || contentType === 'application/java-vm') return 'java';
  if (
    contentType === 'application/x-sh' ||
    contentType === 'text/x-sh' ||
    contentType === 'text/x-shellscript'
  )
    return 'shell';
  if (contentType.startsWith('text/')) return 'text';
  return 'document';
}
