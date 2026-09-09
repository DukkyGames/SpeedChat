/**
 * Issues Code-sidebar embed: reparents #issuesView into #chatArea and restores it.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setIssuesStateForTests } = await import('../../src/state/issues-store.ts');
const { createEmptyChatObject, setSessionStateForTests } = await import(
  '../../src/state/sessions.ts'
);
const {
  closeIssuesEmbeddedInCode,
  isIssuesEmbeddedInCode,
  openIssuesEmbeddedInCode,
  setIssuesRouteHash,
  shouldEmbedIssuesFromCodeSidebar,
  teardownIssuesEmbedBeforeChatPaint,
} = await import('../../src/ui/issues-page.ts');
const { isMainColumnOverlaySuppressingChatDom } = await import(
  '../../src/ui/main-column-overlay.ts'
);
const { launchInstance, resetInstancesForTests, showDesktop } = await import(
  '../../src/os/instances.ts'
);

let domWindow: Window | null = null;

function setupDom(): void {
  const window = new Window();
  domWindow = window;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLSelectElement = window.HTMLSelectElement;
  globalThis.Node = window.Node;
  globalThis.SVGElement = window.SVGElement;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);

  document.body.innerHTML = `
    <div id="osAppsLayer">
      <main id="issuesView" class="issues-page" aria-label="Issues"></main>
    </div>
    <div id="mainColumn">
      <div id="chatArea"><p id="chatPlaceholder">chat</p></div>
    </div>
    <button type="button" id="btnAllBugs" aria-label="Issues"></button>
  `;
}

afterEach(() => {
  teardownIssuesEmbedBeforeChatPaint();
  setIssuesStateForTests({ version: 2, nextId: 1, issues: [], workspaces: {} });
  setSessionStateForTests(null);
  resetInstancesForTests();
  domWindow?.close();
  domWindow = null;
});

describe('issues embed in Code', () => {
  test('openIssuesEmbeddedInCode reparents #issuesView into #chatArea', async () => {
    setupDom();
    setIssuesStateForTests({ version: 2, nextId: 1, issues: [], workspaces: {} });
    const chat = createEmptyChatObject('test-model');
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      chats: [chat],
      sidebarCollapsed: false,
    });

    const appsLayer = document.getElementById('osAppsLayer');
    const chatArea = document.getElementById('chatArea');
    const issuesView = document.getElementById('issuesView');
    assert.ok(appsLayer && chatArea && issuesView);
    assert.equal(issuesView.parentElement, appsLayer);

    await openIssuesEmbeddedInCode();

    assert.equal(isIssuesEmbeddedInCode(), true);
    assert.equal(issuesView.parentElement, chatArea);
    assert.ok(issuesView.classList.contains('is-open'));
    assert.ok(issuesView.classList.contains('issues-page--embedded'));
    assert.ok(chatArea.classList.contains('chat-area--issues'));
    assert.ok(document.getElementById('mainColumn')?.classList.contains('main-column--issues'));
    assert.ok(document.getElementById('btnIssuesEmbedBack'));
    assert.equal(isMainColumnOverlaySuppressingChatDom(), true);
    assert.equal(document.getElementById('chatPlaceholder'), null);
  });

  test('closeIssuesEmbeddedInCode restores #issuesView to the apps layer', async () => {
    setupDom();
    setIssuesStateForTests({ version: 2, nextId: 1, issues: [], workspaces: {} });
    const chat = createEmptyChatObject('test-model');
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      chats: [chat],
      sidebarCollapsed: false,
    });

    await openIssuesEmbeddedInCode();
    closeIssuesEmbeddedInCode({ restoreChat: false });

    const appsLayer = document.getElementById('osAppsLayer');
    const issuesView = document.getElementById('issuesView');
    assert.ok(appsLayer && issuesView);
    assert.equal(isIssuesEmbeddedInCode(), false);
    assert.equal(issuesView.parentElement, appsLayer);
    assert.equal(issuesView.classList.contains('issues-page--embedded'), false);
    assert.equal(document.getElementById('btnIssuesEmbedBack'), null);
    assert.equal(document.getElementById('chatArea')?.classList.contains('chat-area--issues'), false);
  });

  test('shouldEmbedIssuesFromCodeSidebar is true only when Code is foreground', () => {
    setupDom();
    resetInstancesForTests();
    showDesktop();
    assert.equal(shouldEmbedIssuesFromCodeSidebar(), false);

    launchInstance('code');
    assert.equal(shouldEmbedIssuesFromCodeSidebar(), true);
  });

  test('setIssuesRouteHash is a no-op while Issues is embedded in Code', async () => {
    setupDom();
    setIssuesStateForTests({ version: 2, nextId: 1, issues: [], workspaces: {} });
    const chat = createEmptyChatObject('test-model');
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      chats: [chat],
      sidebarCollapsed: false,
    });
    window.location.hash = '#/app/code/chat';

    await openIssuesEmbeddedInCode();
    setIssuesRouteHash('#/app/issues/ISS-1');

    assert.equal(window.location.hash, '#/app/code/chat');
    assert.equal(isIssuesEmbeddedInCode(), true);
  });
});
