import { isActiveChatStreaming } from '../chat/streaming-state.ts';
import {
  branchesLockedToOtherWorktrees,
  filterUserFacingBranches,
  filterUserFacingWorktrees,
  formatWorktreeOptionLabel,
  getPrincipalWorktree,
  parseWorktreeListPorcelain,
  worktreePathsEqual,
} from '../lib/worktree-list-parse.ts';
import {
  attachChatToWorktree,
  chatTitleForGitRef,
  composerGitRepoRoot,
  createManagedChatWorktree,
  formatComposerBranchLabel,
  formatComposerRunTargetLabel,
  isChatWorktreeMode,
  setChatRunTargetLocal,
} from '../state/chat-worktree.ts';
import { gitBranches, gitCheckout } from '../state/git-api.ts';
import { getActiveChat, isExpertChat, scheduleSaveSessions, touchChat } from '../state/sessions.ts';
import { isLocalServerAvailable } from '../tools/config.ts';
import { listWorktrees } from '../state/worktree-service.ts';
import type { Chat } from '../types.ts';
import { isComposerRecoveryBlocked } from './composer-send.ts';
import { createGitWorktreeIcon } from './git-worktree-icons.ts';
import {
  closeGitPanelNamePopover,
  openGitRefNamePopover,
} from './git-panel-name-popover.ts';
import {
  observeModeSelectorComposerSibling,
  refreshModeSelectorLayout,
} from './mode-selector.ts';
import { setStatus } from './status.ts';
import { showToast } from './toast.ts';

let wrapEl: HTMLDivElement | null = null;
let runTargetBtn: HTMLButtonElement | null = null;
let runTargetMenu: HTMLDivElement | null = null;
let branchBtn: HTMLButtonElement | null = null;
let branchMenu: HTMLDivElement | null = null;
let runTargetOpen = false;
let branchOpen = false;
let outsideHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
let busy = false;

// ── Menus ────────────────────────────────────────────────────────────────────

function controlsDisabled(): boolean {
  return isActiveChatStreaming() || isComposerRecoveryBlocked() || busy;
}

function shouldShowForChat(chat: Chat): boolean {
  if (isExpertChat(chat)) return false;
  if (chat.boardTaskId?.trim()) return false;
  return isLocalServerAvailable();
}

function detachGlobalListeners(): void {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler, true);
    outsideHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

function closeMenus(): void {
  runTargetOpen = false;
  branchOpen = false;
  runTargetBtn?.setAttribute('aria-expanded', 'false');
  branchBtn?.setAttribute('aria-expanded', 'false');
  runTargetMenu?.classList.add('hidden');
  branchMenu?.classList.add('hidden');
  detachGlobalListeners();
}

/** Close Local / branch menus (compact layout swap and overflow sheet). */
export function closeComposerRunTargetMenus(): void {
  closeMenus();
}

