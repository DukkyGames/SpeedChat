import {
  GIT_REF_FALLBACK_BRANCH,
  GIT_REF_FALLBACK_WORKTREE,
  slugifyGitRefName,
  suggestGitRefName,
} from '../lib/git-branch-slug.mjs';
import {
  displayRemoteRef,
  isCheckoutUnavailable,
  isSkippedRemoteRef,
  pickDefaultStartPoint,
} from '../lib/git-ref-start.mjs';
import { gitBranches } from '../state/git-api';

/** Branch lists for the start-from / check-out select. */
export interface GitRefBranchLists {
  current?: string;
  local?: string[];
  remote?: string[];
  lockedLocal?: string[];
}

export interface GitPanelNamePopoverOptions {
  anchor: HTMLElement;
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  /** When set, typed text is auto-fixed through this function before submit (MIN-659). */
  normalizeName?: (raw: string) => string;
  onSubmit: (name: string) => void | Promise<void>;
}

/** Payload from New branch / Add worktree after slugify + start-from. */
export interface GitRefCreateResult {
  name: string;
  startPoint: string;
  checkoutExisting: boolean;
}

export interface GitRefNamePopoverOptions {
  anchor: HTMLElement;
  title: string;
  /** Branch vs worktree only changes fallback + placeholder copy. */
  kind: 'branch' | 'worktree';
  /** Chat / plan title used for the default slug. */
  defaultTitle?: string;
  /** Workspace or worktree path used when the title is empty. */
  defaultPath?: string;
  /** Names already taken (current branch, trunk) so the default is unique. */
  reserved?: Iterable<string | undefined | null>;
  /** Repo cwd for `gitBranches`; omitted when `branchLists` is supplied. */
  cwd?: string;
  /** Git-graph Create Branch pins the clicked commit; hides the start-from select. */
  fixedStartPoint?: string;
  /** Test/override lists so the extra row does not need a network round-trip. */
  branchLists?: GitRefBranchLists;
  onSubmit: (result: GitRefCreateResult) => void | Promise<void>;
}

let popoverEl: HTMLDivElement | null = null;
let anchorEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let open = false;
let loadGeneration = 0;
let outsidePointerHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

// ── Close ────────────────────────────────────────────────────────────────────

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

/** Close the git panel name popover if open. */
export function closeGitPanelNamePopover(): void {
  if (!open) return;
  open = false;
  loadGeneration += 1;
  detachGlobalListeners();
  anchorEl?.setAttribute('aria-expanded', 'false');
  anchorEl = null;
  inputEl = null;
  popoverEl?.remove();
  popoverEl = null;
}

/** Whether the name popover is visible. */
export function isGitPanelNamePopoverOpen(): boolean {
  return open;
}

// ── Position ─────────────────────────────────────────────────────────────────

