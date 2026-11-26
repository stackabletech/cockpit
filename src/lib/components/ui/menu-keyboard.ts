/** The enabled items of a menu, in document order. */
export function menuItems(menu: HTMLElement): HTMLElement[] {
  return [
    ...menu.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not(:disabled):not([aria-disabled="true"])'
    )
  ];
}

/**
 * Moves the focus between the items of a menu with the arrow keys, Home and End, as in the WAI-ARIA
 * menu pattern. Escape is left to the popover around the menu, which closes on it.
 */
export function handleMenuKeydown(event: KeyboardEvent, menu: HTMLElement): void {
  const items = menuItems(menu);
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  let next: number;
  switch (event.key) {
    case 'ArrowDown':
      next = index < 0 || index >= last ? 0 : index + 1;
      break;
    case 'ArrowUp':
      next = index <= 0 ? last : index - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = last;
      break;
    default:
      return;
  }
  event.preventDefault();
  items[next].focus();
}
