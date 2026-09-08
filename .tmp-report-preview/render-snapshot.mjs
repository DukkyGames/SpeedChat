import { Window } from 'happy-dom';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installHappyDomGlobals } from '../test/os/dom-helpers.mts';
import { derive } from '../server/orchestrator/core/derive.js';
import { renderBoardReport } from '../src/orchestrator/board-report.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = new Window({ url: 'http://localhost/report' });
installHappyDomGlobals(win);

const state = derive([
  {
    v: 1, seq: 1, type: 'board.created', boardId: 'preview',
    name: 'Agent reliability improvements',
    planPath: 'documentation/plans/reliability.md', waves: [],
    tasks: [
      { id: 'W1-A', title: 'Propagate timeouts through agent execution', wave: 1, dependsOn: [], touches: [] },
      { id: 'W1-B', title: 'Recover interrupted research runs', wave: 1, dependsOn: [], touches: [] },
    ],
  },
  { v: 1, seq: 2, type: 'merge.succeeded', taskId: 'W1-A', sha: 'abc123' },
  { v: 1, seq: 3, type: 'task.abandoned', taskId: 'W1-B', reason: 'user' },
  { v: 1, seq: 4, type: 'board.stopped', reason: 'user' },
]);

state.tasks.get('W1-A').attempts.push({
  attemptId: 'run-pass', role: 'builder', ended: true, outcome: 'pass',
  summary: 'Timeouts now abort the in-flight turn and surface a retry. The rest of this write-up is the long Builder paragraph that used to dump as a wall of text UNIQUE_PREVIEW_TOKEN including files and tests.',
  evidence: { files: ['src/agents/timeout.ts'] }, retired: false, worktree: null, seedKind: 'initial', manual: false,
});
state.tasks.get('W1-B').attempts.push({
  attemptId: 'run-example', role: 'tester', ended: true, outcome: 'fail',
  summary: 'Recovery works, but type checking found a missing model field. Follow-up notes UNIQUE_FAIL_TOKEN stay behind the write-up disclosure.',
  evidence: {
    blockers: ['The recovery handler does not include modelId in the resumed run.'],
    testOutput: 'src/agents/recovery.ts(12,3): error TS2739: Missing modelId',
    diff: {
      files: ['src/agents/recovery.ts', 'test/agents/recovery.test.ts'],
      patch: 'diff --git a/src/agents/recovery.ts b/src/agents/recovery.ts\n+ modelId: run.modelId',
      truncated: true,
      originalLength: 51651,
    },
  },
  retired: false, worktree: null, seedKind: 'initial', manual: false,
});

document.body.append(renderBoardReport(
  state,
  '## Review notes\n\nTimeout propagation is merged. Resume the recovery task after fixing the missing model field.',
  false,
  { dismiss() {}, reopen() {}, fixFinal() {} },
));

const tokens = pathToFileURL(join(root, 'src/styles/tokens.css')).href;
const boards = pathToFileURL(join(root, 'src/styles/orchestrator-boards.css')).href;
const html = `<!doctype html>
<html data-theme="swamp-dark">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${tokens}">
<link rel="stylesheet" href="${boards}">
<style>
  body { margin: 0; background: var(--mn-bg); color: var(--mn-fg); font-family: var(--font-ui, system-ui); }
  button { background: var(--mn-surface-1); color: var(--mn-fg); border: 1px solid var(--mn-border); border-radius: 6px; padding: 8px 12px; }
</style>
</head>
<body>${document.body.innerHTML}</body>
</html>`;

writeFileSync(join(root, '.tmp-report-preview/snapshot.html'), html);
console.log('wrote snapshot', document.querySelectorAll('.ov2-report-card').length, 'cards');
