import { page } from 'vitest/browser';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { faker } from '@faker-js/faker';
import TimestampDisplay from './TimestampDisplay.svelte';

describe('TimestampDisplay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('absolute mode (relative=false)', () => {
    it('should render a formatted date', async () => {
      const date = new Date(2026, 4, 13); // 13 May 2026
      render(TimestampDisplay, { date });

      await expect.element(page.getByText(/May.*13.*2026|13.*May.*2026/)).toBeInTheDocument();
    });

    it('should accept an ISO string', async () => {
      const date = '2025-01-15T10:30:00Z';
      render(TimestampDisplay, { date });

      await expect.element(page.getByText(/Jan.*15.*2025|15.*Jan.*2025/)).toBeInTheDocument();
    });

    it('should have a tooltip with full timestamp', async () => {
      const date = new Date(2026, 4, 13, 14, 30);
      render(TimestampDisplay, { date });

      const el = page.getByText(/May.*13.*2026|13.*May.*2026/);
      await expect.element(el).toHaveAttribute('data-tip');
    });
  });

  describe('relative mode (relative=true)', () => {
    it('should show "just now" for less than 1 minute ago', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 30));

      const date = new Date(2026, 0, 1, 12, 0, 0);
      render(TimestampDisplay, { date, relative: true });

      await expect.element(page.getByText('just now')).toBeInTheDocument();
    });

    it('should show minutes ago', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 5, 0));

      const date = new Date(2026, 0, 1, 12, 0, 0);
      render(TimestampDisplay, { date, relative: true });

      await expect.element(page.getByText('5m ago')).toBeInTheDocument();
    });

    it('should show hours ago', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 15, 0, 0));

      const date = new Date(2026, 0, 1, 12, 0, 0);
      render(TimestampDisplay, { date, relative: true });

      await expect.element(page.getByText('3h ago')).toBeInTheDocument();
    });

    it('should show days ago', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 8, 12, 0, 0));

      const date = new Date(2026, 0, 1, 12, 0, 0);
      render(TimestampDisplay, { date, relative: true });

      await expect.element(page.getByText('7d ago')).toBeInTheDocument();
    });

    it('should show months ago', async () => {
      // 91 days ago guarantees Math.floor(91/30) = 3
      const date = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
      render(TimestampDisplay, { date, relative: true });

      await expect.element(page.getByText('3mo ago')).toBeInTheDocument();
    });

    it('should show years ago', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2028, 0, 1, 12, 0, 0));

      const date = new Date(2026, 0, 1, 12, 0, 0);
      render(TimestampDisplay, { date, relative: true });

      await expect.element(page.getByText('2y ago')).toBeInTheDocument();
    });

    it('should handle boundary at exactly 60 minutes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 13, 0, 0));

      const date = new Date(2026, 0, 1, 12, 0, 0);
      render(TimestampDisplay, { date, relative: true });

      await expect.element(page.getByText('1h ago')).toBeInTheDocument();
    });
  });

  describe('tooltip position', () => {
    it('should default to tooltip-top', async () => {
      const date = new Date();
      render(TimestampDisplay, { date });

      const el = page.getByText(/.+/).element();
      expect(el?.classList.contains('tooltip-top')).toBe(true);
    });

    it('should accept custom tooltip position', async () => {
      const date = new Date();
      render(TimestampDisplay, { date, tooltip: 'tooltip-bottom' });

      const el = page.getByText(/.+/).element();
      expect(el?.classList.contains('tooltip-bottom')).toBe(true);
    });
  });

  describe('edge cases with faker', () => {
    it('should handle random past dates', async () => {
      const date = faker.date.past({ years: 5 });
      render(TimestampDisplay, { date });

      const el = page.getByText(/.+/);
      await expect.element(el).toBeInTheDocument();
    });

    it('should handle ISO string input from faker', async () => {
      const date = faker.date.recent().toISOString();
      render(TimestampDisplay, { date, relative: true });

      const el = page.getByText(/.+/);
      await expect.element(el).toBeInTheDocument();
    });
  });
});
