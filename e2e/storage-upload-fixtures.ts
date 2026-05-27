import { faker } from '@faker-js/faker';

type UploadFixture = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

export type TextUploadFixture = UploadFixture & {
  expectedSnippet: string;
  fullText: string;
};

export type CsvUploadFixture = UploadFixture & {
  expectedCell: string;
  csvText: string;
};

export type ImageUploadFixture = UploadFixture & {
  title: string;
};

function seedFromText(input: string): number {
  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function seeded<T>(seedKey: string, factory: () => T): T {
  faker.seed(seedFromText(seedKey));
  return factory();
}

export function createTextUploadFixture(seedKey: string): TextUploadFixture {
  return seeded(seedKey, () => {
    const author = faker.person.fullName();
    const project = faker.commerce.productName();
    const summary = faker.company.catchPhrase();
    const body = faker.lorem.paragraphs({ min: 2, max: 4 }, '\n\n');
    const snippet = faker.lorem.sentence();
    const fullText = [
      `Author: ${author}`,
      `Project: ${project}`,
      `Summary: ${summary}`,
      '',
      snippet,
      '',
      body
    ].join('\n');

    return {
      name: `${slugify(project)}-briefing.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(fullText),
      expectedSnippet: snippet,
      fullText
    };
  });
}

export function createCsvUploadFixture(seedKey: string): CsvUploadFixture {
  return seeded(seedKey, () => {
    const rows = Array.from({ length: 5 }, () => ({
      customer: faker.person.fullName(),
      email: faker.internet.email(),
      city: faker.location.city(),
      spend: faker.finance.amount({ min: 120, max: 9500, dec: 2 })
    }));

    const header = 'customer,email,city,annual_spend';
    const lines = rows.map((row) => `${row.customer},${row.email},${row.city},${row.spend}`);
    const csvText = [header, ...lines].join('\n');

    return {
      name: `${slugify(faker.company.name())}-customers.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csvText),
      expectedCell: rows[0].customer,
      csvText
    };
  });
}

export function createImageUploadFixture(seedKey: string): ImageUploadFixture {
  return seeded(seedKey, () => {
    const title = faker.company.catchPhrase();
    const accent = faker.color.rgb({ prefix: '#' });
    const accentSoft = faker.color.rgb({ prefix: '#' });
    const cardId = faker.string.alphanumeric({ casing: 'upper', length: 8 });
    const owner = faker.person.fullName();
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent}" />
      <stop offset="100%" stop-color="${accentSoft}" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" rx="40" fill="url(#bg)" />
  <rect x="64" y="64" width="1072" height="502" rx="32" fill="rgba(255,255,255,0.12)" />
  <text x="96" y="156" fill="#ffffff" font-family="Verdana, sans-serif" font-size="34">Release card ${escapeXml(cardId)}</text>
  <text x="96" y="252" fill="#ffffff" font-family="Verdana, sans-serif" font-size="76" font-weight="700">${escapeXml(title)}</text>
  <text x="96" y="330" fill="#f6f7fb" font-family="Verdana, sans-serif" font-size="30">Prepared by ${escapeXml(owner)}</text>
  <text x="96" y="520" fill="#f6f7fb" font-family="Verdana, sans-serif" font-size="28">${escapeXml(faker.company.buzzPhrase())}</text>
</svg>`.trim();

    return {
      name: `${slugify(title)}.svg`,
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(svg),
      title
    };
  });
}