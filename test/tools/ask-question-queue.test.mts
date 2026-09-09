/**
 * Per-chat ask_question queue: chat B drains while chat A is still unanswered.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  installHappyDomGlobals,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

/** @type {import('happy-dom').Window | undefined} */
let win: import('happy-dom').Window | undefined;

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="mainColumn" class="main-column">
      <div id="chatArea" class="chat-area"></div>
      <div id="questionHost" class="question-host" hidden></div>
      <textarea id="msgInput"></textarea>
      <button id="sendBtn"></button>
    </div>
  `;
}

describe('enqueueAskQuestion per-chat drain', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    installHappyDomGlobals(win);
    setupDom(win);
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();

    const chatA = createEmptyChatObject('');
    chatA.id = 'chat-a';
    const chatB = createEmptyChatObject('');
    chatB.id = 'chat-b';
    setSessionStateForTests({
      version: 5,
      activeId: 'chat-a',
      sidebarCollapsed: false,
      chats: [chatA, chatB],
    });
    launchInstance('code');
  });

  afterEach(async () => {
    const { resetQuestionCardsModalForTests } = await import(
      '../../src/ui/question-cards-modal.ts'
    );
    resetQuestionCardsModalForTests();
    const { resetAskQuestionQueueForTests } = await import(
      '../../src/tools/ask-question-queue.ts'
    );
    resetAskQuestionQueueForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    setSessionStateForTests(null);
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('chat B modal starts without waiting for chat A to answer', async () => {
    const { enqueueAskQuestion } = await import('../../src/tools/ask-question-queue.ts');
    const { isAskQuestionModalOpenForChat, forceCloseAskQuestionModalForChat } = await import(
      '../../src/ui/question-cards-modal.ts'
    );

    const pA = enqueueAskQuestion(
      {
        questions: [
          {
            id: 'qa1',
            prompt: 'Queue A prompt',
            options: [
              { id: 'a', label: 'Alpha' },
              { id: 'b', label: 'Beta' },
            ],
          },
        ],
      },
      {},
      'chat-a',
    );
    const pB = enqueueAskQuestion(
      {
        questions: [
          {
            id: 'qb1',
            prompt: 'Queue B prompt',
            options: [
              { id: 'x', label: 'X-ray' },
              { id: 'y', label: 'Yankee' },
            ],
          },
        ],
      },
      {},
      'chat-b',
    );

    await Promise.resolve();
    assert.equal(isAskQuestionModalOpenForChat('chat-a'), true);
    assert.equal(isAskQuestionModalOpenForChat('chat-b'), true);
    const host = document.getElementById('questionHost');
    assert.match(host?.textContent ?? '', /Queue A prompt/);
    assert.doesNotMatch(host?.textContent ?? '', /Queue B prompt/);

    forceCloseAskQuestionModalForChat('chat-a');
    forceCloseAskQuestionModalForChat('chat-b');
    await Promise.all([pA, pB]);
  });

  test('snapshots chatId at enqueue, not at drain', async () => {
    const { enqueueAskQuestion } = await import('../../src/tools/ask-question-queue.ts');
    const { isAskQuestionModalOpenForChat, forceCloseAskQuestionModalForChat } = await import(
      '../../src/ui/question-cards-modal.ts'
    );
    const { sessionState } = await import('../../src/state/sessions.ts');

    const p = enqueueAskQuestion({
      questions: [
        {
          id: 'qa1',
          prompt: 'Owned by A',
          options: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ],
        },
      ],
    });
    if (sessionState) sessionState.activeId = 'chat-b';
    await Promise.resolve();
    assert.equal(isAskQuestionModalOpenForChat('chat-a'), true);
    assert.equal(isAskQuestionModalOpenForChat('chat-b'), false);
    forceCloseAskQuestionModalForChat('chat-a');
    await p;
  });
});
