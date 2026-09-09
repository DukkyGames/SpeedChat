/**
 * What each task changed, as the end-of-run report shows it.
 *
 * A merged task has a commit, so git gives real per-file line counts. Anything
 * else only has the paths its attempts journaled — those render without counts
 * rather than inventing them.
 */

import type { TaskState } from '../../server/orchestrator/core/types';
import { collectAttemptFacts } from './attempt-scan';
import { el } from './dom';

export interface ReportFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface TaskFileSet {
  files: ReportFile[];
  additions: number;
  deletions: number;
  truncated: boolean;
  /** Paths came from attempt evidence, so `additions`/`deletions` are unknown. */
  countless: boolean;
}

const EMPTY: TaskFileSet = {
  files: [],
  additions: 0,
  deletions: 0,
  truncated: false,
  countless: true,
};

/** Union of every path the task's attempts recorded, newest attempt last. */
export function journaledTaskFiles(task: TaskState): TaskFileSet {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const attempt of task.attempts) {
    for (const path of collectAttemptFacts(attempt.evidence).files) {
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }
  if (!paths.length) return EMPTY;
  return {
    files: paths.map((path) => ({ path, additions: 0, deletions: 0, binary: false })),
    additions: 0,
    deletions: 0,
    truncated: false,
    countless: true,
  };
}

// ── Merged stats ─────────────────────────────────────────────────────────────

/** boardId → taskId → counted stats. `null` means git had nothing to give. */
const statsByBoard = new Map<string, Map<string, TaskFileSet | null>>();
/** In-flight loads, so a repaint joins the existing fetch instead of starting one. */
const inflightByBoard = new Map<string, Promise<void>>();
const listenersByBoard = new Map<string, Set<() => void>>();

export function clearReportFilesForTests(): void {
  statsByBoard.clear();
  inflightByBoard.clear();
  listenersByBoard.clear();
}

export function cachedTaskFiles(boardId: string, taskId: string): TaskFileSet | null | undefined {
  return statsByBoard.get(boardId)?.get(taskId);
}

/** Counted stats when git answered, otherwise whatever the attempts recorded. */
export function taskFileSet(boardId: string, task: TaskState): TaskFileSet {
  return cachedTaskFiles(boardId, task.id) ?? journaledTaskFiles(task);
}

/** True while a merged task is still waiting on its numstat. */
export function taskFilesPending(boardId: string, task: TaskState): boolean {
  return task.mergedSha != null && cachedTaskFiles(boardId, task.id) === undefined;
}

/**
 * Repaint hook for whichever report DOM is currently mounted. The board can be
 * repainted mid-fetch (a journal tick, the git-stats hydrate), so results are
 * broadcast rather than captured against the root that started the load.
 */
export function onTaskFilesProgress(boardId: string, listener: () => void): () => void {
  const set = listenersByBoard.get(boardId) ?? new Set<() => void>();
  listenersByBoard.set(boardId, set);
  set.add(listener);
  return () => set.delete(listener);
}

function announce(boardId: string): void {
  for (const listener of [...(listenersByBoard.get(boardId) ?? [])]) listener();
}

/** Four at a time: each one is a `git show --numstat` on the merge commit. */
const FETCH_CONCURRENCY = 4;

/**
 * Read per-file line counts for every merged task on the board, once.
 * Failures cache as "no counts" so the row falls back instead of retrying.
 */
export function loadMergedTaskFiles(boardId: string, tasks: TaskState[]): Promise<void> {
  const existing = inflightByBoard.get(boardId);
  if (existing) return existing;
  const wanted = tasks
    .filter((task) => task.mergedSha != null && cachedTaskFiles(boardId, task.id) === undefined)
    .map((task) => task.id);
  if (!wanted.length) return Promise.resolve();

  const run = fetchTaskFiles(boardId, wanted).finally(() => inflightByBoard.delete(boardId));
  inflightByBoard.set(boardId, run);
  return run;
}

