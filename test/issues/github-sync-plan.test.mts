/**
 * Sync planning — the "mirror mode never silently loses an edit" gate.
 *
 * Every branch is reachable here because the planner is pure: no clock, no
 * network, only timestamps and content. The case that matters most is the one
 * that must *refuse* to act.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  gitLinkDuplicatesGithubIssue,
  githubIssueNumberFromRef,
  githubLabelDiff,
  githubSyncedFieldsChanged,
  githubSyncedSnapshot,
  issueNeedsGithubPush,
  nextGithubLink,
  normalizeGithubMode,
  planIssueSync,
  syncFieldsEqual,
  type RemoteIssueSnapshot,
} from '../../src/issues/github-sync-plan.ts';
import type { IssueCard, IssueGithubLink } from '../../src/types.ts';

const SYNCED_AT = 1_000;

function issue(partial: Partial<IssueCard> = {}): IssueCard {
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
    githubSync: true,
    ...partial,
  } as IssueCard;
}

function link(partial: Partial<IssueGithubLink> = {}): IssueGithubLink {
  return {
    number: 7,
    url: 'https://github.com/o/r/issues/7',
    syncedAt: SYNCED_AT,
    localUpdatedAt: SYNCED_AT,
    remoteUpdatedAt: SYNCED_AT,
    ...partial,
  };
}

function remote(partial: Partial<RemoteIssueSnapshot> = {}): RemoteIssueSnapshot {
  return {
    number: 7,
    title: 'Local title',
    body: 'Local body',
    state: 'open',
    url: 'https://github.com/o/r/issues/7',
    labels: ['bug'],
    updatedAt: SYNCED_AT,
    ...partial,
  };
}

describe('mode gating', () => {
  test('off never contacts anything', () => {
    const action = planIssueSync({ mode: 'off', issue: issue(), isClosed: false, remote: null });
    assert.equal(action.kind, 'noop');
  });

  test('mirror ignores the leftover per-issue flag — the mode is the opt-in', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ githubSync: false }),
      isClosed: false,
      remote: null,
    });
    assert.equal(action.kind, 'create');
  });
});

describe('first push', () => {
  test('an unlinked issue is created', () => {
    assert.equal(
      planIssueSync({ mode: 'mirror', issue: issue(), isClosed: false, remote: null }).kind,
      'create',
    );
  });

  test('a linked issue whose remote cannot be read does nothing', () => {
    // Recreating it would duplicate the issue on the remote; that is the
    // user's call, not a sync pass's.
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link() }),
      isClosed: false,
      remote: null,
    });
    assert.equal(action.kind, 'noop');
    assert.match(action.kind === 'noop' ? action.reason : '', /#7 could not be read/);
  });
});

describe('one-sided changes', () => {
  test('a local edit pushes', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link(), title: 'Changed locally', updatedAt: SYNCED_AT + 10 }),
      isClosed: false,
      remote: remote(),
    });
    assert.equal(action.kind, 'push');
    assert.equal(action.kind === 'push' ? action.fields.title : '', 'Changed locally');
  });

  test('a remote edit pulls in mirror mode', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link() }),
      isClosed: false,
      remote: remote({ title: 'Changed remotely', updatedAt: SYNCED_AT + 10 }),
    });
    assert.equal(action.kind, 'pull');
    assert.equal(action.kind === 'pull' ? action.fields.title : '', 'Changed remotely');
  });

  test('closing locally pushes the closed state', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link(), updatedAt: SYNCED_AT + 10 }),
      isClosed: true,
      remote: remote(),
    });
    assert.equal(action.kind === 'push' && action.fields.closed, true);
  });
});

describe('conflicts', () => {
  test('both sides edited pulls the newer remote', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link(), title: 'Mine', updatedAt: SYNCED_AT + 5 }),
      isClosed: false,
      remote: remote({ title: 'Theirs', updatedAt: SYNCED_AT + 9 }),
    });
    assert.equal(action.kind, 'pull');
    assert.equal(action.kind === 'pull' && action.fields.title, 'Theirs');
  });

  test('a newer remote wins a conflict', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link(), title: 'Mine', updatedAt: SYNCED_AT + 1 }),
      isClosed: false,
      remote: remote({ title: 'Theirs', updatedAt: SYNCED_AT + 10_000 }),
    });
    assert.equal(action.kind, 'pull');
  });

  test('equal timestamps deterministically prefer the remote', () => {
    // Something is diverging that the watermarks do not explain. Asking is the
    // only answer that cannot lose an edit.
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link() }),
      isClosed: false,
      remote: remote({ title: 'Different', updatedAt: SYNCED_AT }),
    });
    assert.equal(action.kind, 'pull');
  });

  test('a remote with no updatedAt is never treated as changed', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link(), title: 'Mine', updatedAt: SYNCED_AT + 5 }),
      isClosed: false,
      remote: remote({ updatedAt: undefined }),
    });
    assert.equal(action.kind, 'push');
  });
});

describe('no-ops', () => {
  test('identical content does nothing at all', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link() }),
      isClosed: false,
      remote: remote(),
    });
    assert.equal(action.kind, 'noop');
    assert.match(action.kind === 'noop' ? action.reason : '', /Already in sync/);
  });

  test('label order and whitespace do not count as a change', () => {
    const action = planIssueSync({
      mode: 'mirror',
      issue: issue({ github: link(), labels: ['bug', 'ui'], title: '  Local title  ' }),
      isClosed: false,
      remote: remote({ labels: ['ui', 'bug'] }),
    });
    assert.equal(action.kind, 'noop');
  });
});

describe('syncFieldsEqual', () => {
  const base = { title: 'a', body: 'b', closed: false, labels: ['x'] };
  test('compares every synced field', () => {
    assert.equal(syncFieldsEqual(base, { ...base }), true);
    assert.equal(syncFieldsEqual(base, { ...base, title: 'z' }), false);
    assert.equal(syncFieldsEqual(base, { ...base, body: 'z' }), false);
    assert.equal(syncFieldsEqual(base, { ...base, closed: true }), false);
    assert.equal(syncFieldsEqual(base, { ...base, labels: ['y'] }), false);
    assert.equal(syncFieldsEqual(base, { ...base, labels: ['x', 'y'] }), false);
  });

  test('label casing is not a change (GitHub names are case-insensitive)', () => {
    assert.equal(
      syncFieldsEqual(base, { ...base, labels: ['X'] }),
      true,
    );
  });
});

describe('githubLabelDiff', () => {
  test('adds local-only names and removes remote-only names', () => {
    assert.deepEqual(githubLabelDiff(['bug', 'ui'], ['bug']), {
      add: ['ui'],
      remove: [],
    });
    assert.deepEqual(githubLabelDiff(['bug'], ['bug', 'docs']), {
      add: [],
      remove: ['docs'],
    });
    assert.deepEqual(githubLabelDiff(['ux'], ['bug']), {
      add: ['ux'],
      remove: ['bug'],
    });
  });

  test('keeps remote casing on remove so gh hits the real name', () => {
    assert.deepEqual(githubLabelDiff(['Bug'], ['bug', 'Docs']), {
      add: [],
      remove: ['Docs'],
    });
  });

  test('empty local set removes every remote label', () => {
    assert.deepEqual(githubLabelDiff([], ['bug', 'docs']), {
      add: [],
      remove: ['bug', 'docs'],
    });
  });
});

describe('watermark', () => {
  test('records both sides so the next pass can tell what moved', () => {
    const next = nextGithubLink({
      number: 7,
      url: 'u',
      repo: 'o/r',
      localUpdatedAt: 50,
      remoteUpdatedAt: 60,
      now: 100,
    });
    assert.deepEqual(next, {
      number: 7,
      url: 'u',
      repo: 'o/r',
      syncedAt: 100,
      localUpdatedAt: 50,
      localChangedAt: 50,
      remoteUpdatedAt: 60,
    });
  });

  test('carries the repo forward when a later sync omits it', () => {
    const previous = nextGithubLink({ number: 7, url: 'u', repo: 'o/r', localUpdatedAt: 1, now: 1 });
    const next = nextGithubLink({ previous, number: 7, url: 'u', localUpdatedAt: 2, now: 2 });
    assert.equal(next.repo, 'o/r');
  });
});

describe('normalizeGithubMode', () => {
  test('defaults to off for anything unrecognized', () => {
    assert.equal(normalizeGithubMode('mirror'), 'mirror');
    assert.equal(normalizeGithubMode('link'), 'off');
    assert.equal(normalizeGithubMode('nonsense'), 'off');
    assert.equal(normalizeGithubMode(undefined), 'off');
    assert.equal(normalizeGithubMode(3), 'off');
  });
});

describe('issueNeedsGithubPush', () => {
  test('is false when unlinked or unchanged since the watermark', () => {
    assert.equal(issueNeedsGithubPush(issue()), false);
    assert.equal(issueNeedsGithubPush(issue({ github: link() })), false);
  });

  test('is true when local updatedAt is after the watermark', () => {
    assert.equal(
      issueNeedsGithubPush(issue({ github: link(), updatedAt: SYNCED_AT + 10 })),
      true,
    );
  });
});

describe('githubSyncedFieldsChanged', () => {
  test('title, body, labels, and closed count; rank-like extras are not in the snapshot', () => {
    const open = githubSyncedSnapshot(issue({ title: 'A', description: 'B', labels: ['x'] }), false);
    assert.equal(githubSyncedFieldsChanged(open, githubSyncedSnapshot(issue({ title: 'A2', description: 'B', labels: ['x'] }), false)), true);
    assert.equal(githubSyncedFieldsChanged(open, githubSyncedSnapshot(issue({ title: 'A', description: 'B2', labels: ['x'] }), false)), true);
    assert.equal(githubSyncedFieldsChanged(open, githubSyncedSnapshot(issue({ title: 'A', description: 'B', labels: ['y'] }), false)), true);
    assert.equal(githubSyncedFieldsChanged(open, githubSyncedSnapshot(issue({ title: 'A', description: 'B', labels: ['x'] }), true)), true);
    assert.equal(
      githubSyncedFieldsChanged(open, githubSyncedSnapshot(issue({ title: 'A', description: 'B', labels: ['x'] }), false)),
      false,
    );
    assert.equal(syncFieldsEqual(open, githubSyncedSnapshot(issue({ title: ' A ', description: 'B', labels: ['x'] }), false)), true);
  });
});

describe('gitLinkDuplicatesGithubIssue', () => {
  test('parses #n and matches the linked GitHub number', () => {
    assert.equal(githubIssueNumberFromRef('#12'), 12);
    assert.equal(githubIssueNumberFromRef('12'), 12);
    assert.equal(githubIssueNumberFromRef('pr/12'), null);
    const linked = issue({ github: link({ number: 5 }) });
    assert.equal(gitLinkDuplicatesGithubIssue({ kind: 'github-issue', ref: '#5' }, linked), true);
    assert.equal(gitLinkDuplicatesGithubIssue({ kind: 'github-issue', ref: '#6' }, linked), false);
    assert.equal(gitLinkDuplicatesGithubIssue({ kind: 'pr', ref: '#5' }, linked), false);
  });
});

 test('metadata updates do not need a push once the link has a field watermark', () => {
  assert.equal(issueNeedsGithubPush(issue({ github: link({ localChangedAt: SYNCED_AT }), updatedAt: SYNCED_AT + 100 })), false);
 });
 test('newer local synced fields win a conflict', () => {
  const action = planIssueSync({ mode: 'mirror', issue: issue({ github: link({ localChangedAt: 3000 }), title: 'Mine', updatedAt: 9000 }), isClosed: false, remote: remote({ title: 'Theirs', updatedAt: 2000 }) });
  assert.equal(action.kind, 'push');
 });
 test('metadata timestamp cannot win over newer remote fields', () => {
  const action = planIssueSync({ mode: 'mirror', issue: issue({ github: link({ localChangedAt: 2000 }), title: 'Mine', updatedAt: 9000 }), isClosed: false, remote: remote({ title: 'Theirs', updatedAt: 3000 }) });
  assert.equal(action.kind, 'pull');
 });
