import type { BoardState, TaskState } from '../../server/orchestrator/core/types';
import { setAssistantBubbleContent } from '../markdown/renderer.ts';
import { gitCommit, gitPush } from '../state/git-api.ts';
import {
  cleanupBoardWorktrees,
  mergeIntegrationIntoWorkspace,
  openWorkspacePr,
  workspaceLandingStats,
} from '../state/worktree-service.ts';
import { attachBoardFollowUpChip } from '../attachments/board-ref.ts';
import { refreshFileTreeViaBridge } from '../ui/file-tree-refresh-bridge.ts';
import { createChatWithMode } from '../ui/sidebar.ts';
import { countPhase, renderRunLedger } from './board-render';
import { el } from './dom';
import { renderReportEvidence, reportBadge, reportDisclosure } from './report-evidence';

/** Cap the report excerpt so the chip stays within typical text-attachment size. */
const FOLLOW_UP_REPORT_MAX_CHARS = 4000;

// ── Predicates ───────────────────────────────────────────────────────────────

/** Same formula as server/orchestrator/worktree-lifecycle.js — keep them aligned. */
export function integrationBranchName(boardId: string): string {
  return `minnow/board/${boardId}/integration`;
}

export function wantsReportScreen(state: BoardState): boolean {
  return state.finished || (state.status === 'stopped' && state.stopReason === 'user');
}

export function canReopenFailed(state: BoardState): boolean {
  for (const task of state.tasks.values()) {
    if (task.phase === 'abandoned' || task.phase === 'skipped') return true;
  }
  return state.finalTest?.outcome === 'fail';
}

export function canFixFinal(state: BoardState): boolean {
  return state.finalTest?.outcome === 'fail';
}

export interface BoardReportActions {
  dismiss: () => void;
  reopen: () => void;
  fixFinal: () => void;
}

interface GitLanding {
  loading: boolean;
  filesTouched: number | null;
  additions: number | null;
  deletions: number | null;
  hasRemote: boolean;
  hasGh: boolean;
  alreadyLanded: boolean;
  error?: string;
}

type CommitAction = 'commit-only' | 'commit-push' | 'commit-push-pr';

const gitByBoard = new Map<string, GitLanding>();
const landedByBoard = new Set<string>();
const clearedByBoard = new Set<string>();

export function clearBoardReportStateForTests(): void {
  gitByBoard.clear();
  landedByBoard.clear();
  clearedByBoard.clear();
}

// ── Report ───────────────────────────────────────────────────────────────────

export function renderBoardReport(
  state: BoardState,
  markdown: string | null,
  loading: boolean,
  actions: BoardReportActions,
): HTMLElement {
  const wrap = el('section', 'ov2-report-screen');
  wrap.setAttribute('aria-label', 'Run report');

  wrap.appendChild(renderCopy(state));
  wrap.appendChild(renderStats(state));

  const issues = collectIssues(state);
  if (issues.length > 0 || state.finalTest?.outcome === 'fail') {
    wrap.appendChild(renderIssues(state, issues));
  }

  wrap.appendChild(renderTaskResults(state));
  const verification = el('section', 'ov2-report-screen__section');
  verification.appendChild(el('h4', 'ov2-report-screen__section-title', 'Integration check'));
  verification.appendChild(reportBadge(state.finalTest?.outcome || 'not recorded'));
  if (state.finalTest?.evidence) verification.appendChild(renderReportEvidence(state.finalTest.evidence));
  if (state.finalTest?.runInstructions) {
    verification.appendChild(el('pre', 'ov2-report-evidence__log', state.finalTest.runInstructions));
  }
  wrap.appendChild(verification);
  wrap.appendChild(renderMarkdown(markdown, loading));

  const ledger = renderRunLedger(state, { rerun: () => actions.reopen() });
  if (ledger) {
    ledger.classList.add('ov2-report-screen__ledger');
    wrap.appendChild(ledger);
  }

  wrap.appendChild(renderFooter(state, markdown, actions));
  void hydrateGitStats(wrap, state);
  return wrap;
}

