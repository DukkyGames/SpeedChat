import { canExpandIssueDraft } from '../chat/issues/expand-issue-guards';
import {
  mergeExpandedIssue,
  type ExpandedIssueDraft,
} from '../chat/issues/expand-issue';
import { findIssueById, updateIssue } from '../state/issues-store';
import type {
  ExpandIssueRequest,
  ExpandIssueResult,
} from './issues-expand-client';
import {
  ISSUES_EXPAND_BACKDROP_ID,
  ISSUES_EXPAND_FORM_ID,
  isIssueDraftExpanding,
  isIssueExpandOverlayOpen,
  setIssueExpandRun,
} from './issues-expand-state';
import { setStatus } from './status';
import { showToast } from './toast';

export { isIssueDraftExpanding, isIssueExpandOverlayOpen };

const OVERLAY_FORM_ID = ISSUES_EXPAND_FORM_ID;
const OVERLAY_BACKDROP_ID = ISSUES_EXPAND_BACKDROP_ID;

const IDLE_LABEL = 'Expand issue';
const IDLE_TITLE = 'Expand title and description from the current card';
const BUSY_LABEL = 'Expanding issue — click to cancel';
const BUSY_TITLE = 'Expanding… click to cancel';

interface ExpandRun {
  issueId: string;
  controller: AbortController;
  original: { title: string; description: string };
}

type ExpandIssueFetcher = (input: ExpandIssueRequest) => Promise<ExpandIssueResult>;

let activeRun: ExpandRun | null = null;
/** Test override; production loads the generations client on first expand. */
let expandFetchImpl: ExpandIssueFetcher | null = null;

// ── Fetcher ──────────────────────────────────────────────────────────────────

export function setExpandIssueFetcherForTests(impl: ExpandIssueFetcher | null): void {
  expandFetchImpl = impl;
}

/** Lazy-load the generations client so first paint does not pull it into the store chunk. */
async function resolveExpandFetcher(): Promise<ExpandIssueFetcher> {
  if (expandFetchImpl) return expandFetchImpl;
  const { fetchExpandedIssue } = await import('./issues-expand-client');
  return fetchExpandedIssue;
}

/** Keep toast copy aligned with composer-expand-client without a static import. */
const EXPAND_EMPTY_MESSAGE = 'Model returned no expanded prompt.';
const EXPAND_FAILED_MESSAGE = 'Expand failed — check provider and model in Settings';

function clearActiveRun(): void {
  activeRun = null;
  setIssueExpandRun(null);
}

/** Keep sparkles controls in sync after the lazy expand module mutates run state. */
function syncExpandButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-issue-expand]').forEach((btn) => {
    const id = btn.dataset.issueExpand ?? '';
    const busy = isIssueDraftExpanding(id);
    btn.classList.toggle('composer-expand-btn--busy', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.setAttribute('aria-label', busy ? BUSY_LABEL : IDLE_LABEL);
    btn.title = busy ? BUSY_TITLE : IDLE_TITLE;
    if (!busy) {
      const issue = findIssueById(id);
      btn.disabled = !issue || !canExpandIssueDraft(issue);
    } else {
      btn.disabled = false;
    }
  });
}

// ── Overlay ──────────────────────────────────────────────────────────────────

function overlayEls(): {
  form: HTMLFormElement;
  backdrop: HTMLButtonElement;
  title: HTMLInputElement;
  description: HTMLTextAreaElement;
  apply: HTMLButtonElement;
  discard: HTMLButtonElement;
  status: HTMLParagraphElement;
} | null {
  const form = document.getElementById(OVERLAY_FORM_ID);
  const backdrop = document.getElementById(OVERLAY_BACKDROP_ID);
  const title = document.getElementById('issuesExpandTitle');
  const description = document.getElementById('issuesExpandDescription');
  const apply = document.getElementById('issuesExpandApply');
  const discard = document.getElementById('issuesExpandDiscard');
  const status = document.getElementById('issuesExpandStatus');
  if (
    !(form instanceof HTMLFormElement) ||
    !(backdrop instanceof HTMLButtonElement) ||
    !(title instanceof HTMLInputElement) ||
    !(description instanceof HTMLTextAreaElement) ||
    !(apply instanceof HTMLButtonElement) ||
    !(discard instanceof HTMLButtonElement) ||
    !(status instanceof HTMLParagraphElement)
  ) {
    return null;
  }
  return { form, backdrop, title, description, apply, discard, status };
}

