import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import TextPreview from './TextPreview.svelte';

describe('TextPreview', () => {
  it('should render a pre element with aria-label', async () => {
    render(TextPreview, { text: 'hello world', contentType: 'text/plain' });

    const pre = page.getByRole('generic', { name: 'File content preview' });
    await expect.element(page.getByLabelText('File content preview')).toBeInTheDocument();
  });

  it('should set data-language to text for plain text', async () => {
    render(TextPreview, { text: 'hello', contentType: 'text/plain' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveAttribute('data-language', 'text');
  });

  it('should detect and format JSON', async () => {
    const obj = { name: faker.person.fullName(), age: faker.number.int({ min: 18, max: 80 }) };
    const raw = JSON.stringify(obj);
    render(TextPreview, { text: raw, contentType: 'application/json' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveAttribute('data-language', 'json');
    // Should be pretty-printed (has newlines with indentation)
    await expect.element(pre).toHaveTextContent(obj.name);
  });

  it('should detect JSON for text/json content type', async () => {
    render(TextPreview, { text: '{"a":1}', contentType: 'text/json' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveAttribute('data-language', 'json');
  });

  it('should detect JSON for +json suffix', async () => {
    render(TextPreview, { text: '{"a":1}', contentType: 'application/vnd.api+json' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveAttribute('data-language', 'json');
  });

  it('should show raw text for invalid JSON', async () => {
    const invalid = '{not valid json: }}}';
    render(TextPreview, { text: invalid, contentType: 'application/json' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveTextContent(invalid);
  });

  it('should detect CSS language', async () => {
    render(TextPreview, { text: 'body { color: red; }', contentType: 'text/css' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveAttribute('data-language', 'css');
  });

  it('should detect HTML language', async () => {
    render(TextPreview, { text: '<h1>Hello</h1>', contentType: 'text/html' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveAttribute('data-language', 'html');
  });

  it('should detect JavaScript language', async () => {
    render(TextPreview, { text: 'const x = 1;', contentType: 'text/javascript' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveAttribute('data-language', 'javascript');
  });

  it('should detect markdown language', async () => {
    render(TextPreview, { text: '# Title', contentType: 'text/markdown' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveAttribute('data-language', 'markdown');
  });

  it('should handle empty text', async () => {
    render(TextPreview, { text: '', contentType: 'text/plain' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toBeInTheDocument();
  });

  it('should handle special characters', async () => {
    const text = '<script>alert("xss")</script> & "quotes"';
    render(TextPreview, { text, contentType: 'text/plain' });

    const pre = page.getByLabelText('File content preview');
    await expect.element(pre).toHaveTextContent(text);
  });
});
