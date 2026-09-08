import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Window } from 'happy-dom';

import {
  createDefaultIssuesTaxonomy,
  validateIssuesTaxonomy,
} from '../../src/issues/taxonomy.ts';
import {
  DEFAULT_ISSUE_STATUS_ICONS,
  DEFAULT_ISSUE_TYPE_ICONS,
  createIssueStatusChip,
  createIssueTypeChip,
  isIssueTypeIconClass,
  resolveIssueStatusIcon,
  resolveIssueTypeColor,
  resolveIssueTypeIcon,
} from '../../src/issues/type-icons.ts';

describe('issue type icons', () => {
  it('seeds built-in types with default icons', () => {
    const taxonomy = createDefaultIssuesTaxonomy();
    assert.equal(taxonomy.types.find((t) => t.id === 'bug')?.icon, DEFAULT_ISSUE_TYPE_ICONS.bug);
    assert.equal(taxonomy.types.find((t) => t.id === 'task')?.icon, DEFAULT_ISSUE_TYPE_ICONS.task);
    assert.equal(taxonomy.types.find((t) => t.id === 'idea')?.icon, DEFAULT_ISSUE_TYPE_ICONS.idea);
    assert.equal(taxonomy.types.find((t) => t.id === 'note')?.icon, DEFAULT_ISSUE_TYPE_ICONS.note);
    assert.equal(taxonomy.types.find((t) => t.id === 'feature')?.icon, DEFAULT_ISSUE_TYPE_ICONS.feature);
    assert.equal(
      taxonomy.types.find((t) => t.id === 'improvement')?.icon,
      DEFAULT_ISSUE_TYPE_ICONS.improvement,
    );
  });

  it('resolves stored icons and falls back for unknown custom types', () => {
    assert.equal(resolveIssueTypeIcon('bug', { id: 'bug', label: 'Bug', order: 0 }), 'fi-sr-bug');
    assert.equal(
      resolveIssueTypeIcon('spike', {
        id: 'spike',
        label: 'Spike',
        order: 0,
        icon: 'fi-sr-rocket',
      }),
      'fi-sr-rocket',
    );
    assert.equal(
      resolveIssueTypeIcon('spike', { id: 'spike', label: 'Spike', order: 0 }),
      'fi-sr-box',
    );
  });

  it('applies stored and default type colors on chips', () => {
    const win = new Window({ url: 'http://localhost/' });
    globalThis.document = win.document as unknown as Document;
    try {
      const feature = createIssueTypeChip('feature', {
        id: 'feature',
        label: 'Feature',
        order: 4,
      });
      assert.equal(resolveIssueTypeColor('feature'), 'var(--mn-label-fig)');
      assert.equal(feature.style.getPropertyValue('--issues-chip-color'), 'var(--mn-label-fig)');
      const custom = createIssueTypeChip('spike', {
        id: 'spike',
        label: 'Spike',
        order: 0,
        color: 'var(--mn-success)',
      });
      assert.equal(custom.style.getPropertyValue('--issues-chip-color'), 'var(--mn-success)');
    } finally {
      win.close();
    }
  });

  it('rejects icons outside the picker catalog', () => {
    const base = createDefaultIssuesTaxonomy();
    const next = structuredClone(base);
    next.types.push({
      id: 'spike',
      label: 'Spike',
      order: 4,
      icon: 'fi-sr-not-a-real-icon',
    });
    assert.throws(() => validateIssuesTaxonomy(next), /Unknown type icon/);
  });

  it('accepts picker icons on custom types', () => {
    const base = createDefaultIssuesTaxonomy();
    const next = structuredClone(base);
    next.types.push({
      id: 'spike',
      label: 'Spike',
      order: 4,
      icon: 'fi-sr-rocket',
    });
    const validated = validateIssuesTaxonomy(next);
    assert.equal(validated.types.find((t) => t.id === 'spike')?.icon, 'fi-sr-rocket');
    assert.equal(isIssueTypeIconClass('fi-rr-inbox'), true);
    assert.equal(isIssueTypeIconClass('fi-sr-not-a-real-icon'), false);
  });
});

describe('issue status icons', () => {
  it('seeds built-in statuses with default icons', () => {
    const taxonomy = createDefaultIssuesTaxonomy();
    assert.equal(
      taxonomy.statuses.find((s) => s.id === 'triage')?.icon,
      DEFAULT_ISSUE_STATUS_ICONS.triage,
    );
    assert.equal(
      taxonomy.statuses.find((s) => s.id === 'in_progress')?.icon,
      DEFAULT_ISSUE_STATUS_ICONS.in_progress,
    );
    assert.equal(
      taxonomy.statuses.find((s) => s.id === 'done')?.icon,
      DEFAULT_ISSUE_STATUS_ICONS.done,
    );
    assert.equal(
      taxonomy.statuses.find((s) => s.id === 'canceled')?.icon,
      DEFAULT_ISSUE_STATUS_ICONS.canceled,
    );
  });

  it('resolves stored icons and falls back for custom statuses without an icon', () => {
    assert.equal(
      resolveIssueStatusIcon('todo', { id: 'todo', label: 'Todo', order: 0 }),
      'fi-sr-clipboard-list',
    );
    assert.equal(
      resolveIssueStatusIcon('blocked', {
        id: 'blocked',
        label: 'Blocked',
        order: 0,
        icon: 'fi-rr-clock',
      }),
      'fi-rr-clock',
    );
    assert.equal(
      resolveIssueStatusIcon('blocked', { id: 'blocked', label: 'Blocked', order: 0 }),
      'fi-sr-box',
    );
  });

  it('keeps statuses that omit icon (existing taxonomies)', () => {
    const base = createDefaultIssuesTaxonomy();
    const next = structuredClone(base);
    for (const status of next.statuses) delete status.icon;
    const validated = validateIssuesTaxonomy(next);
    const triage = validated.statuses.find((s) => s.id === 'triage');
    assert.equal(triage?.icon, undefined);
    assert.equal(resolveIssueStatusIcon('triage', triage), 'fi-rr-inbox');
  });

  it('rejects status icons outside the picker catalog', () => {
    const base = createDefaultIssuesTaxonomy();
    const next = structuredClone(base);
    next.statuses.push({
      id: 'blocked',
      label: 'Blocked',
      order: 99,
      boardVisible: true,
      icon: 'fi-sr-not-a-real-icon',
    });
    assert.throws(() => validateIssuesTaxonomy(next), /Unknown status icon/);
  });

  it('renders the glyph beside the status label', () => {
    const win = new Window({ url: 'http://localhost/' });
    globalThis.document = win.document as unknown as Document;
    try {
      const chip = createIssueStatusChip('done', { id: 'done', label: 'Done', order: 0 });
      assert.equal(chip.className.includes('issues-status-chip--done'), true);
      assert.ok(chip.querySelector('.issues-status-chip__icon'));
      assert.equal(chip.querySelector('.issues-status-chip__label')?.textContent, 'Done');
      assert.equal(chip.textContent?.includes('Done'), true);
    } finally {
      win.close();
    }
  });
});
