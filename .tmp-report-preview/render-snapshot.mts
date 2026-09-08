import '../test/tools/install-dom-before-imports.mts';
import { mock } from 'node:test';
import { Window } from 'happy-dom';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installHappyDomGlobals } from '../test/os/dom-helpers.mts';

mock.module('dompurify', {
  defaultExport: { sanitize: (html: string) => html },
});
mock.module('../src/ui/sidebar.ts', {
  namedExports: { createChatWithMode: () => ({}) },
});
mock.module('../src/orchestrator/boards-view.ts', {
  namedExports: { closeBoardsView: async () => {} },
});
mock.module('../src/state/git-api.ts', {
  namedExports: { gitCommit: async () => ({ ok: true }), gitPush: async () => ({ ok: true }) },
});
mock.module('../src/ui/file-tree-refresh-bridge.ts', {
  namedExports: { refreshFileTreeViaBridge: async () => {} },
});
mock.module('../src/state/worktree-service.ts', {
  namedExports: {
    cleanupBoardWorktrees: async () => ({ ok: true, removed: 0 }),
    mergeIntegrationIntoWorkspace: async () => ({ ok: true, merged: true }),
    openWorkspacePr: async () => ({ ok: true }),
    workspaceLandingStats: async () => ({
      ok: true, fileCount: 50, additions: 4389, deletions: 40,
      hasRemote: true, hasGh: true, alreadyLanded: false,
    }),
  },
});

const MERGED_FILES: Record<string, Array<[string, number, number]>> = {
  'W1-A': [
    ['server/super-plan/middleware.js', 412, 6],
    ['server/super-plan/middleware.d.ts', 58, 0],
    ['test/super-plan/middleware.test.mjs', 233, 2],
    ['test/test-config.mjs', 3, 1],
  ],
  'W2-A': [
    ['src/orchestrator/board-report.ts', 288, 21],
    ['src/styles/orchestrator-boards.css', 190, 8],
  ],
  'W2-B': [
    ['server/runtime/middlewares.js', 44, 3],
    ['server/super-plan/live-events.js', 126, 0],
    ['server/super-plan/live-events.d.ts', 19, 0],
    ['documentation/context.md', 7, 2],
  ],
  'W3-A': [['src/skills/builtin-manifest.json', 1204, 0]],
};

mock.module('../src/orchestrator/client.ts', {
  namedExports: {
    readTaskFiles: async (_boardId: string, taskId: string) => {
      const rows = MERGED_FILES[taskId];
      if (!rows) return { source: 'planned', sha: null, files: [], additions: 0, deletions: 0, truncated: false };
      return {
        source: 'merged',
        sha: 'deadbee',
        files: rows.map(([path, additions, deletions]) => ({ path, additions, deletions, binary: false })),
        additions: rows.reduce((n, r) => n + r[1], 0),
        deletions: rows.reduce((n, r) => n + r[2], 0),
        truncated: false,
      };
    },
  },
});

const { derive } = await import('../server/orchestrator/core/derive.js');
const { renderBoardReport } = await import('../src/orchestrator/board-report.ts');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = new Window({ url: 'http://localhost/report' });
installHappyDomGlobals(win);

const task = (id: string, title: string, wave: number) => ({
  id, title, wave, dependsOn: [], touches: [],
});

const state = derive([
  {
    v: 1, seq: 1, type: 'board.created', boardId: 'preview',
    name: 'Super Plan server engine',
    planPath: 'documentation/plans/super-plan-engine.md', waves: [],
    tasks: [
      task('W1-A', 'HTTP middleware, live-events, boot scan', 1),
      task('W2-A', 'Report screen rebuild', 2),
      task('W2-B', 'Wire the runtime into the boot path', 2),
      task('W3-A', 'Regenerate the builtin skill manifest', 3),
      task('W3-B', 'Streaming transcript adapter', 3),
      task('W3-C', 'Retire the client-side controller', 3),
    ],
  },
  { v: 1, seq: 2, type: 'merge.succeeded', taskId: 'W1-A', sha: 'a91c4f77e21b' },
  { v: 1, seq: 3, type: 'merge.succeeded', taskId: 'W2-A', sha: 'b7712cd0aa54' },
  { v: 1, seq: 4, type: 'merge.succeeded', taskId: 'W2-B', sha: 'c0d3f1180ae2' },
  { v: 1, seq: 5, type: 'merge.succeeded', taskId: 'W3-A', sha: 'd41d8cd98f00' },
  { v: 1, seq: 6, type: 'task.abandoned', taskId: 'W3-B', reason: 'builder-no-report' },
  { v: 1, seq: 7, type: 'task.skipped', taskId: 'W3-C', blockedBy: 'W3-B' },
  {
    v: 1, seq: 8, type: 'final.test.ended', outcome: 'fail',
    runInstructions: 'command: npm test -- test/super-plan  cwd: .minnow/worktrees/preview/integration',
    evidence: { summary: 'Two suites fail on the integration branch: boot-scan and core-purity.' },
  },
  { v: 1, seq: 9, type: 'run.finished', summary: '4 merged, 1 abandoned, 1 skipped, final test fail' },
]);

