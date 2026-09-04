/**
 * Feature-detects CSS anchor positioning. DaisyUI's dropdown popover styles
 * rely on `position-area` (formerly `inset-area`); see the
 * `@supports not (position-area: bottom)` fallback rule in dropdown.css.
 */
export function supportsAnchorPositioning(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('position-area: bottom');
}

const GAP = 8;

/**
 * Positions a popover beneath its trigger, flipping above when there isn't
 * enough room below and clamping it inside the viewport. Popovers drift to the
 * top-left corner of the viewport in browsers without anchor-positioning
 * support, so this replaces the CSS `position-area`/`position-anchor` combo
 * there and keeps the dropdown anchored to its trigger as expected.
 */
export function positionPopoverRelativeToTrigger(
  trigger: HTMLElement,
  popover: HTMLElement,
  options: { align?: 'start' | 'end'; matchWidth?: boolean } = {}
): void {
  const { align = 'start', matchWidth = false } = options;
  const triggerRect = trigger.getBoundingClientRect();
  const popoverWidth = matchWidth ? triggerRect.width : popover.offsetWidth;
  const popoverHeight = popover.offsetHeight;

  let top = triggerRect.bottom + GAP;
  if (top + popoverHeight > window.innerHeight - GAP) {
    top = Math.max(GAP, triggerRect.top - popoverHeight - GAP);
  }

  const naturalLeft = align === 'end' ? triggerRect.right - popoverWidth : triggerRect.left;
  const left = Math.min(Math.max(GAP, naturalLeft), window.innerWidth - popoverWidth - GAP);

  popover.style.position = 'fixed';
  popover.style.inset = 'auto';
  popover.style.margin = '0';
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
  if (matchWidth) popover.style.width = `${triggerRect.width}px`;
}