async function fetchTaskFiles(boardId: string, taskIds: string[]): Promise<void> {
  let readTaskFiles: typeof import('./client.ts').readTaskFiles;
  try {
    ({ readTaskFiles } = await import('./client.ts'));
  } catch {
    return;
  }

  const bucket = statsByBoard.get(boardId) ?? new Map<string, TaskFileSet | null>();
  statsByBoard.set(boardId, bucket);

  const queue = [...taskIds];
  const worker = async (): Promise<void> => {
    for (let taskId = queue.shift(); taskId; taskId = queue.shift()) {
      let result: TaskFileSet | null = null;
      try {
        const res = await readTaskFiles(boardId, taskId);
        if (res.source === 'merged' && res.files.length) {
          result = {
            files: res.files.map((file) => ({
              path: file.path,
              additions: Number(file.additions) || 0,
              deletions: Number(file.deletions) || 0,
              binary: file.binary === true,
            })),
            additions: res.additions,
            deletions: res.deletions,
            truncated: res.truncated,
            countless: false,
          };
        }
      } catch {
        result = null;
      }
      bucket.set(taskId, result);
      announce(boardId);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, () => worker()),
  );
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * GitHub's five-block proportion bar: the split is rounded, not floored to at
 * least one block a side, so `+412 −6` reads as the near-pure addition it is.
 */
export function renderDiffBar(additions: number, deletions: number): HTMLElement {
  const bar = el('span', 'ov2-diffbar');
  bar.setAttribute('aria-hidden', 'true');
  const blocks = 5;
  const total = additions + deletions;
  const added = total > 0 ? Math.round((additions / total) * blocks) : 0;
  const removed = total > 0 ? blocks - added : 0;
  for (let i = 0; i < blocks; i += 1) {
    const state = i < added ? 'add' : i < added + removed ? 'del' : 'none';
    bar.appendChild(el('span', `ov2-diffbar__block ov2-diffbar__block--${state}`));
  }
  return bar;
}

function fileCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'file' : 'files'}`;
}

/** Row-level summary: `10 files +4389 −40 ▮▮▮▮▯`. */
export function renderDiffStat(set: TaskFileSet, pending = false): HTMLElement {
  const wrap = el('span', 'ov2-diffstat');
  if (pending && !set.files.length) {
    wrap.appendChild(el('span', 'ov2-diffstat__files', 'reading files…'));
    return wrap;
  }
  if (!set.files.length) {
    wrap.appendChild(el('span', 'ov2-diffstat__files', 'no files'));
    return wrap;
  }
  wrap.appendChild(el('span', 'ov2-diffstat__files', fileCountLabel(set.files.length)));
  if (set.countless) return wrap;
  wrap.appendChild(el('span', 'ov2-stat ov2-stat--add', `+${set.additions}`));
  wrap.appendChild(el('span', 'ov2-stat ov2-stat--del', `−${set.deletions}`));
  wrap.appendChild(renderDiffBar(set.additions, set.deletions));
  return wrap;
}

function pathLabel(path: string): HTMLElement {
  const wrap = el('span', 'ov2-report-file__path');
  const cut = path.lastIndexOf('/');
  if (cut >= 0) wrap.appendChild(el('span', 'ov2-report-file__dir', path.slice(0, cut + 1)));
  wrap.appendChild(el('span', 'ov2-report-file__name', cut >= 0 ? path.slice(cut + 1) : path));
  return wrap;
}

/** The changed-files table for one task. Paths are data, never markup. */
export function renderFileTable(set: TaskFileSet, pending = false): HTMLElement {
  const wrap = el('div', 'ov2-report-files-block');
  if (!set.files.length) {
    wrap.appendChild(
      el(
        'p',
        'ov2-report-screen__quiet',
        pending ? 'Reading the merge commit…' : 'No files recorded for this task.',
      ),
    );
    return wrap;
  }
  const list = el('ul', 'ov2-report-filelist');
  for (const file of set.files) {
    const row = el('li', 'ov2-report-file');
    row.appendChild(pathLabel(file.path));
    const stats = el('span', 'ov2-report-file__stats');
    if (set.countless) {
      // No merge commit, so git never counted these lines.
    } else if (file.binary) {
      stats.appendChild(el('span', 'ov2-report-file__binary', 'binary'));
    } else {
      stats.appendChild(el('span', 'ov2-stat ov2-stat--add', `+${file.additions}`));
      stats.appendChild(el('span', 'ov2-stat ov2-stat--del', `−${file.deletions}`));
      stats.appendChild(renderDiffBar(file.additions, file.deletions));
    }
    row.appendChild(stats);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  if (set.truncated) {
    wrap.appendChild(el('p', 'ov2-report-screen__quiet', 'Only the first 400 files are listed.'));
  }
  return wrap;
}
