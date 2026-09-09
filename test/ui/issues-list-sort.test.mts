/**
 * Issues list column sort: defaults, toggle, and compare order.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ariaSortValue,
  cycleIssuesListSort,
  defaultDirectionForSortKey,
  DEFAULT_ISSUES_LIST_SORT,
  sortIssuesForList,
  type IssuesListSort,
} from '../../src/ui/issues-list-sort.ts';
import { createDefaultIssuesTaxonomy } from '../../src/issues/taxonomy.ts';
import type { IssueCard } from '../../src/types.ts';

function makeIssue(partial: Partial<IssueCard> & Pick<IssueCard, 'id' | 'title'>): IssueCard {
  return {
    type: 'task',
    description: '',
    status: 'todo',
    priority: 'none',
    labels: [],
    workspacePath: '/w',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...partial,
  };
}

describe('issues-list-sort', () => {
  test('default sort is created descending', () => {
    assert.deepEqual(DEFAULT_ISSUES_LIST_SORT, { key: 'created', direction: 'desc' });
  });

  test('defaultDirectionForSortKey prefers newest / highest for time and priority', () => {
    assert.equal(defaultDirectionForSortKey('created'), 'desc');
    assert.equal(defaultDirectionForSortKey('priority'), 'desc');
    assert.equal(defaultDirectionForSortKey('title'), 'asc');
    assert.equal(defaultDirectionForSortKey('id'), 'asc');
  });

  test('cycleIssuesListSort toggles same column and resets direction on new column', () => {
    const current: IssuesListSort = { key: 'title', direction: 'asc' };
    assert.deepEqual(cycleIssuesListSort(current, 'title'), {
      key: 'title',
      direction: 'desc',
    });
    assert.deepEqual(cycleIssuesListSort(current, 'priority'), {
      key: 'priority',
      direction: 'desc',
    });
  });

  test('sortIssuesForList sorts by title ascending then toggles to descending', () => {
    const issues = [
      makeIssue({ id: 'ISS-1', title: 'Charlie', updatedAt: 3 }),
      makeIssue({ id: 'ISS-2', title: 'alpha', updatedAt: 2 }),
      makeIssue({ id: 'ISS-3', title: 'Bravo', updatedAt: 1 }),
    ];
    const asc = sortIssuesForList(issues, { key: 'title', direction: 'asc' });
    assert.deepEqual(
      asc.map((row) => row.id),
      ['ISS-2', 'ISS-3', 'ISS-1'],
    );
    const desc = sortIssuesForList(issues, { key: 'title', direction: 'desc' });
    assert.deepEqual(
      desc.map((row) => row.id),
      ['ISS-1', 'ISS-3', 'ISS-2'],
    );
  });

  test('sortIssuesForList sorts priority urgent-first when descending', () => {
    const issues = [
      makeIssue({ id: 'ISS-1', title: 'a', priority: 'low' }),
      makeIssue({ id: 'ISS-2', title: 'b', priority: 'urgent' }),
      makeIssue({ id: 'ISS-3', title: 'c', priority: 'medium' }),
    ];
    const sorted = sortIssuesForList(issues, { key: 'priority', direction: 'desc' });
    assert.deepEqual(
      sorted.map((row) => row.id),
      ['ISS-2', 'ISS-3', 'ISS-1'],
    );
  });

  test('sortIssuesForList sorts numeric issue ids across prefixes', () => {
    const issues = [
      makeIssue({ id: 'MIN-10', title: 'ten' }),
      makeIssue({ id: 'MIN-2', title: 'two' }),
      makeIssue({ id: 'MIN-1', title: 'one' }),
      makeIssue({ id: 'ISS-9', title: 'legacy' }),
    ];
    const sorted = sortIssuesForList(issues, { key: 'id', direction: 'asc' });
    assert.deepEqual(
      sorted.map((row) => row.id),
      ['ISS-9', 'MIN-1', 'MIN-2', 'MIN-10'],
    );
  });

  test('sortIssuesForList sorts numeric issue ids (ISS)', () => {
    const issues = [
      makeIssue({ id: 'ISS-10', title: 'ten' }),
      makeIssue({ id: 'ISS-2', title: 'two' }),
      makeIssue({ id: 'ISS-1', title: 'one' }),
    ];
    const sorted = sortIssuesForList(issues, { key: 'id', direction: 'asc' });
    assert.deepEqual(
      sorted.map((row) => row.id),
      ['ISS-1', 'ISS-2', 'ISS-10'],
    );
  });

  test('sortIssuesForList sorts status by workflow order', () => {
    const issues = [
      makeIssue({ id: 'ISS-1', title: 'a', status: 'done' }),
      makeIssue({ id: 'ISS-2', title: 'b', status: 'triage' }),
      makeIssue({ id: 'ISS-3', title: 'c', status: 'in_progress' }),
    ];
    const sorted = sortIssuesForList(issues, { key: 'status', direction: 'asc' });
    assert.deepEqual(
      sorted.map((row) => row.id),
      ['ISS-2', 'ISS-3', 'ISS-1'],
    );
  });

  test('user-created taxonomy ids sort by catalog order, not NaN', () => {
    // The rank tables used to be keyed on the seed ids, so anything added in
    // Settings compared as NaN and the column silently scrambled.
    const taxonomy = createDefaultIssuesTaxonomy();
    taxonomy.statuses.push({ id: 'blocked', label: 'Blocked', order: 2.5 });
    taxonomy.priorities.push({ id: 'critical', label: 'Critical', order: -1 });
    taxonomy.types.push({ id: 'chore', label: 'Chore', order: 0.5 });

    const byStatus = sortIssuesForList(
      [
        makeIssue({ id: 'ISS-1', title: 'a', status: 'review' }),
        makeIssue({ id: 'ISS-2', title: 'b', status: 'blocked' }),
        makeIssue({ id: 'ISS-3', title: 'c', status: 'triage' }),
      ],
      { key: 'status', direction: 'asc' },
      taxonomy,
    );
    assert.deepEqual(
      byStatus.map((row) => row.id),
      ['ISS-3', 'ISS-2', 'ISS-1'],
      'a custom status lands at its configured position',
    );

    const byPriority = sortIssuesForList(
      [
        makeIssue({ id: 'ISS-1', title: 'a', priority: 'high' }),
        makeIssue({ id: 'ISS-2', title: 'b', priority: 'critical' }),
        makeIssue({ id: 'ISS-3', title: 'c', priority: 'low' }),
      ],
      { key: 'priority', direction: 'desc' },
      taxonomy,
    );
    assert.deepEqual(
      byPriority.map((row) => row.id),
      ['ISS-2', 'ISS-1', 'ISS-3'],
      'a custom priority above urgent sorts first when descending',
    );

    const byType = sortIssuesForList(
      [
        makeIssue({ id: 'ISS-1', title: 'a', type: 'task' }),
        makeIssue({ id: 'ISS-2', title: 'b', type: 'chore' }),
        makeIssue({ id: 'ISS-3', title: 'c', type: 'bug' }),
      ],
      { key: 'type', direction: 'asc' },
      taxonomy,
    );
    assert.deepEqual(byType.map((row) => row.id), ['ISS-3', 'ISS-2', 'ISS-1']);
  });

  test('an id the catalog no longer has sorts last instead of into the middle', () => {
    const taxonomy = createDefaultIssuesTaxonomy();
    const sorted = sortIssuesForList(
      [
        makeIssue({ id: 'ISS-1', title: 'a', status: 'retired_status' }),
        makeIssue({ id: 'ISS-2', title: 'b', status: 'done' }),
        makeIssue({ id: 'ISS-3', title: 'c', status: 'triage' }),
      ],
      { key: 'status', direction: 'asc' },
      taxonomy,
    );
    assert.deepEqual(sorted.map((row) => row.id), ['ISS-3', 'ISS-2', 'ISS-1']);
  });

  test('omitting the taxonomy keeps the seed workflow order', () => {
    const withSeed = sortIssuesForList(
      [
        makeIssue({ id: 'ISS-1', title: 'a', priority: 'low' }),
        makeIssue({ id: 'ISS-2', title: 'b', priority: 'urgent' }),
      ],
      { key: 'priority', direction: 'desc' },
    );
    assert.deepEqual(withSeed.map((row) => row.id), ['ISS-2', 'ISS-1']);
  });

  test('ariaSortValue marks only the active column', () => {
    const sort: IssuesListSort = { key: 'created', direction: 'desc' };
    assert.equal(ariaSortValue(sort, 'created'), 'descending');
    assert.equal(ariaSortValue(sort, 'title'), 'none');
  });
});


test('creation sort ignores later edits', () => {
  const rows = [
    makeIssue({ id: 'ISS-1', title: 'Old edited', createdAt: 10, updatedAt: 900 }),
    makeIssue({ id: 'ISS-2', title: 'New', createdAt: 20, updatedAt: 20 }),
  ];
  assert.deepEqual(sortIssuesForList(rows, DEFAULT_ISSUES_LIST_SORT).map((row) => row.id), ['ISS-2', 'ISS-1']);
});
