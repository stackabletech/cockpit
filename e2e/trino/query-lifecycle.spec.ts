import { test, expect, type Page } from '@playwright/test';
import { waitForHydration, waitForQueryComplete, setTabSql } from '../support/helpers';
import { mockMarker, mockTrinoStatements, releaseMockTrino } from '../support/mock-trino';

/**
 * Query lifecycle against the multi-page mock Trino protocol: polling, running
 * state, cancellation and failures reported without error details.
 */
test.describe('Trino query lifecycle', () => {
  test.use({ locale: 'en-US' });

  const releases: string[] = [];

  test.afterEach(async () => {
    // Free gates and holds of failed tests so the shared mock does not keep them.
    await Promise.all(releases.splice(0).map(releaseMockTrino));
  });

  /** A gate or hold id that is released after the test at the latest. */
  function releaseId(): string {
    const id = mockMarker();
    releases.push(id);
    return id;
  }

  async function openEditor(page: Page, sql: string) {
    await setTabSql(page, sql);
    await page.goto('/trino');
    await waitForHydration(page);
    await page.locator('.monaco-editor').first().click();
  }

  const runButton = (page: Page) => page.getByRole('button', { name: 'Run', exact: true });
  const cancelButton = (page: Page) => page.getByRole('button', { name: 'Cancel' });
  const statusBadge = (page: Page) => page.locator('[data-query-state]');
  const statementToggles = (page: Page) =>
    page.getByRole('button', { name: /Toggle statement \d+ results/ });

  test('collects rows from all result pages', async ({ page }) => {
    await openEditor(page, 'SELECT * FROM paged_table');

    await runButton(page).click();
    await waitForQueryComplete(page);

    await expect(statusBadge(page)).toHaveAttribute('data-query-state', 'FINISHED');
    await expect(page.getByText('Rows 1–25 of 30')).toBeVisible();
  });

  test('keeps fetching pages when the first response is already finished', async ({ page }) => {
    await openEditor(page, 'SELECT * FROM finished_paged_table');

    await runButton(page).click();
    await waitForQueryComplete(page);

    await expect(page.getByText('Rows 1–20 of 20')).toBeVisible();
  });

  test('shows a running query and cancels it in Trino', async ({ page }) => {
    const hold = releaseId();
    await openEditor(page, `SELECT 1 /* HOLD:${hold} */`);

    await runButton(page).click();
    await expect(statusBadge(page)).toHaveAttribute('data-query-state', 'RUNNING');

    await cancelButton(page).click();

    await expect(statusBadge(page)).toHaveAttribute('data-query-state', 'CANCELLED');
    await expect(cancelButton(page)).toBeHidden();
    await expect
      .poll(() => mockTrinoStatements(hold, 'cancelled'))
      .toEqual([`SELECT 1 /* HOLD:${hold} */`]);
  });

  test('restores a running script after reload and finishes it', async ({ page }) => {
    const hold = releaseId();
    await openEditor(page, `SELECT 1; SELECT 2 /* HOLD:${hold} */`);

    await page.keyboard.press('Control+Shift+Enter');
    await expect(page.getByText('Statement 2 of 2')).toBeVisible();

    await page.reload();
    await waitForHydration(page);
    await expect(statusBadge(page)).toHaveAttribute('data-query-state', 'RUNNING');
    await expect(cancelButton(page)).toBeVisible();

    await releaseMockTrino(hold);

    await expect(statusBadge(page)).toHaveAttribute('data-query-state', 'FINISHED');
    await expect(statementToggles(page)).toHaveCount(2);
  });

  test('fails a statement reported as FAILED without error details', async ({ page }) => {
    await openEditor(page, 'SELECT 1; FAILS_SILENTLY; SELECT 3');

    await page.keyboard.press('Control+Shift+Enter');
    await waitForQueryComplete(page);

    await expect(statusBadge(page)).toHaveAttribute('data-query-state', 'FAILED');
    await expect(page.getByText('Query failed')).toBeVisible();
    await expect(page.getByText('1 statement was skipped due to a preceding error.')).toBeVisible();
  });

  test('fails a query that turns FAILED during polling without error details', async ({ page }) => {
    await openEditor(page, 'SELECT * FROM t WHERE FAILS_LATER');

    await runButton(page).click();
    await waitForQueryComplete(page);

    await expect(statusBadge(page)).toHaveAttribute('data-query-state', 'FAILED');
    await expect(page.getByText('Query failed')).toBeVisible();
  });

  test('re-running between statements stops the previous script', async ({ page }) => {
    const marker = mockMarker();
    const gate = releaseId();
    await openEditor(
      page,
      `SELECT 1 /* ${marker} */; SELECT 2 /* GATE:${gate} ${marker} */; SELECT 3 /* ${marker} */`
    );

    await page.keyboard.press('Control+Shift+Enter');
    // Statement 1 is done and statement 2 is held in Trino's submit: the script
    // is between statements and has no active query.
    await expect
      .poll(() => mockTrinoStatements(marker, 'submitted'))
      .toEqual([`SELECT 1 /* ${marker} */`, `SELECT 2 /* GATE:${gate} ${marker} */`]);

    const rerunMarker = mockMarker();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(`SELECT 9 /* ${rerunMarker} */`);
    await runButton(page).click();
    await expect.poll(() => mockTrinoStatements(rerunMarker, 'submitted')).toHaveLength(1);

    await releaseMockTrino(gate);

    // The statement Trino accepted for the stale script is cancelled.
    await expect
      .poll(() => mockTrinoStatements(marker, 'cancelled'))
      .toEqual([`SELECT 2 /* GATE:${gate} ${marker} */`]);

    // Only the re-run's result is kept on the server.
    await page.reload();
    await waitForHydration(page);
    await expect(statusBadge(page)).toHaveAttribute('data-query-state', 'FINISHED');
    await expect(page.getByRole('table', { name: 'Query results' })).toBeVisible();
    await expect(statementToggles(page)).toHaveCount(0);

    // Checked last, so a stale script that kept going has had time to submit statement 3.
    expect(await mockTrinoStatements(marker, 'submitted')).not.toContain(
      `SELECT 3 /* ${marker} */`
    );
  });
});
