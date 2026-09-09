import { canExpandIssueDraft } from '../chat/issues/expand-issue-guards';
import { findIssueById } from '../state/issues-store';
import type { IssueCard } from '../types';
import { iconHtml } from './icon';
import {
  isIssueDraftExpanding,
  isIssueExpandOverlayOpen,
} from './issues-expand-state';

export { isIssueDraftExpanding, isIssueExpandOverlayOpen };

const IDLE_LABEL = 'Expand issue';
const IDLE_TITLE = 'Expand title, description, labels, and priority from the current card';
const BUSY_LABEL = 'Expanding issue — click to cancel';
const BUSY_TITLE = 'Expanding… click to cancel';

const EXPAND_MARKUP =
  iconHtml('sparkles', { className: 'composer-expand-btn__icon', size: 16 }) +
  '<span class="composer-expand-btn__spinner" aria-hidden="true"></span>';

export type IssueExpandButtonVariant = 'peek' | 'board';

function paintExpandButton(btn: HTMLButtonElement, busy: boolean): void {
  btn.classList.toggle('composer-expand-btn--busy', busy);
  btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  btn.setAttribute('aria-label', busy ? BUSY_LABEL : IDLE_LABEL);
  btn.title = busy ? BUSY_TITLE : IDLE_TITLE;
}

/** Sparkles control matching the composer prompt expander icon. */
export function createIssueExpandButton(
  issue: IssueCard,
  variant: IssueExpandButtonVariant,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className =
    variant === 'peek'
      ? 'issues-detail__icon-btn composer-expand-btn issues-expand-btn'
      : 'issues-card__expand-btn composer-expand-btn issues-expand-btn';
  btn.dataset.issueExpand = issue.id;
  btn.innerHTML = EXPAND_MARKUP;
  const busy = isIssueDraftExpanding(issue.id);
  paintExpandButton(btn, busy);
  btn.disabled = busy ? false : !canExpandIssueDraft(issue);
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    void onExpandButtonClick(issue.id);
  });
  return btn;
}

/** Refresh busy/disabled on every mounted sparkles control (after lazy module sync). */
export function syncIssueExpandButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-issue-expand]').forEach((btn) => {
    const id = btn.dataset.issueExpand ?? '';
    const busy = isIssueDraftExpanding(id);
    paintExpandButton(btn, busy);
    if (!busy) {
      const issue = findIssueById(id);
      btn.disabled = !issue || !canExpandIssueDraft(issue);
    } else {
      btn.disabled = false;
    }
  });
}

async function onExpandButtonClick(issueId: string): Promise<void> {
  const expand = await import('./issues-expand');
  if (isIssueDraftExpanding(issueId)) {
    expand.closeIssueExpandOverlay();
    return;
  }
  await expand.startIssueExpandFromUi(issueId);
}

/** Open the review overlay (loads expand module on first use). */
export async function startIssueExpandFromUi(issueId: string): Promise<void> {
  const expand = await import('./issues-expand');
  await expand.startIssueExpandFromUi(issueId);
}

/** Discard / close without saving. */
export function closeIssueExpandOverlay(): void {
  void import('./issues-expand').then((m) => m.closeIssueExpandOverlay());
}