function ensureOverlay(): NonNullable<ReturnType<typeof overlayEls>> {
  const existing = overlayEls();
  if (existing) return existing;

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.id = OVERLAY_BACKDROP_ID;
  backdrop.className = 'issues-new-form__backdrop';
  backdrop.setAttribute('aria-label', 'Discard expanded issue');

  const form = document.createElement('form');
  form.id = OVERLAY_FORM_ID;
  form.className = 'issues-new-form issues-expand-form';
  form.setAttribute('aria-label', 'Expand issue');
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-modal', 'true');

  const heading = document.createElement('h2');
  heading.className = 'issues-expand-form__heading';
  heading.id = 'issuesExpandHeading';
  heading.textContent = 'Expand issue';
  form.setAttribute('aria-labelledby', heading.id);

  const hint = document.createElement('p');
  hint.className = 'issues-expand-form__hint';
  hint.textContent =
    'Review the expanded title and description. Nothing is saved until you apply.';

  const titleLabel = document.createElement('label');
  titleLabel.className = 'issues-expand-form__title';
  titleLabel.append('Title');
  const title = document.createElement('input');
  title.type = 'text';
  title.id = 'issuesExpandTitle';
  title.autocomplete = 'off';
  title.setAttribute('aria-label', 'Expanded title');
  titleLabel.appendChild(title);

  const descLabel = document.createElement('label');
  descLabel.className = 'issues-expand-form__desc';
  descLabel.append('Description');
  const description = document.createElement('textarea');
  description.id = 'issuesExpandDescription';
  description.rows = 10;
  description.setAttribute('aria-label', 'Expanded description');
  descLabel.appendChild(description);

  const status = document.createElement('p');
  status.id = 'issuesExpandStatus';
  status.className = 'issues-expand-form__status';

  const actions = document.createElement('div');
  actions.className = 'issues-new-form__actions';
  const discard = document.createElement('button');
  discard.type = 'button';
  discard.id = 'issuesExpandDiscard';
  discard.className = 'issues-btn';
  discard.textContent = 'Discard';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.id = 'issuesExpandApply';
  apply.className = 'issues-btn issues-btn--primary';
  apply.textContent = 'Apply';
  actions.append(discard, apply);

  form.append(heading, hint, titleLabel, descLabel, status, actions);
  document.body.append(backdrop, form);

  title.addEventListener('input', () => syncApplyEnabled());
  description.addEventListener('input', () => syncApplyEnabled());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    applyExpand();
  });
  apply.addEventListener('click', () => applyExpand());
  discard.addEventListener('click', () => discardExpand());
  backdrop.addEventListener('click', () => discardExpand());
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      discardExpand();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      applyExpand();
    }
  });

  return overlayEls()!;
}

function setOverlayOpen(open: boolean): void {
  const els = ensureOverlay();
  els.form.classList.toggle('is-open', open);
  els.backdrop.classList.toggle('is-open', open);
}

function setFieldsReadonly(readonly: boolean): void {
  const els = overlayEls();
  if (!els) return;
  els.title.readOnly = readonly;
  els.description.readOnly = readonly;
  els.form.classList.toggle('is-expanding', readonly);
}

function setStatusLine(text: string): void {
  const els = overlayEls();
  if (!els) return;
  els.status.textContent = text;
  els.status.hidden = !text;
}

function paintDraft(draft: { title: string; description: string }): void {
  const els = overlayEls();
  if (!els) return;
  els.title.value = draft.title;
  els.description.value = draft.description;
  syncApplyEnabled();
}

function syncApplyEnabled(): void {
  const els = overlayEls();
  if (!els) return;
  const streaming = Boolean(activeRun) && els.title.readOnly;
  els.apply.disabled = streaming || !els.title.value.trim();
}