// ── Copy ─────────────────────────────────────────────────────────────────────

function renderCopy(state: BoardState): HTMLElement {
  const block = el('div', 'ov2-report-screen__copy');
  block.appendChild(el('p', 'ov2-report-screen__eyebrow', state.name || state.boardId));
  const title = el('h3', 'ov2-report-screen__title');
  title.textContent = titleFor(state);
  const subtitle = el('p', 'ov2-report-screen__lede');
  subtitle.textContent = ledeFor(state);
  block.appendChild(title);
  block.appendChild(subtitle);
  if (state.runSummary) block.appendChild(el('p', 'ov2-report-screen__summary', state.runSummary));
  return block;
}

function titleFor(state: BoardState): string {
  if (state.finalTest?.outcome === 'fail') return 'Board blocked';
  if (state.finished || state.stopReason === 'complete') return 'Board complete';
  return 'Board stopped';
}

function ledeFor(state: BoardState): string {
  if (state.finalTest?.outcome === 'fail') {
    return 'Tasks merged, but the final integration test failed. Fix the failure, or rerun abandoned work.';
  }
  if (state.finished || state.stopReason === 'complete') {
    return 'Review the summary, merge into your branch, or start a follow-up chat.';
  }
  return 'The board was stopped before it finished. The report is what the journal recorded up to that point.';
}

function renderStats(state: BoardState): HTMLElement {
  const row = el('div', 'ov2-report-screen__stats');
  row.setAttribute('aria-label', 'Run stats');
  const attempts = totalAttempts(state);
  const git = gitByBoard.get(state.boardId);
  const cells: Array<{ value: string; label: string }> = [
    { value: String(countPhase(state, 'merged')), label: 'merged' },
    { value: String(countPhase(state, 'abandoned')), label: 'abandoned' },
    { value: String(countPhase(state, 'skipped')), label: 'skipped' },
    { value: String(attempts), label: attempts === 1 ? 'attempt' : 'attempts' },
  ];
  if (git?.loading) {
    cells.push({ value: '…', label: 'files' });
  } else if (git && git.filesTouched != null) {
    cells.push({ value: String(git.filesTouched), label: 'files' });
    if (git.additions != null && git.deletions != null) {
      cells.push({ value: `+${git.additions} / −${git.deletions}`, label: 'lines' });
    }
  }
  cells.forEach((cell, index) => {
    if (index > 0) {
      const sep = el('span', 'ov2-report-screen__stat-sep', '·');
      sep.setAttribute('aria-hidden', 'true');
      row.appendChild(sep);
    }
    const node = el('span', 'ov2-report-screen__stat');
    node.appendChild(el('span', 'ov2-report-screen__stat-value', cell.value));
    node.appendChild(el('span', 'ov2-report-screen__stat-label', cell.label));
    row.appendChild(node);
  });
  return row;
}

// ── Issues ───────────────────────────────────────────────────────────────────

function collectIssues(state: BoardState): Array<{ task: TaskState; reason: string }> {
  const issues: Array<{ task: TaskState; reason: string }> = [];
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    if (task.phase === 'abandoned') {
      issues.push({
        task,
        reason:
          task.abandonedReason === 'user'
            ? 'Stopped by you'
            : task.abandonedReason || 'Abandoned',
      });
      continue;
    }
    if (task.phase === 'skipped') {
      issues.push({
        task,
        reason: task.skippedBy ? `Stranded by ${task.skippedBy}` : 'Skipped',
      });
    }
  }
  return issues;
}

