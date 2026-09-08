/**
 * Issues sparkles expander overlay: propose, review, apply or discard.
 * Nothing is written to the store until Apply.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import type { IssueCard } from '../../src/types.ts';
import { ISSUES_COMPAT_VERSION, ISSUES_SCHEMA_VERSION } from '../../src/types.ts';

const { setIssuesStateForTests, findIssueById } = await import(
  '../../src/state/issues-store.ts'
);
const { setLocalServerAvailableForTests, setToolConfigForTests } = await import(
  '../../src/tools/config.ts'
);
const { defaultToolConfig } = await import('../../src/config/defaults.ts');
const {
  closeIssueExpandOverlay,
  isIssueExpandOverlayOpen,
  startIssueExpandFromUi,
} = await import('../../src/ui/issues-expand-controls.ts');
const { setExpandIssueFetcherForTests } = await import('../../src/ui/issues-expand.ts');
const { closeIssueDetail, openIssueDetail } = await import(
  '../../src/ui/issues-detail.ts'
);

const FIXED_NOW = 1_710_000_006_000;

let domWindow: Window | null = null;

function setupDom(): void {
  const window = new Window({ url: 'http://localhost/' });
  domWindow = window;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globalThis.HTMLFormElement = window.HTMLFormElement;
  globalThis.HTMLParagraphElement = window.HTMLParagraphElement;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.SVGElement = window.SVGElement;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  setLocalServerAvailableForTests(false);
  setToolConfigForTests(defaultToolConfig());

  document.body.innerHTML = `
    <main id="issuesView" class="issues-page">
      <div class="issues-shell">
        <div class="issues-body"></div>
      </div>
    </main>
    <div id="sDot"></div>
    <div id="sText"></div>
  `;
}

function seedIssue(over: Partial<IssueCard> = {}): IssueCard {
  const issue: IssueCard = {
    id: 'MIN-8',
    type: 'task',
    title: 'login broken',
    description: '',
    status: 'backlog',
    priority: 'none',
    labels: [],
    workspacePath: '/workspace',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    source: 'user',
    ...over,
  };
  setIssuesStateForTests({
    version: ISSUES_COMPAT_VERSION,
    schemaRevision: ISSUES_SCHEMA_VERSION,
    nextId: 9,
    issues: [issue],
    workspaces: {},
  });
  return issue;
}

beforeEach(() => {
  setupDom();
});

afterEach(() => {
  closeIssueExpandOverlay();
  setExpandIssueFetcherForTests(null);
  closeIssueDetail();
  setIssuesStateForTests(null);
  domWindow?.close();
  domWindow = null;
});

describe('issues expand overlay', () => {
  test('title-only expand proposes title and description without writing until Apply', async () => {
    seedIssue({ title: 'login broken', description: '' });
    setExpandIssueFetcherForTests(async (req) => {
      const draft = {
        title: 'Fix login save crash',
        description: 'Saving settings throws. Fill in repro from the stub.',
      };
      req.onPartial?.(draft);
      return { draft };
    });

    await startIssueExpandFromUi('MIN-8');

    assert.equal(isIssueExpandOverlayOpen(), true);
    assert.equal(findIssueById('MIN-8')?.title, 'login broken');
    assert.equal(findIssueById('MIN-8')?.description, '');

    const title = document.getElementById('issuesExpandTitle');
    const description = document.getElementById('issuesExpandDescription');
    assert.ok(title instanceof HTMLInputElement);
    assert.ok(description instanceof HTMLTextAreaElement);
    assert.equal(title.value, 'Fix login save crash');
    assert.match(description.value, /Saving settings throws/);
    assert.equal(title.readOnly, false);

    document.getElementById('issuesExpandApply')?.click();

    assert.equal(isIssueExpandOverlayOpen(), false);
    assert.equal(findIssueById('MIN-8')?.title, 'Fix login save crash');
    assert.match(findIssueById('MIN-8')?.description ?? '', /Saving settings throws/);
  });

  test('existing details are not wiped on Discard', async () => {
    seedIssue({
      title: 'Login',
      description: 'Null when saving settings. Keep this paragraph.',
    });
    setExpandIssueFetcherForTests(async () => ({
      draft: {
        title: 'Fix login save crash',
        description: 'Improved write-up that should not land unless applied.',
      },
    }));

    await startIssueExpandFromUi('MIN-8');
    assert.equal(isIssueExpandOverlayOpen(), true);
    document.getElementById('issuesExpandDiscard')?.click();

    assert.equal(isIssueExpandOverlayOpen(), false);
    assert.equal(findIssueById('MIN-8')?.title, 'Login');
    assert.equal(
      findIssueById('MIN-8')?.description,
      'Null when saving settings. Keep this paragraph.',
    );
  });

  test('user edits in the overlay are what Apply writes', async () => {
    seedIssue({ title: 'thin', description: '' });
    setExpandIssueFetcherForTests(async () => ({
      draft: { title: 'Proposed title', description: 'Proposed body.' },
    }));

    await startIssueExpandFromUi('MIN-8');
    const title = document.getElementById('issuesExpandTitle');
    const description = document.getElementById('issuesExpandDescription');
    assert.ok(title instanceof HTMLInputElement);
    assert.ok(description instanceof HTMLTextAreaElement);
    title.value = 'Edited title';
    description.value = 'Edited body that keeps the proposal as a starting point.';
    document.getElementById('issuesExpandApply')?.click();

    assert.equal(findIssueById('MIN-8')?.title, 'Edited title');
    assert.equal(
      findIssueById('MIN-8')?.description,
      'Edited body that keeps the proposal as a starting point.',
    );
  });

  test('apply refreshes the open detail pane without switching issues', async () => {
    seedIssue({ title: 'login broken', description: '' });
    setExpandIssueFetcherForTests(async (req) => {
      const draft = {
        title: 'Fix login save crash',
        description: 'Saving settings throws. Fill in repro from the stub.',
      };
      req.onPartial?.(draft);
      return { draft };
    });

    openIssueDetail('MIN-8');
    await startIssueExpandFromUi('MIN-8');
    assert.equal(isIssueExpandOverlayOpen(), true);

    document.getElementById('issuesExpandApply')?.click();

    assert.equal(findIssueById('MIN-8')?.title, 'Fix login save crash');
    // The detail refresh rides a dynamic import; let its microtask land.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const detailTitle = document.querySelector('.issues-detail__title');
    assert.ok(detailTitle instanceof HTMLInputElement, 'detail pane should still be open');
    assert.equal(detailTitle.value, 'Fix login save crash');
  });
});

describe('issues peek expand control', () => {
  test('peek header shows the sparkles expander on a backlog issue', () => {
    seedIssue({ status: 'backlog', title: 'thin', description: '' });
    openIssueDetail('MIN-8');

    const btn = document.querySelector('.issues-detail__header-actions [data-issue-expand]');
    assert.ok(btn instanceof HTMLButtonElement);
    assert.equal(btn.getAttribute('aria-label'), 'Expand issue');
    assert.equal(btn.dataset.issueExpand, 'MIN-8');
    assert.ok(btn.querySelector('.composer-expand-btn__icon'));
  });
});