function positionPopover(anchor: HTMLElement, popover: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const popoverWidth = popover.offsetWidth || 240;
  const popoverHeight = popover.offsetHeight || 120;

  let top = rect.bottom + 4;
  if (top + popoverHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popoverHeight - 4);
  }

  let left = rect.right - popoverWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - popoverWidth - margin));

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function attachGlobalListeners(): void {
  outsidePointerHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!popoverEl || !anchorEl) return;
    if (popoverEl.contains(target) || anchorEl.contains(target)) return;
    closeGitPanelNamePopover();
  };
  document.addEventListener('pointerdown', outsidePointerHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeGitPanelNamePopover();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

function ensurePopover(): HTMLDivElement {
  if (popoverEl) return popoverEl;

  popoverEl = document.createElement('div');
  popoverEl.className = 'git-panel-name-popover';
  popoverEl.setAttribute('role', 'dialog');
  popoverEl.setAttribute('aria-modal', 'false');
  document.body.appendChild(popoverEl);
  return popoverEl;
}

/** Sync the live "will use" line so the user sees the git name that will be created. */
function updateNormalizedPreview(
  input: HTMLInputElement,
  preview: HTMLElement,
  normalizeName: (raw: string) => string,
  anchor: HTMLElement,
  popover: HTMLElement,
): string {
  const slug = normalizeName(input.value);
  const typed = input.value.trim();
  if (slug && slug !== typed) {
    preview.hidden = false;
    preview.textContent = `Will use ${slug}`;
  } else {
    preview.hidden = true;
    preview.textContent = '';
  }
  positionPopover(anchor, popover);
  return slug;
}

function createLabel(text: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'git-panel-name-popover__label';
  label.textContent = text;
  return label;
}

/** Append a select option, optionally disabled when the ref is already checked out. */
function appendOption(
  parent: HTMLElement,
  value: string,
  label: string,
  disabled: boolean,
  title?: string,
): void {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.disabled = disabled;
  if (title) option.title = title;
  parent.appendChild(option);
}

/** Fill Local / Remote optgroups; disable refs already checked out when attaching. */
function fillStartFromSelect(
  select: HTMLSelectElement,
  lists: GitRefBranchLists,
  forCheckout: boolean,
): void {
  select.replaceChildren();

  const localGroup = document.createElement('optgroup');
  localGroup.label = 'Local';
  const locals = [...(lists.local ?? [])];
  for (const name of lists.lockedLocal ?? []) {
    const trimmed = String(name ?? '').trim();
    if (trimmed && !locals.includes(trimmed)) locals.push(trimmed);
  }
  for (const name of locals) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) continue;
    const blocked = forCheckout && isCheckoutUnavailable(trimmed, lists);
    appendOption(
      localGroup,
      trimmed,
      trimmed,
      blocked,
      blocked ? 'Already checked out in a worktree' : undefined,
    );
  }

  const remoteGroup = document.createElement('optgroup');
  remoteGroup.label = 'Remote';
  for (const entry of lists.remote ?? []) {
    if (isSkippedRemoteRef(entry)) continue;
    const display = displayRemoteRef(entry);
    if (!display) continue;
    const blocked = forCheckout && isCheckoutUnavailable(display, lists);
    appendOption(
      remoteGroup,
      display,
      display,
      blocked,
      blocked ? 'Already checked out in a worktree' : undefined,
    );
  }

  if (localGroup.childElementCount) select.appendChild(localGroup);
  if (remoteGroup.childElementCount) select.appendChild(remoteGroup);

  if (!select.options.length) {
    appendOption(select, forCheckout ? '' : 'HEAD', forCheckout ? 'No available branches' : 'HEAD', forCheckout);
  }

  const preferred = pickDefaultStartPoint(lists, { forCheckout });
  if (preferred && [...select.options].some((opt) => opt.value === preferred && !opt.disabled)) {
    select.value = preferred;
  } else {
    const firstEnabled = [...select.options].find((opt) => !opt.disabled && opt.value);
    if (firstEnabled) select.value = firstEnabled.value;
  }
}

function listsFromGitResult(result: {
  current?: string;
  local?: string[];
  remote?: string[];
  lockedLocal?: string[];
}): GitRefBranchLists {
  return {
    current: result.current ?? '',
    local: result.local ?? [],
    remote: result.remote ?? [],
    lockedLocal: result.lockedLocal ?? [],
  };
}

// ── Open ─────────────────────────────────────────────────────────────────────