function renderIssues(
  state: BoardState,
  issues: Array<{ task: TaskState; reason: string }>,
): HTMLElement {
  const section = el('section', 'ov2-report-screen__section');
  section.appendChild(el('h4', 'ov2-report-screen__section-title', 'Needs attention'));
  if (state.finalTest?.outcome === 'fail') {
    const summary = el('p', 'ov2-report-screen__final-fail');
    const evidence = state.finalTest.evidence;
    const text =
      (evidence &&
        typeof evidence === 'object' &&
        typeof (evidence as { summary?: unknown }).summary === 'string' &&
        String((evidence as { summary: string }).summary).trim()) ||
      state.runSummary ||
      'The final integration test failed.';
    summary.textContent = text;
    section.appendChild(summary);
    if (state.finalTest.runInstructions) {
      const run = el('p', 'ov2-report-screen__run');
      run.appendChild(el('span', 'ov2-report-screen__run-label', 'Run it yourself: '));
      run.appendChild(el('code', 'ov2-report-screen__run-cmd', state.finalTest.runInstructions));
      section.appendChild(run);
    }
  }
  if (issues.length === 0) {
    section.appendChild(el('p', 'ov2-report-screen__quiet', 'No abandoned or skipped tasks.'));
    return section;
  }
  const list = el('ul', 'ov2-report-screen__issues');
  for (const { task, reason } of issues) {
    const li = el('li', 'ov2-report-screen__issue');
    li.appendChild(el('span', 'ov2-report-screen__issue-id', task.id));
    li.appendChild(el('span', 'ov2-report-screen__issue-text', `${task.title}: ${reason}`));
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

function renderTaskResults(state: BoardState): HTMLElement {
  const section = el('section', 'ov2-report-screen__section');
  section.appendChild(el('h4', 'ov2-report-screen__section-title', 'Task results'));
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    const details = reportDisclosure('', () => {
      const body = el('div', 'ov2-report-task__body');
      if (task.abandonedReason) body.appendChild(el('p', '', task.abandonedReason === 'user' ? 'Stopped by you. Review the attempts before restarting this task.' : task.abandonedReason));
      if (task.skippedBy) body.appendChild(el('p', '', `Waiting on ${task.skippedBy}. Resolve that task before retrying.`));
      if (task.mergedSha) body.appendChild(el('p', 'ov2-report-screen__quiet', `Merged commit ${task.mergedSha}`));
      if (task.mergeConflicts?.length) body.appendChild(renderReportEvidence({ mergeConflicts: task.mergeConflicts }));
      task.attempts.forEach((attempt, index) => {
        const article = el('article', 'ov2-report-attempt');
        const role = attempt.role.charAt(0).toUpperCase() + attempt.role.slice(1);
        const heading = el('h5', 'ov2-report-attempt__heading', `${index + 1}. ${role}${attempt.retired ? ' · Previous run' : ''}`);
        heading.appendChild(reportBadge(attempt.outcome || (attempt.ended ? 'ended' : 'in progress')));
        article.appendChild(heading);
        if (attempt.summary) article.appendChild(el('p', '', attempt.summary));
        if (attempt.evidence) article.appendChild(renderReportEvidence(attempt.evidence));
        article.appendChild(reportDisclosure('Attempt details', () => renderReportEvidence({ attemptId: attempt.attemptId, worktree: attempt.worktree, seedKind: attempt.seedKind })));
        body.appendChild(article);
      });
      if (task.abandonedEvidence) body.appendChild(reportDisclosure('Evidence at abandonment', () => renderReportEvidence(task.abandonedEvidence)));
      if (task.touchesOverflow.length) body.appendChild(renderReportEvidence({ touchesOverflow: task.touchesOverflow }));
      if (!body.childElementCount) body.appendChild(el('p', 'ov2-report-screen__quiet', 'No attempt evidence recorded.'));
      return body;
    });
    details.classList.add('ov2-report-task');
    const summary = details.querySelector('summary')!;
    summary.appendChild(el('span', 'ov2-report-screen__issue-id', task.id));
    summary.appendChild(el('span', 'ov2-report-task__title', task.title));
    summary.appendChild(reportBadge(task.phase));
    summary.appendChild(el('span', 'ov2-report-task__count', `${task.attempts.length} ${task.attempts.length === 1 ? 'attempt' : 'attempts'}`));
    section.appendChild(details);
  }
  if (!state.taskOrder.length) section.appendChild(el('p', 'ov2-report-screen__quiet', 'No tasks recorded for this run.'));
  return section;
}

function renderMarkdown(markdown: string | null, loading: boolean): HTMLElement {
  const section = el('section', 'ov2-report-screen__section');
  section.appendChild(el('h4', 'ov2-report-screen__section-title', 'Run narrative'));
  if (loading && !markdown) {
    section.appendChild(el('p', 'ov2-report-screen__pending', 'Writing the end-of-run report…'));
    return section;
  }
  if (!markdown) {
    section.appendChild(el('p', 'ov2-report-screen__quiet', 'No report yet.'));
    return section;
  }
  const body = el('div', 'ov2-report-screen__markdown msg-bubble msg-bubble--md');
  // Saved reports may contain historical evidence absent from the current task fold.
  // Preserve surrounding prose and render JSON fences as structured evidence.
  const fence = /^```json\s*\r?\n([\s\S]*?)^```\s*$/gim;
  let cursor = 0;
  const prose = (text: string): void => {
    if (!text.trim()) return;
    const part = el('div', '');
    setAssistantBubbleContent(part, text, { modeId: 'orchestrate' });
    body.appendChild(part);
  };
  for (const match of markdown.matchAll(fence)) {
    prose(markdown.slice(cursor, match.index));
    try {
      body.appendChild(renderReportEvidence(JSON.parse(match[1])));
      body.appendChild(reportDisclosure('View raw evidence', () => el('pre', 'ov2-report-evidence__log', match[1])));
    } catch {
      body.appendChild(reportDisclosure('View recorded evidence', () => el('pre', 'ov2-report-evidence__log', match[1])));
    }
    cursor = match.index! + match[0].length;
  }
  prose(markdown.slice(cursor));
  section.appendChild(body);
  return section;
}

// ── Footer ───────────────────────────────────────────────────────────────────

function renderFooter(
  state: BoardState,
  markdown: string | null,
  actions: BoardReportActions,
): HTMLElement {
  const footer = el('div', 'ov2-report-screen__footer');
  const row = el('div', 'ov2-report-screen__actions');

  const back = btn('ov2-report-screen__btn board-btn board-btn--compact', 'Back to board');
  back.addEventListener('click', () => actions.dismiss());
  row.appendChild(back);

  if (canReopenFailed(state)) {
    const nAbandoned = [...state.tasks.values()].filter(
      (task) => task.phase === 'abandoned' || task.phase === 'skipped',
    ).length;
    const rerun = btn(
      'ov2-report-screen__btn board-btn board-btn--compact board-btn--primary',
      nAbandoned > 0
        ? `Rerun ${nAbandoned} failed task${nAbandoned === 1 ? '' : 's'}`
        : 'Add a fix task and re-verify',
    );
    rerun.title = 'Reopen failed work and start the board again';
    rerun.addEventListener('click', () => {
      rerun.disabled = true;
      actions.reopen();
    });
    row.appendChild(rerun);
  }

  const follow = btn('ov2-report-screen__btn board-btn board-btn--compact', 'Start follow-up chat');
  follow.addEventListener('click', () => {
    void startFollowUp(state, markdown);
  });
  row.appendChild(follow);

  row.appendChild(buildGitAction(state, markdown));
  footer.appendChild(row);

  const status = el('p', 'ov2-report-screen__git-status');
  status.hidden = true;
  status.setAttribute('role', 'status');
  footer.appendChild(status);
  return footer;
}

function btn(className: string, label: string): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  return node;
}

