import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { withIssueToolImages } from '../../src/tools/issue-tool-images.ts';
import { addIssue, addIssueAttachment, setIssuesStateForTests } from '../../src/state/issues-store.ts';
import { executeIssueV2Tool } from '../../src/tools/issue-tools-v2.ts';
import { issueAttachmentUrl } from '../../src/state/issue-attachments-api.ts';
import { toolImageFollowUpFromAttachments } from '../../src/chat/tool-image-follow-up.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; setIssuesStateForTests(null); });

test('image filenames with parentheses remain valid Markdown destinations', () => {
  assert.equal(issueAttachmentUrl({ path: 'C:/attachments/ISS-1/screen (1).png' }), '/api/issues/attachments?key=ISS-1%2Fscreen%20%281%29.png');
});

test('description reads include stored attachment pixels on the tool result', async () => {
  setIssuesStateForTests({ version: 2, schemaRevision: 3, nextId: 1, issues: [] });
  const issue = addIssue({ title: 'Screenshot', description: '![error](/api/issues/attachments?key=ISS-1%2Ferror.jpg)' });
  addIssueAttachment(issue.id, { name: 'error.jpg', path: `C:/home/issues/attachments/${issue.id}/error.jpg`, mime: 'image/jpeg', bytes: 3 });
  const calls: string[] = [];
  globalThis.fetch = (async (url) => {
    calls.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;
  const text = await executeIssueV2Tool('issue_search', { scope: 'all', query: issue.id, fields: ['description'] });
  const result = await withIssueToolImages(text);
  assert.equal(result.attachments?.[0].dataUrl, 'data:image/jpeg;base64,AQID');
  assert.equal(result.attachments?.[0].mime, 'image/jpeg');
  const followUp = toolImageFollowUpFromAttachments(result.attachments);
  assert.equal(followUp?.role, 'user');
  assert.deepEqual(Array.isArray(followUp?.content) && followUp.content[1], {
    type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID', detail: 'auto' },
  });
  assert.deepEqual(calls, [`/api/issues/attachments?key=${issue.id}%2Ferror.jpg`]);
});

test('remote Markdown URLs are never fetched and compact searches remain text only', async () => {
  globalThis.fetch = (async () => { throw new Error('Unexpected fetch'); }) as typeof fetch;
  const text = JSON.stringify({ issues: [{ description: '![remote](https://example.com/private.png)' }] });
  assert.deepEqual(await withIssueToolImages(text), { content: text });
});

test('missing images preserve the issue text and report unavailable visual context', async () => {
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
  const result = await withIssueToolImages(JSON.stringify({ issues: [{ attachments: [{ name: 'x.png', path: '/attachments/ISS-1/x.png' }] }] }));
  assert.equal(result.attachments, undefined);
  assert.match(result.content, /1 issue image\(s\) could not be included/);
});
