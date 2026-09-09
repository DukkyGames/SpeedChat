import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Window } from 'happy-dom';

const dom = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLLabelElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'HTMLParagraphElement', 'Node', 'NodeFilter', 'Element', 'SVGElement', 'AbortController', 'AbortSignal'] as const) {
  (globalThis as Record<string, unknown>)[name] = name === 'window' ? dom : dom[name];
}
globalThis.getComputedStyle = dom.getComputedStyle.bind(dom) as typeof getComputedStyle;
document.body.innerHTML = '<main id="issuesView"></main><div id="sDot"></div><div id="sText"></div>';
const { initIssuesPage } = await import('../../src/ui/issues-page.ts');
const { setExpandIssueFetcherForTests } = await import('../../src/ui/issues-expand.ts');
const store = await import('../../src/state/issues-store.ts');
const config = await import('../../src/tools/config.ts');
config.setLocalServerAvailableForTests(false);
store.setIssuesStateForTests({ version: 2, schemaRevision: 3, nextId: 1, issues: [] });
initIssuesPage();
const originalFetch = globalThis.fetch;
after(() => {
  setExpandIssueFetcherForTests(null);
  config.setLocalServerAvailableForTests(false);
  store.setIssuesStateForTests(null);
  globalThis.fetch = originalFetch;
  dom.close();
});

const click = (id: string) => (document.getElementById(id) as HTMLElement).click();
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const form = () => document.getElementById('issuesNewForm') as HTMLFormElement;
const body = () => document.querySelector('#issuesNewDescriptionHost .mn-editor__body') as HTMLElement;
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), 'UI operation completed');
}
function dropImage(): void {
  const event = new dom.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [{ name: 'screen.png', type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }] } });
  body().dispatchEvent(event as unknown as Event);
}

test('new issue form expands entered fields without saving, then creates one issue with uploaded images', async () => {
  click('btnIssuesNew');
  input('issuesNewTitle').value = 'Login fails';
  input('issuesNewPriority').value = 'high';
  input('issuesNewType').value = 'bug';
  body().querySelector('p')!.textContent = 'Clicking login shows this error.';
  config.setLocalServerAvailableForTests(true);
  globalThis.fetch = (async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ attachment: { key: `${request.issueId}/screen.png`, name: 'screen.png', path: `/attachments/${request.issueId}/screen.png`, mime: 'image/png', bytes: 3 } }));
  }) as typeof fetch;
  dropImage();
  let seen = false;
  setExpandIssueFetcherForTests(async ({ issue }) => {
    assert.equal(issue.title, 'Login fails');
    assert.equal(issue.type, 'bug');
    assert.equal(issue.priority, 'high');
    assert.match(issue.description!, /screen.png/);
    seen = true;
    // Even a model that omits the image must not remove the draft's visual context.
    return { draft: { title: 'Fix login failure', description: 'Reproduce and fix the error.', labels: ['login'], priority: 'high' } };
  });
  click('issuesNewExpand');
  await until(() => input('issuesNewTitle').value === 'Fix login failure');
  assert.ok(seen);
  assert.equal(store.listIssues().length, 0);
  assert.ok(form().classList.contains('is-open'));
  form().dispatchEvent(new dom.Event('submit', { cancelable: true }) as unknown as Event);
  form().dispatchEvent(new dom.Event('submit', { cancelable: true }) as unknown as Event);
  await until(() => !form().classList.contains('is-open'));
  const issues = store.listIssues();
  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, 'Fix login failure');
  assert.deepEqual(issues[0].labels, ['login']);
  assert.equal(issues[0].attachments?.length, 1);
  assert.match(issues[0].description, /screen.png/);
});

test('cancel and reopen invalidates an upload-waiting submit', async () => {
  click('btnIssuesNew');
  input('issuesNewTitle').value = 'Cancelled draft';
  let finish!: (response: Response) => void;
  let request: { issueId: string } | undefined;
  globalThis.fetch = (async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Promise<Response>((resolve) => { finish = resolve; });
  }) as typeof fetch;
  dropImage();
  await until(() => Boolean(request));
  form().dispatchEvent(new dom.Event('submit', { cancelable: true }) as unknown as Event);
  click('btnIssuesNewCancel');
  click('btnIssuesNew');
  input('issuesNewTitle').value = 'A different draft';
  finish(new Response(JSON.stringify({ attachment: { key: `${request!.issueId}/screen.png`, name: 'screen.png', path: `/attachments/${request!.issueId}/screen.png`, mime: 'image/png', bytes: 3 } })));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(store.listIssues().length, 1);
  assert.equal(input('issuesNewTitle').value, 'A different draft');
  assert.ok(form().classList.contains('is-open'));
  click('btnIssuesNewCancel');
});

test('cancelling expansion cannot overwrite a reopened draft', async () => {
  click('btnIssuesNew');
  input('issuesNewTitle').value = 'Expand then cancel';
  let finish!: (value: { draft: { title: string; description: string } }) => void;
  setExpandIssueFetcherForTests(async () => new Promise((resolve) => { finish = resolve; }));
  click('issuesNewExpand');
  await until(() => Boolean(finish));
  click('btnIssuesNewCancel');
  click('btnIssuesNew');
  input('issuesNewTitle').value = 'Fresh draft';
  finish({ draft: { title: 'Old suggestion', description: 'Old suggestion' } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(input('issuesNewTitle').value, 'Fresh draft');
  assert.equal(store.listIssues().length, 1);
  click('btnIssuesNewCancel');
});
