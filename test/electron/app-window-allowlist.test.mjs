import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  appWindowDenialReason,
  isAppWindowAllowed,
} from '../../electron/app-window-allowlist.ts';

describe('isAppWindowAllowed', () => {
  test('allows released apps except Code', () => {
    assert.equal(isAppWindowAllowed('issues'), true);
    assert.equal(isAppWindowAllowed('research'), true);
    assert.equal(isAppWindowAllowed('settings'), true);
    assert.equal(isAppWindowAllowed('code'), false);
    assert.equal(isAppWindowAllowed('experts'), false);
    assert.equal(isAppWindowAllowed(''), false);
    assert.equal(isAppWindowAllowed(null), false);
  });

  test('denial reasons name the problem', () => {
    assert.equal(appWindowDenialReason('code'), 'Code cannot open in a separate window');
    assert.match(appWindowDenialReason('experts'), /Unknown or hidden/);
    assert.equal(appWindowDenialReason(''), 'appId is required');
  });
});
