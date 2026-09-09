import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  canonicalIssueAttachmentSrc,
  displayIssueAttachmentSrc,
  issueAttachmentDisplayUrl,
  issueAttachmentUrl,
} from '../../src/state/issue-attachments-api.ts';

const globalAny = globalThis as { window?: { __MINNOW_SESSION_TOKEN__?: string } };

afterEach(() => {
  delete globalAny.window;
});

test('issueAttachmentDisplayUrl appends the session token for img src', () => {
  globalAny.window = { __MINNOW_SESSION_TOKEN__: 'test-session-token' };
  const url = issueAttachmentDisplayUrl({ path: 'C:/home/issues/attachments/MIN-1/screen.png' });
  assert.equal(
    url,
    '/api/issues/attachments?key=MIN-1%2Fscreen.png&token=test-session-token',
  );
});

test('displayIssueAttachmentSrc canonicalizes before adding auth params', () => {
  globalAny.window = { __MINNOW_SESSION_TOKEN__: 'fresh-token' };
  const src = displayIssueAttachmentSrc(
    '/api/issues/attachments?key=MIN-1%2Fscreen.png&token=stale-token',
  );
  assert.equal(
    src,
    '/api/issues/attachments?key=MIN-1%2Fscreen.png&token=fresh-token',
  );
});

test('canonicalIssueAttachmentSrc removes auth params from stored URLs', () => {
  assert.equal(
    canonicalIssueAttachmentSrc(
      '/api/issues/attachments?key=MIN-1%2Fscreen.png&token=test-session-token&workspace=%2Frepo',
    ),
    issueAttachmentUrl({ path: 'C:/home/issues/attachments/MIN-1/screen.png' }),
  );
});