function positionMenu(anchor: HTMLElement, menu: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 4;
  const menuHeight = menu.offsetHeight || menu.getBoundingClientRect().height;
  const menuWidth = menu.offsetWidth || menu.getBoundingClientRect().width;

  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - menuHeight - gap);
  }

  let left = rect.left;
  if (left + menuWidth > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - menuWidth - margin);
  }

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function attachGlobalListeners(): void {
  outsideHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (
      runTargetMenu?.contains(target) ||
      branchMenu?.contains(target) ||
      runTargetBtn?.contains(target) ||
      branchBtn?.contains(target)
    ) {
      return;
    }
    closeMenus();
  };
  document.addEventListener('pointerdown', outsideHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    closeMenus();
    closeGitPanelNamePopover();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

// ── Controls ─────────────────────────────────────────────────────────────────

function createMenuButton(
  id: string,
  className: string,
  ariaLabel: string,
  iconKind: 'local' | 'branch' | 'worktree',
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = className;
  btn.setAttribute('aria-label', ariaLabel);
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  const icon = createGitWorktreeIcon(iconKind, 'composer-run-target__icon');
  const label = document.createElement('span');
  label.className = 'composer-run-target__label';
  btn.append(icon, label);
  return btn;
}

function createMenuPanel(id: string): HTMLDivElement {
  const menu = document.createElement('div');
  menu.id = id;
  menu.className = 'composer-run-target-menu hidden';
  menu.setAttribute('role', 'menu');
  return menu;
}

function menuSection(title: string): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'composer-run-target-menu__section';
  const heading = document.createElement('div');
  heading.className = 'composer-run-target-menu__heading';
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

function menuItem(
  label: string,
  onClick: () => void,
  options?: { icon?: 'local' | 'branch' | 'worktree'; disabled?: boolean; keepOpen?: boolean },
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'composer-run-target-menu__item';
  btn.setAttribute('role', 'menuitem');
  btn.disabled = options?.disabled === true;
  if (options?.icon) {
    btn.appendChild(createGitWorktreeIcon(options.icon, 'composer-run-target-menu__item-icon'));
  }
  const text = document.createElement('span');
  text.textContent = label;
  btn.appendChild(text);
  btn.addEventListener('click', () => {
    if (!options?.keepOpen) closeMenus();
    void onClick();
  });
  return btn;
}

function reopenRunTargetMenu(): void {
  if (!runTargetMenu || !runTargetBtn) return;
  runTargetOpen = true;
  runTargetBtn.setAttribute('aria-expanded', 'true');
  runTargetMenu.classList.remove('hidden');
  positionMenu(runTargetBtn, runTargetMenu);
  attachGlobalListeners();
}

function ensureControls(): HTMLDivElement {
  if (wrapEl) return wrapEl;

  wrapEl = document.createElement('div');
  wrapEl.id = 'composerRunTargetWrap';
  wrapEl.className = 'composer-control composer-run-target-wrap hidden';

  runTargetBtn = createMenuButton(
    'composerRunTargetBtn',
    'composer-run-target-btn',
    'Run target',
    'local',
  );
  runTargetMenu = createMenuPanel('composerRunTargetMenu');

  branchBtn = createMenuButton(
    'composerBranchBtn',
    'composer-run-target-btn composer-branch-btn',
    'Git branch',
    'branch',
  );
  branchMenu = createMenuPanel('composerBranchMenu');

  runTargetBtn.addEventListener('click', () => {
    if (controlsDisabled()) return;
    if (runTargetOpen) {
      closeMenus();
      return;
    }
    closeMenus();
    runTargetOpen = true;
    runTargetBtn?.setAttribute('aria-expanded', 'true');
    void rebuildRunTargetMenu().then(() => {
      if (!runTargetMenu || !runTargetBtn) return;
      runTargetMenu.classList.remove('hidden');
      positionMenu(runTargetBtn, runTargetMenu);
      attachGlobalListeners();
    });
  });

  branchBtn.addEventListener('click', () => {
    if (controlsDisabled()) return;
    if (branchOpen) {
      closeMenus();
      return;
    }
    closeMenus();
    branchOpen = true;
    branchBtn?.setAttribute('aria-expanded', 'true');
    void rebuildBranchMenu().then(() => {
      if (!branchMenu || !branchBtn) return;
      branchMenu.classList.remove('hidden');
      positionMenu(branchBtn, branchMenu);
      attachGlobalListeners();
    });
  });

  wrapEl.append(runTargetBtn, runTargetMenu, branchBtn, branchMenu);

  const host = document.getElementById('composerControls');
  const anchor = document.getElementById('composerThinkingWrap');
  if (host) {
    if (anchor?.parentNode === host) {
      host.insertBefore(wrapEl, anchor);
    } else {
      host.appendChild(wrapEl);
    }
    observeModeSelectorComposerSibling(wrapEl);
    document.dispatchEvent(new CustomEvent('minnow:composer-controls-changed'));
  }

  return wrapEl;
}

// ── Apply ────────────────────────────────────────────────────────────────────

async function refreshGitPanelFromComposer(): Promise<void> {
  try {
    const mod = await import('./git-panel.ts');
    mod.clearPanelCwdUserOverride();
    mod.syncPanelFromActiveChat({ forceFileTree: true });
  } catch {
  }
}

async function applyLocalTarget(): Promise<void> {
  const chat = getActiveChat();
  busy = true;
  refreshComposerRunTargetDisabled();
  try {
    await setChatRunTargetLocal(chat);
    touchChat(chat);
    scheduleSaveSessions();
    syncComposerRunTargetFromActiveChat();
    await refreshGitPanelFromComposer();
    setStatus('ok', 'Run target: Local');
  } finally {
    busy = false;
    refreshComposerRunTargetDisabled();
  }
}

async function applyNewWorktree(
  branchName: string,
  baseRef?: string,
  checkoutExisting?: boolean,
): Promise<void> {
  const chat = getActiveChat();
  busy = true;
  refreshComposerRunTargetDisabled();
  try {
    const res = await createManagedChatWorktree(chat, branchName, baseRef, checkoutExisting);
    if (!res.ok) {
      const msg = res.error ?? 'Could not create worktree';
      setStatus('error', msg);
      showToast(msg, 'error');
      return;
    }
    touchChat(chat);
    scheduleSaveSessions();
    syncComposerRunTargetFromActiveChat();
    await refreshGitPanelFromComposer();
    setStatus('ok', `Worktree: ${chat.gitBranch ?? branchName}`);
    showToast(`Worktree: ${chat.gitBranch ?? branchName}`, 'success');
  } finally {
    busy = false;
    refreshComposerRunTargetDisabled();
  }
}

async function applyAttachWorktree(path: string, branch?: string): Promise<void> {
  const chat = getActiveChat();
  const repoRoot = composerGitRepoRoot();
  if (repoRoot && worktreePathsEqual(path, repoRoot)) {
    await applyLocalTarget();
    return;
  }
  busy = true;
  refreshComposerRunTargetDisabled();
  try {
    if (chat.chatWorktreeManaged) {
      await setChatRunTargetLocal(chat);
    }
    attachChatToWorktree(chat, path, branch);
    touchChat(chat);
    scheduleSaveSessions();
    syncComposerRunTargetFromActiveChat();
    await refreshGitPanelFromComposer();
    setStatus('ok', `Worktree: ${branch?.trim() || path.split(/[/\\]/).pop() || 'attached'}`);
  } finally {
    busy = false;
    refreshComposerRunTargetDisabled();
  }
}

async function applyBranchCheckout(branch: string): Promise<void> {
  const chat = getActiveChat();
  if (isChatWorktreeMode(chat)) return;
  busy = true;
  refreshComposerRunTargetDisabled();
  try {
    const res = await gitCheckout({ branch });
    if (!res.ok) {
      setStatus('error', res.error ?? `Could not checkout ${branch}`);
      return;
    }
    chat.gitBranch = branch;
    touchChat(chat);
    scheduleSaveSessions();
    syncComposerRunTargetFromActiveChat();
    await refreshGitPanelFromComposer();
    setStatus('ok', `Branch: ${branch}`);
  } finally {
    busy = false;
    refreshComposerRunTargetDisabled();
  }
}

function promptNewWorktreeBranch(anchor: HTMLElement): void {
  const chat = getActiveChat();
  openGitRefNamePopover({
    anchor,
    title: 'New worktree',
    kind: 'worktree',
    cwd: composerGitRepoRoot(),
    defaultTitle: chatTitleForGitRef(chat),
    defaultPath: chat.workspacePath || composerGitRepoRoot(),
    reserved: [chat.gitBranch, 'main', 'master'],
    onSubmit: async (result) => {
      await applyNewWorktree(
        result.name,
        result.checkoutExisting ? undefined : result.startPoint,
        result.checkoutExisting,
      );
    },
  });
}

async function rebuildRunTargetMenu(): Promise<void> {
  if (!runTargetMenu) return;
  runTargetMenu.replaceChildren();

  const chat = getActiveChat();
  const repoRoot = composerGitRepoRoot();
  const list = await listWorktrees();
  const parsed =
    list.ok && list.output ? parseWorktreeListPorcelain(list.output) : [];
  const principal = getPrincipalWorktree(parsed);
  const inWorktree = isChatWorktreeMode(chat);

  const runOn = menuSection('Run on');
  const localItem = menuItem('This PC', () => applyLocalTarget(), {
    icon: 'local',
    disabled: !inWorktree,
  });
  runOn.appendChild(localItem);

  if (
    principal?.path &&
    repoRoot &&
    !worktreePathsEqual(principal.path, repoRoot)
  ) {
    const principalLabel = principal.branch?.trim()
      ? `${principal.branch} (main worktree)`
      : 'Main worktree';
    runOn.appendChild(
      menuItem(
        principalLabel,
        () => applyAttachWorktree(principal.path, principal.branch),
        { icon: 'worktree' },
      ),
    );
  }
  runTargetMenu.appendChild(runOn);

  const wtSection = menuSection('Worktree');
  const attachItem = menuItem('Worktree…', async () => {
    if (!list.ok || !list.output) {
      const msg = list.error ?? 'Could not list worktrees';
      setStatus('error', msg);
      showToast(msg, 'error');
      return;
    }
    const entries = filterUserFacingWorktrees(parsed, repoRoot).filter(
      (wt) => !worktreePathsEqual(wt.path, repoRoot),
    );
    if (!entries.length) {
      const msg = 'No extra worktrees found';
      setStatus('error', msg);
      showToast(msg, 'error');
      return;
    }
    if (!runTargetMenu) return;
    runTargetMenu.replaceChildren();
    const back = menuItem(
      '← Back',
      () => {
        void rebuildRunTargetMenu().then(() => reopenRunTargetMenu());
      },
      { keepOpen: true },
    );
    runTargetMenu.appendChild(back);
    for (const wt of entries) {
      const label = formatWorktreeOptionLabel(wt, repoRoot, {
        principalPath: principal?.path,
      });
      runTargetMenu.appendChild(
        menuItem(label, () => applyAttachWorktree(wt.path, wt.branch), {
          icon: 'worktree',
        }),
      );
    }
    reopenRunTargetMenu();
  }, { icon: 'worktree', keepOpen: true });

  const newItem = menuItem('New worktree', () => {
    if (runTargetBtn) promptNewWorktreeBranch(runTargetBtn);
  }, { icon: 'worktree' });

  wtSection.append(attachItem, newItem);
  runTargetMenu.appendChild(wtSection);
}

async function rebuildBranchMenu(): Promise<void> {
  if (!branchMenu) return;
  branchMenu.replaceChildren();
  const chat = getActiveChat();
  const inWorktree = isChatWorktreeMode(chat);

  if (inWorktree) {
    const note = document.createElement('p');
    note.className = 'composer-run-target-menu__note';
    note.textContent = chat.gitBranch?.trim()
      ? `Branch: ${chat.gitBranch}`
      : 'Branch follows the attached worktree.';
    branchMenu.appendChild(note);
    return;
  }

  const [res, list] = await Promise.all([gitBranches(), listWorktrees()]);
  if (!res.ok) {
    const err = document.createElement('p');
    err.className = 'composer-run-target-menu__note';
    err.textContent = res.error ?? 'Could not load branches';
    branchMenu.appendChild(err);
    return;
  }

  const repoRoot = composerGitRepoRoot();
  const worktrees =
    list.ok && list.output
      ? filterUserFacingWorktrees(parseWorktreeListPorcelain(list.output), repoRoot)
      : [];
  const locked = branchesLockedToOtherWorktrees(worktrees, repoRoot);
  const current = res.current?.trim();
  const names = filterUserFacingBranches(res.local ?? [], locked);
  for (const name of names) {
    const item = menuItem(name, () => applyBranchCheckout(name), {
      icon: 'branch',
      disabled: name === current,
    });
    if (name === current) {
      item.setAttribute('aria-current', 'true');
    }
    branchMenu.appendChild(item);
  }
}

function updateButtonLabels(chat: Chat): void {
  const runLabel = runTargetBtn?.querySelector('.composer-run-target__label');
  if (runLabel) {
    runLabel.textContent = formatComposerRunTargetLabel(chat);
  }
  const branchLabel = branchBtn?.querySelector('.composer-run-target__label');
  if (branchLabel) {
    branchLabel.textContent = formatComposerBranchLabel(chat.gitBranch);
  }
  runTargetBtn?.setAttribute(
    'title',
    isChatWorktreeMode(chat)
      ? `Worktree: ${chat.worktreeRoot ?? ''}`
      : 'Run on this PC (main workspace)',
  );
  branchBtn?.setAttribute(
    'title',
    chat.gitBranch?.trim() ? `Branch: ${chat.gitBranch}` : 'Select git branch',
  );
  refreshModeSelectorLayout();
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/** Disable controls while streaming or busy. */
export function refreshComposerRunTargetDisabled(): void {
  const disabled = controlsDisabled();
  runTargetBtn?.toggleAttribute('disabled', disabled);
  branchBtn?.toggleAttribute('disabled', disabled || isChatWorktreeMode(getActiveChat()));
}

/** Sync run-target + branch controls from the active chat. */
export function syncComposerRunTargetFromActiveChat(): void {
  const wrap = ensureControls();
  const chat = getActiveChat();

  if (!shouldShowForChat(chat)) {
    wrap.classList.add('hidden');
    closeMenus();
    return;
  }

  wrap.classList.remove('hidden');
  updateButtonLabels(chat);
  refreshComposerRunTargetDisabled();

  if (!chat.gitBranch?.trim()) {
    void gitBranches().then((res) => {
      if (!res.ok || !res.current?.trim()) return;
      if (getActiveChat().id !== chat.id) return;
      if (getActiveChat().gitBranch?.trim()) return;
      chat.gitBranch = res.current.trim();
      updateButtonLabels(chat);
    });
  }
}

/** Wire composer run-target controls (call once at boot). */
export function initComposerRunTarget(): void {
  ensureControls();
  syncComposerRunTargetFromActiveChat();
}
