/**
 * Legacy settings area slugs must resolve to visible panels (agent-center, etc.).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { resolveSettingsSectionNavigation } = await import(
  '../../src/ui/settings-section-navigation.ts'
);

describe('resolveSettingsSectionNavigation', () => {
  test('maps sub-agents to agent-center with a scroll target', () => {
    assert.deepEqual(resolveSettingsSectionNavigation('sub-agents'), {
      sectionId: 'agent-center',
      searchKey: 'agents.subAgents',
    });
  });

  test('maps modes to agent-center Super Plan settings', () => {
    assert.deepEqual(resolveSettingsSectionNavigation('modes'), {
      sectionId: 'agent-center',
      searchKey: 'modes.super-plan',
    });
  });

  test('preserves an explicit search key over legacy defaults', () => {
    assert.deepEqual(
      resolveSettingsSectionNavigation('sub-agents', 'agents.subAgents.limits'),
      {
        sectionId: 'agent-center',
        searchKey: 'agents.subAgents.limits',
      },
    );
  });

  test('leaves current sections unchanged', () => {
    assert.deepEqual(resolveSettingsSectionNavigation('diagnostics'), {
      sectionId: 'diagnostics',
      searchKey: undefined,
    });
  });
});
