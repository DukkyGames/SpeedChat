/**
 * The report's file column: journalled paths when a task never merged, real
 * per-file counts when it did, and a GitHub-shaped proportion bar.
 */
import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import type { TaskState } from '../../server/orchestrator/core/types';

/** A gate the test can hold open, so "repaint mid-fetch" is actually reachable. */
let gate: Promise<void> | null = null;
let announceReadStarted: (() => void) | null = null;
let reads = 0;

mock.module('../../src/orchestrator/client.ts', {
  namedExports: {
    readTaskFiles: async (_boardId: string, taskId: string) => {
      reads += 1;
      announceReadStarted?.();
      if (gate) await gate;
      return {
        source: 'merged',
        sha: 'abc123',
        files: [{ path: `src/${taskId}.ts`, additions: 4, deletions: 1, binary: false }],
        additions: 4,
        deletions: 1,
        truncated: false,
      };
    },
  },
});

const {
  cachedTaskFiles,
  clearReportFilesForTests,
  journaledTaskFiles,
  loadMergedTaskFiles,
  onTaskFilesProgress,
  renderDiffBar,
  renderDiffStat,
  renderFileTable,
} = await import('../../src/orchestrator/report-files.ts');

let activeWindow: Window | undefined;

function setupDom(): void {
  activeWindow?.close();
  const win = new Window();
  activeWindow = win;
  installHappyDomGlobals(win);
}

afterEach(() => {
  clearReportFilesForTests();
  gate = null;
  announceReadStarted = null;
  reads = 0;
  if (!activeWindow) return;
  document.body.innerHTML = '';
  activeWindow.close();
  activeWindow = undefined;
});

function attempt(evidence: unknown) {
  return {
    attemptId: `a${Math.random()}`,
    role: 'builder' as const,
    worktree: null,
    seedKind: 'initial' as const,
    ended: true,
    outcome: 'pass' as const,
    summary: null,
    evidence: evidence as never,
    manual: false,
    retired: false,
  };
}

function taskWith(attempts: ReturnType<typeof attempt>[]): TaskState {
  return { attempts } as unknown as TaskState;
}

/** Blocks as a compact string: g = added, r = removed, . = untouched. */
function barShape(additions: number, deletions: number): string {
  return [...renderDiffBar(additions, deletions).children]
    .map((node) =>
      node.classList.contains('ov2-diffbar__block--add')
        ? 'g'
        : node.classList.contains('ov2-diffbar__block--del')
          ? 'r'
          : '.',
    )
    .join('');
}

describe('journaledTaskFiles', () => {
  test('unions every attempt path once, in the order they were recorded', () => {
    const task = taskWith([
      attempt({ diff: { files: ['src/a.ts', 'src/b.ts'] } }),
      attempt({ files: ['src/b.ts', 'test/a.test.ts'] }),
    ]);
    const set = journaledTaskFiles(task);
    assert.deepEqual(
      set.files.map((file) => file.path),
      ['src/a.ts', 'src/b.ts', 'test/a.test.ts'],
    );
    // Without a merge commit there is nothing to count, so it must not claim zero.
    assert.equal(set.countless, true);
  });

  test('is empty when no attempt recorded a path', () => {
    assert.deepEqual(journaledTaskFiles(taskWith([attempt({ blockers: ['nope'] })])).files, []);
  });
});

describe('renderDiffBar', () => {
  test('rounds the split rather than forcing a block onto the smaller side', () => {
    setupDom();
    assert.equal(barShape(412, 6), 'ggggg');
    assert.equal(barShape(10, 0), 'ggggg');
    assert.equal(barShape(0, 10), 'rrrrr');
    assert.equal(barShape(50, 50), 'gggrr');
    assert.equal(barShape(1, 999), 'rrrrr');
    assert.equal(barShape(0, 0), '.....');
  });
});