function closeOverlay(): void {
  const els = overlayEls();
  if (!els) return;
  setOverlayOpen(false);
  els.title.value = '';
  els.description.value = '';
  setFieldsReadonly(false);
  setStatusLine('');
  els.apply.disabled = true;
}

/** Close without saving (tests + Discard). Aborts an in-flight generation. */
export function closeIssueExpandOverlay(): void {
  discardExpand();
}

// ── Apply ────────────────────────────────────────────────────────────────────

function discardExpand(): void {
  const run = activeRun;
  if (run) {
    run.controller.abort();
    clearActiveRun();
    syncExpandButtons();
    setStatus('ok', 'Expand cancelled');
  }
  closeOverlay();
}

function applyExpand(): void {
  const els = overlayEls();
  const run = activeRun;
  if (!els || !run) return;
  if (els.title.readOnly) return;

  const title = els.title.value.trim();
  if (!title) return;

  const description = els.description.value;
  const issueId = run.issueId;
  clearActiveRun();
  updateIssue(issueId, { title, description });
  closeOverlay();
  syncExpandButtons();
  // The store emit above landed while the overlay still owned the editing
  // guard, so the open detail never re-rendered; refresh it now that the
  // overlay is closed. Dynamic import: a static one would cycle through
  // issues-detail → issues-expand-controls → this module.
  void import('./issues-detail').then((m) => m.refreshIssueDetailIfOpen());
  setStatus('ok', 'Issue expanded');
  showToast('Issue expanded', 'success');
}

/** Open the review overlay and stream a proposal. */
export async function startIssueExpandFromUi(issueId: string): Promise<void> {
  const issue = findIssueById(issueId);
  if (!issue) {
    showToast('Issue not found', 'error');
    return;
  }
  if (!canExpandIssueDraft(issue)) {
    showToast('Nothing to expand', 'error');
    return;
  }

  if (activeRun && activeRun.issueId !== issueId) {
    activeRun.controller.abort();
    clearActiveRun();
  }

  const original = { title: issue.title, description: issue.description ?? '' };
  const controller = new AbortController();
  activeRun = { issueId, controller, original };
  setIssueExpandRun(issueId);

  const els = ensureOverlay();
  setOverlayOpen(true);
  paintDraft(original);
  setFieldsReadonly(true);
  setStatusLine('Expanding…');
  els.apply.disabled = true;
  els.title.focus();
  syncExpandButtons();
  setStatus('spin', 'Expanding issue…');

  try {
    const fetchExpanded = await resolveExpandFetcher();
    const result = await fetchExpanded({
      issue,
      signal: controller.signal,
      onPartial: (draft: ExpandedIssueDraft) => {
        if (controller.signal.aborted) return;
        paintDraft(mergeExpandedIssue(original, draft));
      },
    } satisfies ExpandIssueRequest);

    if (controller.signal.aborted) {
      setStatus('ok', 'Expand cancelled');
      return;
    }
    if (activeRun?.issueId !== issueId) return;

    if (result.error) {
      clearActiveRun();
      closeOverlay();
      syncExpandButtons();
      setStatus('err', result.error);
      showToast(result.error, 'error');
      return;
    }
    if (!result.draft) {
      clearActiveRun();
      closeOverlay();
      syncExpandButtons();
      setStatus('ok', 'Ready');
      showToast(EXPAND_EMPTY_MESSAGE, 'error');
      return;
    }

    paintDraft(mergeExpandedIssue(original, result.draft));
    setFieldsReadonly(false);
    setStatusLine('Edit if you want, then apply.');
    syncApplyEnabled();
    setStatus('ok', 'Issue expanded — review to apply');
    els.title.focus();
    els.title.select();
  } catch (err) {
    if (activeRun?.issueId === issueId) clearActiveRun();
    closeOverlay();
    syncExpandButtons();
    const message = err instanceof Error && err.message.trim() ? err.message : EXPAND_FAILED_MESSAGE;
    setStatus('err', message);
    showToast(message, 'error');
  }
}
