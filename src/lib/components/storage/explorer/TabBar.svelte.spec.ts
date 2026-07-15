import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TabBar from './TabBar.svelte';
import { TabsState } from '$lib/storage/tabs.svelte.js';
import { StorageState } from '$lib/storage/state.svelte.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage(bucket = 'test-bucket', prefix = ''): StorageState {
  const state = new StorageState({ connected: true });
  state.bucket = bucket;
  state.prefix = prefix;
  state.objects = { objects: [], hasNextPage: false, currentPage: 1, pageSize: 25 };
  return state;
}

function makeTabsState(storage: StorageState, tabCount = 2): TabsState {
  const ts = new TabsState(storage, { persistEnabled: false });
  ts.ensureInitialTab();
  for (let i = 1; i < tabCount; i++) {
    ts.addTab();
  }
  return ts;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TabBar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders a tab for each entry in tabsState.tabs', async () => {
    const storage = makeStorage('bucket-a');
    const tabsState = makeTabsState(storage, 2);
    render(TabBar, { tabsState });

    const tabs = page.getByRole('tab');
    // 2 tabs rendered
    await expect.element(tabs.nth(0)).toBeInTheDocument();
    await expect.element(tabs.nth(1)).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected="true"', async () => {
    const storage = makeStorage('bucket-a');
    const tabsState = makeTabsState(storage, 2);
    render(TabBar, { tabsState });

    const activeTab = page.getByRole('tab', { selected: true });
    await expect.element(activeTab).toBeInTheDocument();
  });

  it('has a tablist with an accessible label', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    render(TabBar, { tabsState });

    await expect.element(page.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders a "New Tab" plus button', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    render(TabBar, { tabsState });

    await expect.element(page.getByRole('button', { name: 'New Tab' })).toBeInTheDocument();
  });

  it('calls addTab when the plus button is clicked', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    const spy = vi.spyOn(tabsState, 'addTab');
    render(TabBar, { tabsState });

    await page.getByRole('button', { name: 'New Tab' }).click();

    expect(spy).toHaveBeenCalled();
  });

  it('calls switchTo with the correct id when a non-active tab is clicked', async () => {
    const storage = makeStorage('bucket', '');
    const tabsState = makeTabsState(storage, 2);
    // After makeTabsState(2): tabs[0] is the initial tab (not active), tabs[1] is active
    const spy = vi.spyOn(tabsState, 'switchTo');
    render(TabBar, { tabsState });

    // Click the first tab (not the active one)
    await page.getByRole('tab').nth(0).click();

    expect(spy).toHaveBeenCalledWith(tabsState.tabs[0].id);
  });

  it('shows close buttons when multiple tabs exist', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    render(TabBar, { tabsState });

    // Close tab buttons have aria-label="Close tab"
    const closeButtons = page.getByRole('button', { name: 'Close tab' });
    await expect.element(closeButtons.first()).toBeInTheDocument();
  });

  it('calls closeTab when a close button is clicked', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    const spy = vi.spyOn(tabsState, 'closeTab');
    render(TabBar, { tabsState });

    await page.getByRole('button', { name: 'Close tab' }).first().click();

    expect(spy).toHaveBeenCalled();
  });

  it('opens a context menu on right-click of a tab', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    render(TabBar, { tabsState });

    await page.getByRole('tab').first().click({ button: 'right' });

    await expect.element(page.getByRole('menu')).toBeInTheDocument();
  });

  it('context menu contains Rename tab and Close tab options', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    render(TabBar, { tabsState });

    await page.getByRole('tab').first().click({ button: 'right' });

    await expect.element(page.getByRole('menuitem', { name: 'Rename tab' })).toBeInTheDocument();
    await expect.element(page.getByRole('menuitem', { name: 'Close tab' })).toBeInTheDocument();
  });

  it('calls renameTab via context menu rename action', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    const spy = vi.spyOn(tabsState, 'renameTab');
    render(TabBar, { tabsState });

    const firstTabId = tabsState.tabs[0].id;
    await page.getByRole('tab').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename tab' }).click();

    // The rename input should appear (context menu closes and rename mode starts)
    await expect.element(page.getByRole('textbox', { name: 'Rename tab' })).toBeInTheDocument();

    await page.getByRole('textbox', { name: 'Rename tab' }).fill('Renamed');
    await userEvent.keyboard('{Enter}');

    expect(spy).toHaveBeenCalledWith(firstTabId, 'Renamed');
  });

  it('shows rename input on double-click of a tab', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    render(TabBar, { tabsState });

    await page.getByRole('tab').first().dblClick();

    await expect.element(page.getByRole('textbox', { name: 'Rename tab' })).toBeInTheDocument();
  });

  it('commits rename on Enter key', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    const spy = vi.spyOn(tabsState, 'renameTab');
    render(TabBar, { tabsState });

    const firstTabId = tabsState.tabs[0].id;
    await page.getByRole('tab').first().dblClick();

    await page.getByRole('textbox', { name: 'Rename tab' }).fill('My New Name');
    await userEvent.keyboard('{Enter}');

    expect(spy).toHaveBeenCalledWith(firstTabId, 'My New Name');
  });

  it('cancels rename on Escape key without calling renameTab', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    const spy = vi.spyOn(tabsState, 'renameTab');
    render(TabBar, { tabsState });

    await page.getByRole('tab').first().dblClick();

    await page.getByRole('textbox', { name: 'Rename tab' }).fill('Something');
    await userEvent.keyboard('{Escape}');

    expect(spy).not.toHaveBeenCalled();
    await expect.element(page.getByRole('textbox', { name: 'Rename tab' })).not.toBeInTheDocument();
  });

  it('calls closeTab via context menu close action', async () => {
    const storage = makeStorage();
    const tabsState = makeTabsState(storage, 2);
    const spy = vi.spyOn(tabsState, 'closeTab');
    const firstTabId = tabsState.tabs[0].id;
    render(TabBar, { tabsState });

    await page.getByRole('tab').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close tab' }).click();

    expect(spy).toHaveBeenCalledWith(firstTabId);
  });
});