/**
 * Plain-text board snapshot for the follow-up chip (injected on send).
 * Includes every task and its phase; omits the old auto-send review prompt.
 */
export function buildBoardFollowUpContext(
  state: BoardState,
  markdown: string | null,
): string {
  const taskLines: string[] = [];
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    taskLines.push(`- ${task.id} [${task.phase}]: ${task.title}`);
  }
  const report =
    markdown && markdown.trim()
      ? 'End-of-run report:\n\n' + markdown.slice(0, FOLLOW_UP_REPORT_MAX_CHARS)
      : '';
  return [
    'Follow-up on a completed Orchestrate board.',
    '',
    `Board: ${state.name || state.boardId}`,
    `Board id: ${state.boardId}`,
    `Plan: ${state.planPath || '(none)'}`,
    `Integration branch: ${integrationBranchName(state.boardId)}`,
    state.runSummary ? `Summary: ${state.runSummary}` : '',
    '',
    'Tasks:',
    taskLines.join('\n') || '(none)',
    '',
    report,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Leave the V2 Boards overlay, open an empty General Code chat, and attach
 * board context as a file-style chip. Does not queue or send a user message.
 */
export async function startFollowUp(
  state: BoardState,
  markdown: string | null,
): Promise<void> {
  const title = (state.name || state.boardId).trim() || state.boardId;
  const text = buildBoardFollowUpContext(state, markdown);
  const { closeBoardsView } = await import('./boards-view.ts');
  await closeBoardsView({ restoreChat: false });
  createChatWithMode({ modeId: 'general' });
  attachBoardFollowUpChip({ name: title, text });
}

// ── Git ──────────────────────────────────────────────────────────────────────

function buildGitAction(state: BoardState, markdown: string | null): HTMLElement {
  if (clearedByBoard.has(state.boardId)) {
    const done = el('span', 'ov2-report-screen__git-done', 'Worktrees cleared');
    done.dataset.boardGitAction = 'cleared';
    return done;
  }
  if (landedByBoard.has(state.boardId)) {
    return buildClearWorktrees(state);
  }
  return buildCommitSplit(state, markdown);
}

function buildClearWorktrees(state: BoardState): HTMLElement {
  const clearBtn = btn(
    'ov2-report-screen__btn board-btn board-btn--primary',
    'Clear worktrees',
  );
  clearBtn.dataset.boardGitAction = 'clear';
  clearBtn.title = 'Remove all git worktrees created for this board';
  let busy = false;
  clearBtn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    clearBtn.disabled = true;
    const status = clearBtn.closest('.ov2-report-screen')?.querySelector('.ov2-report-screen__git-status');
    setGitStatus(status, 'Removing board worktrees…', 'info');
    void cleanupBoardWorktrees({ boardId: state.boardId, includeIntegration: true }).then((res) => {
      busy = false;
      if (!res.ok) {
        clearBtn.disabled = false;
        setGitStatus(status, res.error || 'Failed to clear worktrees', 'err');
        return;
      }
      clearedByBoard.add(state.boardId);
      clearBtn.replaceWith(el('span', 'ov2-report-screen__git-done', 'Worktrees cleared'));
      const removed = res.removed ?? 0;
      setGitStatus(
        status,
        removed > 0
          ? `Removed ${removed} worktree${removed === 1 ? '' : 's'}.`
          : 'Board worktrees cleared.',
        'ok',
      );
    });
  });
  return clearBtn;
}

