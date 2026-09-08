/**
 * Peek GitHub row copy: last-sync time, or Needs push when the card moved locally.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { githubSyncCaption } from '../../src/issues/github-sync-status.ts';
import type { IssueCard, IssueGithubLink } from '../../src/types.ts';

const SYNCED_AT = 1_700_000_000_000;

function issue(partial: Partial<IssueCard> = {}): IssueCard {
  return {
    id: 'MIN-1',
    type: 'task',
    title: 'Local title',
    description: 'Local body',
    status: 'todo',
    priority: 'none',
    labels: [],
    workspacePath: '/w',
    createdAt: 0,
    updatedAt: SYNCED_AT,
    ...partial,
  } as IssueCard;
}

function link(partial: Partial<IssueGithubLink> = {}): IssueGithubLink {
  return {
    number: 5,
    url: 'https://github.com/o/r/issues/5',
    syncedAt: SYNCED_AT,
    localUpdatedAt: SYNCED_AT,
    ...partial,
  };
}

describe('githubSyncCaption', () => {
  test('is empty when the card is not linked', () => {
    assert.equal(githubSyncCaption(issue()), '');
  });

  test('uses relative time when the card has not moved since the watermark', () => {
    const now = SYNCED_AT + 2 * 60 * 60 * 1000;
    assert.equal(githubSyncCaption(issue({ github: link() }), now), 'synced 2h ago');
  });

  test('is Needs push when local updatedAt is after the watermark', () => {
    assert.equal(
      githubSyncCaption(issue({ github: link(), updatedAt: SYNCED_AT + 10 }), SYNCED_AT + 20),
      'Needs push',
    );
  });

  test('is Needs push when localDirty is set, even if updatedAt matches the watermark', () => {
    assert.equal(
      githubSyncCaption(issue({ github: link({ localDirty: true }) }), SYNCED_AT + 20),
      'Needs push',
    );
  });

  test('is synced when localDirty is false even if updatedAt moved (rank/assignee/notes)', () => {
    const now = SYNCED_AT + 2 * 60 * 60 * 1000;
    assert.equal(
      githubSyncCaption(
        issue({ github: link({ localDirty: false }), updatedAt: SYNCED_AT + 10 }),
        now,
      ),
      'synced 2h ago',
    );
  });
});
