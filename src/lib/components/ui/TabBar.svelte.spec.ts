import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TabBar, { tabElementId } from './TabBar.svelte';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ITEMS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' }
];

function renderTabBar(props: Record<string, unknown> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onAdd: vi.fn(),
    onRename: vi.fn()
  };
  render(TabBar, {
    items: ITEMS,
    activeId: 'a',
    ariaLabel: 'Test tabs',
    closeLabel: (item: { label: string }) => `Close ${item.label}`,
    addLabel: 'Add tab',
    renameLabel: 'Rename tab',
    ...handlers,
    ...props
  });
  return handlers;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TabBar', () => {
  it('renders a labelled tablist that only contains tabs', async () => {
    renderTabBar();

    const tablist = page.getByRole('tablist', { name: 'Test tabs' });
    await expect.element(tablist).toBeInTheDocument();
    expect(tablist.getByRole('tab').elements()).toHaveLength(3);
    expect(tablist.getByRole('button').elements()).toHaveLength(0);
  });

  it('marks only the active tab as selected and tabbable', async () => {
    renderTabBar({ activeId: 'b' });

    await expect.element(page.getByRole('tab', { name: 'Beta' })).toHaveAttribute('tabindex', '0');
    await expect.element(page.getByRole('tab', { selected: true })).toHaveAccessibleName('Beta');
    await expect
      .element(page.getByRole('tab', { name: 'Alpha' }))
      .toHaveAttribute('tabindex', '-1');
  });

  it('selects tabs with the arrow, Home and End keys', async () => {
    const { onSelect } = renderTabBar();

    await page.getByRole('tab', { name: 'Alpha' }).click();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('c');
    await userEvent.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith('a');
    await userEvent.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith('c');
  });

  it('moves focus with each of several fast arrow key presses', async () => {
    const { onSelect } = renderTabBar();

    await page.getByRole('tab', { name: 'Alpha' }).click();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');

    expect(onSelect).toHaveBeenLastCalledWith('c');
    await expect.element(page.getByRole('tab', { name: 'Gamma' })).toHaveFocus();
  });

  it('closes the focused tab with Delete and announces the shortcut', async () => {
    const { onClose } = renderTabBar();
    const tab = page.getByRole('tab', { name: 'Alpha' });

    await expect.element(tab).toHaveAttribute('aria-keyshortcuts', 'Delete F2');
    await tab.click();
    await userEvent.keyboard('{Delete}');

    expect(onClose).toHaveBeenCalledWith('a');
  });

  it('does not offer closing when only one tab exists', async () => {
    const { onClose } = renderTabBar({ items: [ITEMS[0]] });
    const tab = page.getByRole('tab', { name: 'Alpha' });

    await expect.element(tab).toHaveAttribute('aria-keyshortcuts', 'F2');
    await tab.click();
    await userEvent.keyboard('{Delete}');

    expect(onClose).not.toHaveBeenCalled();
    expect(
      page.getByRole('button', { name: 'Close Alpha', includeHidden: true }).elements()
    ).toHaveLength(0);
  });

  it('respects closable: false', async () => {
    const { onClose } = renderTabBar({
      items: [{ ...ITEMS[0], closable: false }, ITEMS[1]]
    });

    await page.getByRole('tab', { name: 'Alpha' }).click();
    await userEvent.keyboard('{Delete}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes a tab on middle-click', async () => {
    const { onClose } = renderTabBar();

    await page.getByRole('tab', { name: 'Beta' }).click({ button: 'middle' });

    expect(onClose).toHaveBeenCalledWith('b');
  });

  it('hides the close button from assistive technology', async () => {
    const { onClose } = renderTabBar();
    const close = page.getByRole('button', { name: 'Close Beta', includeHidden: true });

    await expect.element(close).toHaveAttribute('aria-hidden', 'true');
    await expect.element(close).toHaveAttribute('tabindex', '-1');
    await close.click();

    expect(onClose).toHaveBeenCalledWith('b');
  });

  it('leaves focus alone when a tab is closed with the mouse', async () => {
    const { onClose } = renderTabBar();

    await page.getByRole('tab', { name: 'Alpha' }).click();
    await page.getByRole('button', { name: 'Close Beta', includeHidden: true }).click();
    await new Promise(requestAnimationFrame);

    expect(onClose).toHaveBeenCalledWith('b');
    await expect.element(page.getByRole('tab', { name: 'Gamma' })).not.toHaveFocus();
  });

  it('routes drags the consumer accepts to externalDrag instead of reordering', async () => {
    const externalDrag = {
      accepts: (e: DragEvent) => e.dataTransfer?.types.includes('application/x-test') ?? false,
      over: vi.fn(),
      leave: vi.fn(),
      drop: vi.fn()
    };
    const onReorder = vi.fn();
    renderTabBar({ externalDrag, onReorder, dropTargetId: 'b' });
    const tab = page.getByRole('tab', { name: 'Beta' }).element();

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('application/x-test', 'payload');
    for (const type of ['dragover', 'dragleave', 'drop']) {
      tab.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }));
    }

    expect(externalDrag.over).toHaveBeenCalledWith(expect.any(DragEvent), 'b');
    expect(externalDrag.leave).toHaveBeenCalledWith(expect.any(DragEvent), 'b');
    expect(externalDrag.drop).toHaveBeenCalledWith(expect.any(DragEvent), 'b');
    expect(onReorder).not.toHaveBeenCalled();
    // dropTargetId highlights the drop target
    expect(tab.parentElement?.className).toContain('ring-primary');
  });

  it('reorders tabs by dragging one onto another', async () => {
    const onReorder = vi.fn();
    renderTabBar({ onReorder });
    const source = page.getByRole('tab', { name: 'Alpha' }).element();
    const target = page.getByRole('tab', { name: 'Gamma' }).element();

    const dataTransfer = new DataTransfer();
    const init = { dataTransfer, bubbles: true, cancelable: true };
    source.dispatchEvent(new DragEvent('dragstart', init));
    target.dispatchEvent(new DragEvent('dragover', init));
    target.dispatchEvent(new DragEvent('drop', init));

    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });

  it('gives tabs the id that tabElementId returns', async () => {
    renderTabBar();

    await expect
      .element(page.getByRole('tab', { name: 'Beta' }))
      .toHaveAttribute('id', tabElementId('b'));
  });

  it('renames with F2 and Enter, then returns focus to the tab', async () => {
    const { onRename } = renderTabBar();

    await page.getByRole('tab', { name: 'Alpha' }).click();
    await userEvent.keyboard('{F2}');
    const input = page.getByRole('textbox', { name: 'Rename tab' });
    await expect.element(input).toHaveFocus();
    await input.fill('Renamed');
    await userEvent.keyboard('{Enter}');

    expect(onRename).toHaveBeenCalledWith('a', 'Renamed');
    await expect.element(page.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
  });

  it('keeps rename keys away from the tab shortcuts', async () => {
    const { onClose, onSelect } = renderTabBar();

    await page.getByRole('tab', { name: 'Alpha' }).dblClick();
    onSelect.mockClear();
    await page.getByRole('textbox', { name: 'Rename tab' }).click();
    await userEvent.keyboard('{Delete}{ArrowRight}');

    expect(onClose).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancels renaming with Escape', async () => {
    const { onRename } = renderTabBar();

    await page.getByRole('tab', { name: 'Alpha' }).dblClick();
    await page.getByRole('textbox', { name: 'Rename tab' }).fill('Discarded');
    await userEvent.keyboard('{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    await expect.element(page.getByRole('textbox', { name: 'Rename tab' })).not.toBeInTheDocument();
  });

  it('offers no renaming without onRename', async () => {
    renderTabBar({ onRename: undefined });
    const tab = page.getByRole('tab', { name: 'Alpha' });

    await expect.element(tab).toHaveAttribute('aria-keyshortcuts', 'Delete');
    await tab.dblClick();

    await expect.element(page.getByRole('textbox')).not.toBeInTheDocument();
  });

  it('hides the add button at maxItems', async () => {
    renderTabBar({ maxItems: 3 });

    await expect.element(page.getByRole('button', { name: 'Add tab' })).not.toBeInTheDocument();
  });

  it('calls onAdd from the add button outside the tablist', async () => {
    const { onAdd } = renderTabBar();

    await page.getByRole('button', { name: 'Add tab' }).click();

    expect(onAdd).toHaveBeenCalled();
  });
});