describe('renderDiffStat', () => {
  test('shows counts and a bar only when git actually counted them', () => {
    setupDom();
    const counted = renderDiffStat({
      files: [{ path: 'a.ts', additions: 9, deletions: 1, binary: false }],
      additions: 9,
      deletions: 1,
      truncated: false,
      countless: false,
    });
    assert.match(counted.textContent!, /1 file/);
    assert.match(counted.textContent!, /\+9/);
    assert.ok(counted.querySelector('.ov2-diffbar'));

    const journalled = renderDiffStat(journaledTaskFiles(taskWith([attempt({ files: ['a.ts'] })])));
    assert.equal(journalled.textContent, '1 file');
    assert.equal(journalled.querySelector('.ov2-diffbar'), null);
  });

  test('says so while a merged task is still waiting on its numstat', () => {
    setupDom();
    const empty = { files: [], additions: 0, deletions: 0, truncated: false, countless: true };
    assert.match(renderDiffStat(empty, true).textContent!, /reading files/);
    assert.equal(renderDiffStat(empty, false).textContent, 'no files');
  });
});

describe('renderFileTable', () => {
  test('splits the path so the filename reads first, and never renders markup', () => {
    setupDom();
    const table = renderFileTable({
      files: [
        { path: 'src/<img src=x>/evil.ts', additions: 3, deletions: 0, binary: false },
        { path: 'assets/logo.png', additions: 0, deletions: 0, binary: true },
      ],
      additions: 3,
      deletions: 0,
      truncated: true,
      countless: false,
    });
    document.body.append(table);
    assert.equal(table.querySelector('img'), null);
    assert.match(table.textContent!, /<img src=x>/);
    const [first, second] = table.querySelectorAll('.ov2-report-file');
    assert.equal(first.querySelector('.ov2-report-file__dir')?.textContent, 'src/<img src=x>/');
    assert.equal(first.querySelector('.ov2-report-file__name')?.textContent, 'evil.ts');
    assert.match(second.textContent!, /binary/);
    assert.match(table.textContent!, /first 400 files/);
  });
});

describe('loadMergedTaskFiles', () => {
  const mergedTask = (id: string) =>
    ({ id, mergedSha: 'abc123', attempts: [] }) as unknown as TaskState;

  test('a repaint mid-fetch joins the running load and hears the result', async () => {
    let openGate!: () => void;
    gate = new Promise<void>((resolve) => (openGate = resolve));
    const readStarted = new Promise<void>((resolve) => (announceReadStarted = resolve));

    const first: number[] = [];
    const stopFirst = onTaskFilesProgress('b1', () => first.push(1));
    const started = loadMergedTaskFiles('b1', [mergedTask('W1-A')]);
    await readStarted;

    // A second render arrives while the numstat is still out.
    const second: number[] = [];
    const stopSecond = onTaskFilesProgress('b1', () => second.push(1));
    const joined = loadMergedTaskFiles('b1', [mergedTask('W1-A')]);
    assert.equal(joined, started, 'the repaint must join the run, not start a second one');

    openGate();
    await joined;
    stopFirst();
    stopSecond();

    assert.equal(reads, 1, 'one numstat per merged task, however many repaints happened');
    assert.deepEqual(second, [1], 'the render that arrived mid-fetch was told to repaint');
    assert.deepEqual(first, [1]);
    assert.equal(cachedTaskFiles('b1', 'W1-A')?.additions, 4);
  });

  test('does not refetch what is already cached, and skips unmerged tasks', async () => {
    await loadMergedTaskFiles('b2', [mergedTask('W1-A')]);
    assert.equal(reads, 1);
    await loadMergedTaskFiles('b2', [mergedTask('W1-A')]);
    assert.equal(reads, 1, 'a cached task is never read twice');

    const idle = { id: 'W1-B', mergedSha: null, attempts: [] } as unknown as TaskState;
    await loadMergedTaskFiles('b3', [idle]);
    assert.equal(reads, 1, 'a task with no merge commit has nothing to read');
    assert.equal(cachedTaskFiles('b3', 'W1-B'), undefined);
  });
});
