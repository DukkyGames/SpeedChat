/**
 * The localDirty flag lifecycle: set only on GitHub-shaped edits, cleared by
 * every successful sync, and self-healed on an equal-content noop so the
 * "Needs push" caption can never stick (MIN-287).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { githubSyncCaption } from '../../src/issues/github-sync-status.ts';
import {
  resetIssuesGithubForTests,
  setIssuesGithubMode,
  syncIssueWithGithub,
} from '../../src/state/issues-github.ts';
import {
  findIssueById,
  setIssuesStateForTests,
  updateIssue,
} from '../../src/state/issues-store.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import type { IssueCard, IssueGithubLink } from '../../src/types.ts';

const SYNCED_AT = 1_000;

const memory = new Map<string, string>();
const storage: Storage = {
  getItem(key: string) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  setItem(key: string, value: string) {
    memory.set(key, String(value));
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  },
  key() {
    return null;
  },
  get length() {
    return memory.size;
  },
};

const originalFetch = globalThis.fetch;
const forgeCalls: Record<string, unknown>[] = [];

function gitJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function githubLink(partial: Partial<IssueGithubLink> = {}): IssueGithubLink {
  return {
    number: 5,
    url: 'https://github.com/acme/app/issues/5',
    syncedAt: SYNCED_AT,
    localUpdatedAt: SYNCED_AT,
    remoteUpdatedAt: SYNCED_AT,
    ...partial,
  };
}

function card(partial: Partial<IssueCard> = {}): IssueCard {
  return {
    id: 'MIN-1',
    type: 'task',
    title: 'Local title',
    description: 'Local body',
    status: 'todo',
    priority: 'none',
    labels: ['bug'],
    workspacePath: '/w',
    createdAt: 0,
    updatedAt: SYNCED_AT,
    ...partial,
  } as IssueCard;
}

/** Remote matches the default card exactly; issueEdit/issueState succeed. */
function mockForge(): void {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    forgeCalls.push(body);
    const op = typeof body.op === 'string' ? body.op : '';
    if (op === 'issueView') {
      return gitJsonResponse({
        ok: true,
        issue: {
          number: 5,
          title: 'Local title',
          body: 'Local body',
          state: 'open',
          url: 'https://github.com/acme/app/issues/5',
          labels: ['bug'],
          updatedAt: SYNCED_AT,
        },
      });
    }
    if (op === 'issueEdit' || op === 'issueState' || op === 'issueCreate') {
      return gitJsonResponse({ ok: true, number: 5 });
    }
    return gitJsonResponse({ ok: false, error: `unexpected ${op}` }, 400);
  };
}

function linkOf(): IssueGithubLink | undefined {
  return findIssueById('MIN-1')?.github;
}

describe('GitHub sync localDirty flag', () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeEach(() => {
    memory.clear();
    forgeCalls.length = 0;
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    resetIssuesGithubForTests();
    setIssuesGithubMode('mirror');
    setLocalServerAvailableForTests(true);
    setIssuesStateForTests({
      version: 2,
      nextId: 2,
      issues: [card({ github: githubLink({ localDirty: false }) })],
      workspaces: {},
    });
    mockForge();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetIssuesGithubForTests();
    setIssuesStateForTests({ version: 2, nextId: 1, issues: [], workspaces: {} });
    setLocalServerAvailableForTests(false);
    if (previousStorage) {
      Object.defineProperty(globalThis, 'localStorage', previousStorage);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  test('a title edit sets localDirty and the caption flips to Needs push', () => {
    updateIssue('MIN-1', { title: 'Changed locally' });
    assert.equal(linkOf()?.localDirty, true);
    assert.equal(githubSyncCaption(findIssueById('MIN-1')!, SYNCED_AT + 20), 'Needs push');
  });

  test('rank and assignee edits never set localDirty', () => {
    updateIssue('MIN-1', { rank: 'a' });
    updateIssue('MIN-1', { assignee: { id: 'me', assignedAt: 1 } });
    assert.equal(linkOf()?.localDirty, false);
    assert.match(githubSyncCaption(findIssueById('MIN-1')!, SYNCED_AT + 20), /^synced /);
  });

  test('a pull apply (skipGithubAutoSync) never sets localDirty', () => {
    updateIssue('MIN-1', { title: 'From GitHub' }, { skipGithubAutoSync: true });
    assert.equal(linkOf()?.localDirty, false);
  });

  test('an equal-content sync self-heals a stale flag without an edit call', async () => {
    updateIssue('MIN-1', { rank: 'a' }); // bump updatedAt, not the flag
    setIssuesStateForTests({
      version: 2,
      nextId: 2,
      issues: [card({ github: githubLink({ localDirty: true }) })],
      workspaces: {},
    });

    const outcome = await syncIssueWithGithub('MIN-1');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.action, 'noop');
    assert.equal(forgeCalls.some((call) => call.op === 'issueEdit'), false);
    assert.equal(linkOf()?.localDirty, false);
    assert.equal(linkOf()?.localUpdatedAt, findIssueById('MIN-1')!.updatedAt);
    assert.match(githubSyncCaption(findIssueById('MIN-1')!, Date.now() + 60_000), /^synced /);
  });

  test('a push clears the flag and the watermark covers the edit', async () => {
    setIssuesStateForTests({
      version: 2,
      nextId: 2,
      issues: [
        card({
          title: 'Changed locally',
          github: githubLink({ localDirty: true }),
        }),
      ],
      workspaces: {},
    });

    const outcome = await syncIssueWithGithub('MIN-1');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.action, 'push');
    const issue = findIssueById('MIN-1')!;
    assert.equal(issue.github?.localDirty, false);
    assert.equal(issue.github?.localUpdatedAt, issue.updatedAt);
    assert.match(githubSyncCaption(issue, Date.now() + 60_000), /^synced /);
  });

  test('a remote-only change pulls instead of conflicting when the flag is clean', async () => {
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      forgeCalls.push(body);
      const op = typeof body.op === 'string' ? body.op : '';
      if (op === 'issueView') {
        return gitJsonResponse({
          ok: true,
          issue: {
            number: 5,
            title: 'Changed remotely',
            body: 'Local body',
            state: 'open',
            url: 'https://github.com/acme/app/issues/5',
            labels: ['bug'],
            updatedAt: SYNCED_AT + 10,
          },
        });
      }
      return gitJsonResponse({ ok: false, error: `unexpected ${op}` }, 400);
    };

    const outcome = await syncIssueWithGithub('MIN-1');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.action, 'pull');
    const issue = findIssueById('MIN-1')!;
    assert.equal(issue.title, 'Changed remotely');
    assert.equal(issue.github?.localDirty, false);
  });
});