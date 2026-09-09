/**
 * Start-from / check-out ref helpers for New branch and Add worktree.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  displayRemoteRef,
  isCheckoutUnavailable,
  isSkippedRemoteRef,
  pickDefaultStartPoint,
  shortLocalNameFromRemote,
} from '../../src/lib/git-ref-start.mjs';

describe('displayRemoteRef', () => {
  test('strips remotes/ so origin/main is a usable git name', () => {
    assert.equal(displayRemoteRef('remotes/origin/main'), 'origin/main');
    assert.equal(displayRemoteRef('origin/main'), 'origin/main');
  });
});

describe('isSkippedRemoteRef', () => {
  test('skips symbolic remote HEAD lines', () => {
    assert.equal(isSkippedRemoteRef('remotes/origin/HEAD -> origin/main'), true);
    assert.equal(isSkippedRemoteRef('origin/HEAD'), true);
    assert.equal(isSkippedRemoteRef('remotes/origin/main'), false);
  });
});

describe('shortLocalNameFromRemote', () => {
  test('drops the remote name', () => {
    assert.equal(shortLocalNameFromRemote('origin/feature-x'), 'feature-x');
    assert.equal(shortLocalNameFromRemote('remotes/origin/feature-x'), 'feature-x');
  });
});

describe('pickDefaultStartPoint', () => {
  test('prefers the currently checked-out branch', () => {
    assert.equal(
      pickDefaultStartPoint({
        current: 'feature/open',
        local: ['main', 'feature/open'],
        remote: ['remotes/origin/main'],
      }),
      'feature/open',
    );
  });

  test('falls back to trunk then first local', () => {
    assert.equal(
      pickDefaultStartPoint({
        current: 'HEAD',
        local: ['topic', 'main'],
      }),
      'main',
    );
  });

  test('checkout mode skips the current branch and locked locals', () => {
    assert.equal(
      pickDefaultStartPoint(
        {
          current: 'feature/open',
          local: ['main', 'feature/open'],
          lockedLocal: ['locked'],
        },
        { forCheckout: true },
      ),
      'main',
    );
  });
});

describe('isCheckoutUnavailable', () => {
  test('blocks the current branch and locked locals', () => {
    const lists = {
      current: 'main',
      local: ['main', 'topic'],
      lockedLocal: ['elsewhere'],
      remote: ['remotes/origin/elsewhere'],
    };
    assert.equal(isCheckoutUnavailable('main', lists), true);
    assert.equal(isCheckoutUnavailable('elsewhere', lists), true);
    assert.equal(isCheckoutUnavailable('origin/elsewhere', lists), true);
    assert.equal(isCheckoutUnavailable('topic', lists), false);
  });
});
