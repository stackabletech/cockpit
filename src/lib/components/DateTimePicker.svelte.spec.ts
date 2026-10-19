import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DateTimePicker from './DateTimePicker.svelte';

describe('DateTimePicker', () => {
  it('passes aria-describedby to the text input', async () => {
    render(DateTimePicker, { id: 'date', value: 'nope', invalid: true, describedby: 'date-error' });
    const input = page.getByRole('textbox');
    await expect.element(input).toHaveAttribute('aria-describedby', 'date-error');
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps a day in the tab order after changing month', async () => {
    render(DateTimePicker, { value: '2027-03-31' });
    await page.getByRole('button', { name: 'Open date picker' }).click();
    const picker = page.getByRole('dialog', { name: 'Date picker' });
    await expect.element(picker).toBeVisible();

    const previous = page.getByRole('button', { name: 'Previous month' });
    await previous.click();
    await expect.element(previous).toHaveFocus();
    // March 31st clamps to the last day of February.
    await expect
      .element(picker.getByRole('button', { name: /February 28, 2027/ }))
      .toHaveAttribute('tabindex', '0');

    await userEvent.tab();
    await userEvent.tab();
    await expect.element(picker.getByRole('button', { name: /February 28, 2027/ })).toHaveFocus();
  });

  it('returns focus to the trigger on Escape', async () => {
    render(DateTimePicker, { value: '2027-03-15' });
    const trigger = page.getByRole('button', { name: 'Open date picker' });
    await trigger.click();
    const picker = page.getByRole('dialog', { name: 'Date picker' });
    await expect.element(picker.getByRole('button', { name: /March 15, 2027/ })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    await expect.poll(() => picker.query()).toBeNull();
    await expect.element(trigger).toHaveFocus();
  });

  it('writes the picked day and returns focus to the trigger', async () => {
    render(DateTimePicker, { value: '2027-03-15' });
    const trigger = page.getByRole('button', { name: 'Open date picker' });
    await trigger.click();
    const picker = page.getByRole('dialog', { name: 'Date picker' });
    await picker.getByRole('button', { name: /March 20, 2027/ }).click();

    await expect.poll(() => picker.query()).toBeNull();
    await expect.element(page.getByRole('textbox')).toHaveValue('2027-03-20');
    await expect.element(trigger).toHaveFocus();
  });

  it('returns focus to the trigger when dismissed on empty space', async () => {
    const empty = document.createElement('div');
    empty.dataset.testid = 'empty';
    empty.style.height = '100px';
    document.body.append(empty);
    try {
      render(DateTimePicker, { value: '2027-03-15' });
      const trigger = page.getByRole('button', { name: 'Open date picker' });
      await trigger.click();
      const picker = page.getByRole('dialog', { name: 'Date picker' });
      await expect.element(picker.getByRole('button', { name: /March 15, 2027/ })).toHaveFocus();

      await page.getByTestId('empty').click();
      await expect.poll(() => picker.query()).toBeNull();
      await expect.element(trigger).toHaveFocus();
    } finally {
      empty.remove();
    }
  });

  it('leaves focus on another control clicked while open', async () => {
    const outside = document.createElement('input');
    outside.setAttribute('aria-label', 'Outside');
    document.body.append(outside);
    try {
      render(DateTimePicker, { value: '2027-03-15' });
      await page.getByRole('button', { name: 'Open date picker' }).click();
      const picker = page.getByRole('dialog', { name: 'Date picker' });
      await expect.element(picker).toBeVisible();

      await page.getByRole('textbox', { name: 'Outside' }).click();
      await expect.poll(() => picker.query()).toBeNull();
      await expect.element(page.getByRole('textbox', { name: 'Outside' })).toHaveFocus();
    } finally {
      outside.remove();
    }
  });
});