function buildCommitSplit(state: BoardState, markdown: string | null): HTMLElement {
  const wrap = el('div', 'ov2-report-screen__commit');
  wrap.dataset.boardGitAction = 'commit';
  const git = gitByBoard.get(state.boardId);

  const primary = btn(
    'ov2-report-screen__btn board-btn board-btn--primary ov2-report-screen__commit-primary',
    'Commit',
  );
  const caret = btn('ov2-report-screen__commit-caret', '');
  caret.setAttribute('aria-label', 'More commit options');
  caret.setAttribute('aria-haspopup', 'menu');
  caret.setAttribute('aria-expanded', 'false');
  caret.textContent = '▾';

  let openMenu: HTMLElement | null = null;

  const closeMenu = (): void => {
    openMenu?.remove();
    openMenu = null;
    caret.setAttribute('aria-expanded', 'false');
  };

  const kick = (action: CommitAction): void => {
    closeMenu();
    primary.disabled = true;
    caret.disabled = true;
    void runCommitChain(state, markdown, action, wrap, () => {
      primary.disabled = false;
      caret.disabled = false;
    });
  };

  primary.addEventListener('click', () => kick('commit-push-pr'));

  caret.addEventListener('click', (event) => {
    event.stopPropagation();
    if (openMenu) {
      closeMenu();
      return;
    }
    const menu = el('div', 'ov2-report-screen__commit-menu');
    menu.setAttribute('role', 'menu');
    const items: Array<{ action: CommitAction; label: string; disabled?: boolean }> = [
      { action: 'commit-only', label: 'Commit only' },
      { action: 'commit-push', label: 'Commit and push', disabled: git?.hasRemote === false },
      {
        action: 'commit-push-pr',
        label: 'Commit, push, and open PR',
        disabled: git?.hasRemote === false || git?.hasGh === false,
      },
    ];
    for (const item of items) {
      const itemBtn = btn('ov2-report-screen__commit-menuitem', item.label);
      itemBtn.setAttribute('role', 'menuitem');
      itemBtn.disabled = item.disabled === true || git?.loading === true;
      itemBtn.addEventListener('click', () => kick(item.action));
      menu.appendChild(itemBtn);
    }
    wrap.appendChild(menu);
    openMenu = menu;
    caret.setAttribute('aria-expanded', 'true');
    const dismiss = (ev: MouseEvent): void => {
      if (wrap.contains(ev.target as Node)) return;
      closeMenu();
      document.removeEventListener('mousedown', dismiss);
    };
    document.addEventListener('mousedown', dismiss);
  });

  wrap.appendChild(primary);
  wrap.appendChild(caret);
  return wrap;
}