const attempt = (over: Record<string, unknown>) => ({
  worktree: null, seedKind: 'initial', ended: true, manual: false, retired: false, ...over,
});

state.tasks.get('W1-A')!.attempts.unshift(
  attempt({
    attemptId: 'w1a-b', role: 'builder', outcome: 'pass',
    summary:
      'W1-A complete. Built the middleware route table, the boot scan, and the factory seam, then wired live-events through subscribeLive/emitLive. Added three suites and registered the new mock-based one in test-config.',
    evidence: { files: MERGED_FILES['W1-A'].map((r) => r[0]) },
  }),
  attempt({
    attemptId: 'w1a-t', role: 'tester', outcome: 'pass',
    summary: 'All four suites green: middleware 15 pass, boot-scan 3 pass, core-purity 12 pass, api 33 pass.',
    evidence: { testOutput: '# tests 63\n# pass 63\n# fail 0' },
  }),
);
state.tasks.get('W2-A')!.attempts.unshift(
  attempt({
    attemptId: 'w2a-b', role: 'builder', outcome: 'pass',
    summary: 'Rebuilt the report as a dashboard: stat tiles, an attention list, and one row per task.',
    evidence: { files: MERGED_FILES['W2-A'].map((r) => r[0]) },
  }),
);
state.tasks.get('W2-B')!.attempts.unshift(
  attempt({
    attemptId: 'w2b-b1', role: 'builder', outcome: 'fail', seedKind: 'initial',
    summary: 'The runtime booted twice because middlewares.js already registered a factory.',
    evidence: { blockers: ['bootSuperPlanRuntime ran on both the HTTP and the worker path.'] },
  }),
  attempt({
    attemptId: 'w2b-b2', role: 'builder', outcome: 'pass', seedKind: 'failure-aware',
    summary: 'Moved the boot behind createSuperPlanMiddleware so only the HTTP path owns it.',
    evidence: { files: MERGED_FILES['W2-B'].map((r) => r[0]) },
  }),
);
state.tasks.get('W3-A')!.attempts.unshift(
  attempt({
    attemptId: 'w3a-b', role: 'builder', outcome: 'pass',
    summary: 'Regenerated the manifest from the library index.',
    evidence: { files: ['src/skills/builtin-manifest.json'] },
  }),
);
state.tasks.get('W3-B')!.attempts.push(
  attempt({
    attemptId: 'w3b-b1', role: 'builder', outcome: 'no_report', retired: true,
    summary: 'Started the adapter, then stopped mid-file without filing a report.',
    evidence: { files: ['src/orchestrator/transcript-adapter.ts'] },
  }),
  attempt({
    attemptId: 'w3b-b2', role: 'builder', outcome: 'blocked',
    summary:
      'The adapter needs the attempt transcript endpoint, which returns 401 for sub-agents because the live SSE stream has no session token attached.',
    evidence: {
      blockers: ['GET /api/boards/preview/attempts/:id returns 401 without a session token.'],
      needs: ['a session token on the sub-agent SSE subscribe'],
      testOutput: 'FAIL test/orchestrator/transcript-adapter.test.mts\n  Expected 200, received 401',
      files: ['src/orchestrator/transcript-adapter.ts', 'test/orchestrator/transcript-adapter.test.mts'],
    },
  }),
);

document.body.append(
  renderBoardReport(
    state,
    '## Review notes\n\nFour of six tasks merged cleanly. The transcript adapter is blocked on sub-agent auth; the skipped card is only waiting on it. Fix the 401 before rerunning.',
    false,
    { dismiss() {}, reopen() {}, fixFinal() {}, resetTask() {} },
  ),
);

// Let the lazy client fetch land before serialising.
await new Promise((resolve) => setTimeout(resolve, 50));

// Open two rows so the snapshot shows the runs + files layout, not just headers.
for (const id of ['W1-A', 'W3-B']) {
  const card = [...document.querySelectorAll('.ov2-report-task')].find(
    (node) => (node as HTMLElement).dataset.taskId === id,
  ) as HTMLDetailsElement | undefined;
  if (!card) continue;
  card.open = true;
  card.dispatchEvent(new win.Event('toggle'));
}

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
  * { transition: none !important; animation: none !important; }
  /* Mirror the real shell: container host + pane, but let the page grow. */
  .harness { container-type: inline-size; container-name: ov2; display: block; }
  .harness .ov2 { display: block; height: auto; }
  .harness .ov2__board { overflow: visible; }
</style>
</head>
<body><div class="harness"><div class="ov2"><div class="ov2__board">${document.body.innerHTML}</div></div></div></body>
</html>`;

writeFileSync(join(root, '.tmp-report-preview/snapshot.html'), html);
console.log('tasks', document.querySelectorAll('.ov2-report-task').length);
console.log('attention', document.querySelectorAll('.ov2-attention__row').length);
console.log('tiles', document.querySelectorAll('.ov2-stat-tile').length);
