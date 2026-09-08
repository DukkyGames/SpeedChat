/**
 * Settings → Issues type color picker (MIN-861).
 * Fixed palette only — same tokens/hex values stored on taxonomy rows.
 */

import { TAXONOMY_COLOR_PALETTE } from '../issues/taxonomy';
import { closeIssueTypeIconPicker } from './issue-type-icon-picker';

export interface IssueTypeColorPickerOptions {
  anchor: HTMLElement;
  value: string;
  onSelect: (color: string) => void;
}

let popoverEl: HTMLDivElement | null = null;
let anchorEl: HTMLElement | null = null;
let open = false;
let outsidePointerHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

function detachGlobalListeners(): void {
  if (outsidePointerHandler) {
    document.removeEventListener('pointerdown', outsidePointerHandler, true);
    outsidePointerHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

/** Close the type color picker if open. */
export function closeIssueTypeColorPicker(): void {
  if (!open) return;
  open = false;
  detachGlobalListeners();
  anchorEl?.setAttribute('aria-expanded', 'false');
  anchorEl = null;
  popoverEl?.remove();
  popoverEl = null;
}

function positionPopover(anchor: HTMLElement, popover: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const popoverWidth = popover.offsetWidth || 200;
  const popoverHeight = popover.offsetHeight || 120;

  let top = rect.bottom + 4;
  if (top + popoverHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popoverHeight - 4);
  }

  let left = rect.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - popoverWidth - margin));

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function attachGlobalListeners(): void {
  outsidePointerHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!popoverEl || !anchorEl) return;
    if (popoverEl.contains(target) || anchorEl.contains(target)) return;
    closeIssueTypeColorPicker();
  };
  document.addEventListener('pointerdown', outsidePointerHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    closeIssueTypeColorPicker();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

function colorLabel(color: string): string {
  const token = color.match(/^var\(--mn-([a-z0-9-]+)\)$/);
  if (token) return token[1].replace(/-/g, ' ');
  return color;
}

/** Open the swatch grid anchored to a settings row button. */
export function openIssueTypeColorPicker(options: IssueTypeColorPickerOptions): void {
  closeIssueTypeIconPicker();
  closeIssueTypeColorPicker();

  const { anchor, value, onSelect } = options;
  anchorEl = anchor;
  open = true;
  anchor.setAttribute('aria-expanded', 'true');

  popoverEl = document.createElement('div');
  popoverEl.className = 'settings-issues-color-picker';
  popoverEl.setAttribute('role', 'dialog');
  popoverEl.setAttribute('aria-label', 'Choose color');

  const grid = document.createElement('div');
  grid.className = 'settings-issues-color-picker__grid';

  for (const color of TAXONOMY_COLOR_PALETTE) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-issues-color-picker__option';
    btn.title = colorLabel(color);
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', color === value ? 'true' : 'false');
    btn.classList.toggle('is-selected', color === value);
    btn.style.setProperty('--issues-chip-color', color);
    btn.addEventListener('click', () => {
      onSelect(color);
      closeIssueTypeColorPicker();
    });
    grid.appendChild(btn);
  }

  popoverEl.appendChild(grid);
  document.body.appendChild(popoverEl);
  positionPopover(anchor, popoverEl);
  attachGlobalListeners();
}

/** Button that shows the current swatch and opens the picker on click. */
export function createIssueTypeColorPickerButton(
  value: string,
  label: string,
  onSelect: (color: string) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'settings-issues-color-btn';
  btn.title = 'Choose color';
  btn.setAttribute('aria-label', `Color for ${label}`);
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');

  const paint = (color: string): void => {
    btn.style.setProperty('--issues-chip-color', color);
  };

  let current = value;
  paint(current);
  btn.addEventListener('click', () => {
    openIssueTypeColorPicker({
      anchor: btn,
      value: current,
      onSelect: (color) => {
        current = color;
        paint(color);
        onSelect(color);
      },
    });
  });

  return btn;
}