async function runCommitChain(
  state: BoardState,
  markdown: string | null,
  action: CommitAction,
  wrap: HTMLElement,
  done: () => void,
): Promise<void> {
  const status = wrap.closest('.ov2-report-screen')?.querySelector('.ov2-report-screen__git-status');
  const git = gitByBoard.get(state.boardId);
  const branch = integrationBranchName(state.boardId);
  const planName = state.planPath.split('/').pop()?.replace(/\.md$/i, '') || state.name || 'board';
  const commitMsg = `feat: ${planName} (orchestrate board ${state.boardId})`;

  const primary = wrap.querySelector<HTMLButtonElement>('.ov2-report-screen__commit-primary');
  const caret = wrap.querySelector<HTMLButtonElement>('.ov2-report-screen__commit-caret');
  if (primary) primary.disabled = true;
  if (caret) caret.disabled = true;

  try {
    setGitStatus(status, 'Merging integration branch into workspace…', 'info');
    const mergeRes = await mergeIntegrationIntoWorkspace({
      branch,
      message: `Merge ${branch}`,
    });
    if (!mergeRes.ok) {
      const detail = mergeRes.output || mergeRes.error || 'Merge failed';
      if (mergeRes.error === 'merge_conflict' || mergeRes.conflict) {
        setGitStatus(
          status,
          `Merge conflict — resolve in your workspace, then try again. ${detail}`,
          'err',
        );
      } else {
        setGitStatus(status, detail, 'err');
      }
      return;
    }
    const merged = mergeRes.merged === true;

    setGitStatus(status, 'Committing…', 'info');
    const commitRes = await gitCommit({ message: commitMsg });
    const commitClean =
      !commitRes.ok &&
      typeof commitRes.error === 'string' &&
      commitRes.error.includes('nothing to commit');
    if (!commitRes.ok && !commitClean) {
      setGitStatus(status, commitRes.error || 'Commit failed', 'err');
      return;
    }
    const hadNewCommit = commitRes.ok === true;

    if (action === 'commit-only') {
      setGitStatus(
        status,
        hadNewCommit
          ? 'Merged and committed to your current branch.'
          : merged
            ? 'Merged integration branch into your current branch.'
            : 'Integration branch already merged; workspace is clean.',
        hadNewCommit || merged ? 'ok' : 'info',
      );
      markLanded(state, wrap);
      return;
    }

    if (git?.hasRemote !== true) {
      setGitStatus(
        status,
        hadNewCommit || merged
          ? 'Committed locally. No origin remote — push skipped.'
          : 'No origin remote — push skipped.',
        'ok',
      );
      markLanded(state, wrap);
      return;
    }

    setGitStatus(status, 'Pushing current branch…', 'info');
    const pushRes = await gitPush({});
    if (!pushRes.ok) {
      setGitStatus(status, pushRes.error || pushRes.stdout || 'Push failed', 'err');
      markLanded(state, wrap);
      return;
    }

    if (action === 'commit-push') {
      setGitStatus(status, 'Merged and pushed your current branch.', 'ok');
      markLanded(state, wrap);
      return;
    }

    if (git?.hasGh !== true) {
      setGitStatus(status, 'Committed and pushed. GitHub CLI not available — PR skipped.', 'ok');
      markLanded(state, wrap);
      return;
    }

    setGitStatus(status, 'Opening pull request…', 'info');
    const prRes = await openWorkspacePr({
      title: commitMsg,
      body: markdown?.slice(0, 4000) || `Orchestrate board ${state.boardId}`,
    });
    if (!prRes.ok) {
      setGitStatus(
        status,
        `Committed and pushed. PR failed: ${prRes.output || prRes.error || 'unknown'}`,
        'err',
      );
    } else {
      const url = prRes.url ? ` ${prRes.url}` : '';
      setGitStatus(status, `Committed, pushed, and opened PR.${url}`, 'ok');
    }
    markLanded(state, wrap);
  } finally {
    done();
  }
}