/** Open a small anchored popover to collect a branch or worktree name. */
export function openGitPanelNamePopover(options: GitPanelNamePopoverOptions): void {
  if (open && anchorEl === options.anchor) {
    closeGitPanelNamePopover();
    return;
  }

  closeGitPanelNamePopover();

  const popover = ensurePopover();
  popover.replaceChildren();

  const title = document.createElement('div');
  title.className = 'git-panel-name-popover__title';
  title.textContent = options.title;
  title.id = 'gitPanelNamePopoverTitle';
  popover.setAttribute('aria-labelledby', title.id);

  const label = createLabel(options.label);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'git-panel-name-popover__input';
  input.placeholder = options.placeholder ?? '';
  input.value = options.defaultValue ?? '';
  input.maxLength = 255;
  input.setAttribute('aria-label', options.label);
  label.appendChild(input);

  popover.append(title, label);

  let preview: HTMLParagraphElement | null = null;
  if (options.normalizeName) {
    preview = document.createElement('p');
    preview.className = 'git-panel-name-popover__preview';
    preview.setAttribute('aria-live', 'polite');
    preview.hidden = true;
    popover.appendChild(preview);
  }

  const actions = document.createElement('div');
  actions.className = 'git-panel-name-popover__actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'git-panel-action-btn';
  cancelBtn.textContent = 'Cancel';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'git-panel-action-btn git-panel-action-btn--primary';
  submitBtn.textContent = options.submitLabel ?? 'Create';

  actions.append(cancelBtn, submitBtn);
  popover.append(actions);

  inputEl = input;
  anchorEl = options.anchor;
  open = true;
  anchorEl.setAttribute('aria-expanded', 'true');

  const refreshPreview = (): string | null => {
    if (!preview || !options.normalizeName || !anchorEl) return null;
    return updateNormalizedPreview(input, preview, options.normalizeName, anchorEl, popover);
  };

  const submit = async (): Promise<void> => {
    const raw = input.value;
    const name = options.normalizeName ? options.normalizeName(raw) : raw.trim();
    if (!name) {
      input.focus();
      return;
    }
    closeGitPanelNamePopover();
    await options.onSubmit(name);
  };

  cancelBtn.addEventListener('click', () => closeGitPanelNamePopover());
  submitBtn.addEventListener('click', () => void submit());
  input.addEventListener('input', () => {
    refreshPreview();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });

  positionPopover(options.anchor, popover);
  attachGlobalListeners();
  refreshPreview();

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

/** Create-branch / create-worktree popover with auto-fixed git names (MIN-659). */
export function openGitRefNamePopover(options: GitRefNamePopoverOptions): void {
  if (open && anchorEl === options.anchor) {
    closeGitPanelNamePopover();
    return;
  }

  closeGitPanelNamePopover();

  const fallback =
    options.kind === 'worktree' ? GIT_REF_FALLBACK_WORKTREE : GIT_REF_FALLBACK_BRANCH;
  const defaultValue = suggestGitRefName({
    title: options.defaultTitle,
    path: options.defaultPath,
    fallback,
    reserved: options.reserved,
  });
  const normalizeName = (raw: string) => slugifyGitRefName(raw, fallback);
  const fixedStart = options.fixedStartPoint?.trim() ?? '';
  const showStartFrom = !fixedStart;

  const popover = ensurePopover();
  popover.replaceChildren();

  const title = document.createElement('div');
  title.className = 'git-panel-name-popover__title';
  title.textContent = options.title;
  title.id = 'gitPanelNamePopoverTitle';
  popover.setAttribute('aria-labelledby', title.id);

  const nameLabel = createLabel('Branch name');
  nameLabel.classList.add('git-panel-name-popover__name');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'git-panel-name-popover__input';
  input.placeholder =
    options.kind === 'worktree' ? 'feature/isolated-work' : 'feature/my-branch';
  input.value = defaultValue;
  input.maxLength = 255;
  input.setAttribute('aria-label', 'Branch name');
  nameLabel.appendChild(input);

  popover.append(title, nameLabel);

  const preview = document.createElement('p');
  preview.className = 'git-panel-name-popover__preview';
  preview.setAttribute('aria-live', 'polite');
  preview.hidden = true;
  popover.appendChild(preview);

  // Div, not <label>: mode buttons inside a label would also activate New from.
  const startField = document.createElement('div');
  startField.className = 'git-panel-name-popover__label';
  const startCaption = document.createElement('span');
  startCaption.textContent = 'Start from';
  const startRow = document.createElement('div');
  startRow.className = 'git-panel-name-popover__start-row';

  const newFromBtn = document.createElement('button');
  const checkoutBtn = document.createElement('button');
  let checkoutExisting = false;

  if (options.kind === 'worktree') {
    const modes = document.createElement('div');
    modes.className = 'git-panel-name-popover__modes';
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Worktree branch mode');

    newFromBtn.type = 'button';
    newFromBtn.className = 'git-panel-name-popover__mode';
    newFromBtn.textContent = 'New from';
    newFromBtn.setAttribute('aria-pressed', 'true');

    checkoutBtn.type = 'button';
    checkoutBtn.className = 'git-panel-name-popover__mode';
    checkoutBtn.textContent = 'Check out';
    checkoutBtn.setAttribute('aria-pressed', 'false');

    modes.append(newFromBtn, checkoutBtn);
    startRow.appendChild(modes);
  }

  const select = document.createElement('select');
  select.className = 'git-panel-name-popover__select';
  select.setAttribute('aria-label', 'Start from');
  appendOption(select, '', 'Loading…', true);
  startRow.appendChild(select);
  startField.append(startCaption, startRow);

  if (showStartFrom) {
    popover.appendChild(startField);
  }

  const actions = document.createElement('div');
  actions.className = 'git-panel-name-popover__actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'git-panel-action-btn';
  cancelBtn.textContent = 'Cancel';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'git-panel-action-btn git-panel-action-btn--primary';
  submitBtn.textContent = 'Create';

  actions.append(cancelBtn, submitBtn);
  popover.append(actions);

  inputEl = input;
  anchorEl = options.anchor;
  open = true;
  loadGeneration += 1;
  const generation = loadGeneration;
  anchorEl.setAttribute('aria-expanded', 'true');

  let lists: GitRefBranchLists = options.branchLists ?? {
    current: '',
    local: [],
    remote: [],
    lockedLocal: [],
  };

  const refreshPreview = (): string | null => {
    if (!anchorEl) return null;
    return updateNormalizedPreview(input, preview, normalizeName, anchorEl, popover);
  };

  const applyCheckoutMode = (next: boolean): void => {
    checkoutExisting = next;
    if (options.kind !== 'worktree') return;
    newFromBtn.setAttribute('aria-pressed', next ? 'false' : 'true');
    checkoutBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
    // Check out attaches an existing ref, so the new-name field is unused.
    nameLabel.hidden = next;
    if (next) nameLabel.setAttribute('hidden', '');
    else nameLabel.removeAttribute('hidden');
    if (next) {
      preview.hidden = true;
    } else {
      refreshPreview();
    }
    startCaption.textContent = next ? 'Check out' : 'Start from';
    select.setAttribute('aria-label', next ? 'Check out' : 'Start from');
    fillStartFromSelect(select, lists, next);
    submitBtn.disabled = next && !select.value;
    if (anchorEl) positionPopover(anchorEl, popover);
    if (next) select.focus();
  };

  const submit = async (): Promise<void> => {
    const startPoint = fixedStart || select.value.trim() || 'HEAD';
    if (checkoutExisting) {
      const name = select.value.trim();
      if (!name) {
        select.focus();
        return;
      }
      closeGitPanelNamePopover();
      await options.onSubmit({ name, startPoint: name, checkoutExisting: true });
      return;
    }
    const name = normalizeName(input.value);
    if (!name) {
      input.focus();
      return;
    }
    closeGitPanelNamePopover();
    await options.onSubmit({ name, startPoint, checkoutExisting: false });
  };

  cancelBtn.addEventListener('click', () => closeGitPanelNamePopover());
  submitBtn.addEventListener('click', () => void submit());
  input.addEventListener('input', () => {
    refreshPreview();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });
  select.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });

  if (options.kind === 'worktree') {
    newFromBtn.addEventListener('click', () => applyCheckoutMode(false));
    checkoutBtn.addEventListener('click', () => applyCheckoutMode(true));
  }

  positionPopover(options.anchor, popover);
  attachGlobalListeners();
  refreshPreview();

  const applyLists = (next: GitRefBranchLists): void => {
    if (generation !== loadGeneration || !open) return;
    lists = next;
    fillStartFromSelect(select, lists, checkoutExisting);
    submitBtn.disabled = checkoutExisting && !select.value;
    if (anchorEl) positionPopover(anchorEl, popover);
  };

  if (showStartFrom) {
    if (options.branchLists) {
      applyLists(options.branchLists);
    } else {
      void gitBranches(options.cwd).then((result) => {
        if (!result.ok) {
          applyLists({ current: '', local: [], remote: [], lockedLocal: [] });
          return;
        }
        applyLists(listsFromGitResult(result));
      });
    }
  }

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}
