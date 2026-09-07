import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ShellWindowRegistry } from '../../electron/shell-window-registry.ts';
import { normalizeWorkspacePathKey } from '../../server/workspace/root.js';

function makeRegistry() {
  return new ShellWindowRegistry({ normalizeKey: normalizeWorkspacePathKey });
}

describe('ShellWindowRegistry app windows', () => {
  test('findByWorkspace ignores app windows on the same folder', () => {
    const registry = makeRegistry();
    const repo = path.resolve('/tmp/repo-a');
    registry.register(1, repo, 'view-1');
    registry.register(2, repo, 'view-2', 'issues');

    assert.equal(registry.findByWorkspace(repo)?.windowId, 1);
    assert.equal(registry.findAppWindow('issues')?.windowId, 2);
    assert.equal(registry.get(2)?.appId, 'issues');
  });

  test('unregister clears the app window lookup', () => {
    const registry = makeRegistry();
    const repo = path.resolve('/tmp/repo-a');
    registry.register(1, repo, 'view-1');
    registry.register(2, repo, 'view-2', 'issues');

    assert.equal(registry.unregister(2)?.appId, 'issues');
    assert.equal(registry.findAppWindow('issues'), undefined);
    assert.equal(registry.findByWorkspace(repo)?.windowId, 1);
  });

  test('isWindowOnWorkspace is false for app windows', () => {
    const registry = makeRegistry();
    const repo = path.resolve('/tmp/repo-a');
    registry.register(2, repo, 'view-2', 'research');
    assert.equal(registry.isWindowOnWorkspace(2, repo), false);
  });
});