function markLanded(state: BoardState, wrap: HTMLElement): void {
  landedByBoard.add(state.boardId);
  wrap.replaceWith(buildClearWorktrees(state));
  void refreshFileTreeViaBridge();
}

function setGitStatus(
  node: Element | null | undefined,
  text: string,
  kind: 'info' | 'ok' | 'err',
): void {
  if (!(node instanceof HTMLElement)) return;
  node.textContent = text;
  node.dataset.kind = kind;
  node.hidden = !text;
}

async function hydrateGitStats(root: HTMLElement, state: BoardState): Promise<void> {
  const existing = gitByBoard.get(state.boardId);
  if (existing && !existing.loading) {
    if (existing.alreadyLanded) landedByBoard.add(state.boardId);
    return;
  }
  gitByBoard.set(state.boardId, {
    loading: true,
    filesTouched: null,
    additions: null,
    deletions: null,
    hasRemote: false,
    hasGh: false,
    alreadyLanded: false,
  });
  try {
    const res = await workspaceLandingStats({ branch: integrationBranchName(state.boardId) });
    const next: GitLanding = {
      loading: false,
      filesTouched: typeof res.fileCount === 'number' ? res.fileCount : null,
      additions: typeof res.additions === 'number' ? res.additions : null,
      deletions: typeof res.deletions === 'number' ? res.deletions : null,
      hasRemote: res.hasRemote === true,
      hasGh: res.hasGh === true,
      alreadyLanded: res.alreadyLanded === true,
      error: res.ok ? undefined : res.error,
    };
    gitByBoard.set(state.boardId, next);
    if (next.alreadyLanded) landedByBoard.add(state.boardId);
    const stats = root.querySelector('.ov2-report-screen__stats');
    if (stats) stats.replaceWith(renderStats(state));
    const gitSlot = root.querySelector('[data-board-git-action]');
    if (gitSlot && next.alreadyLanded && gitSlot.getAttribute('data-board-git-action') === 'commit') {
      gitSlot.replaceWith(buildClearWorktrees(state));
    }
  } catch (err) {
    gitByBoard.set(state.boardId, {
      loading: false,
      filesTouched: null,
      additions: null,
      deletions: null,
      hasRemote: false,
      hasGh: false,
      alreadyLanded: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function totalAttempts(state: BoardState): number {
  let n = 0;
  for (const task of state.tasks.values()) n += task.attempts.filter((a) => a.ended).length;
  return n;
}

