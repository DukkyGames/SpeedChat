import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { setChatAbort } from '../../src/app-state.ts';
import { stopGeneration } from '../../src/chat/stop-generation.ts';
import {
  emitMainTurnActivity,
  getMainTurnActivity,
  listMainTurnActivity,
  resetMainTurnActivity,
} from '../../src/chat/main-turn-activity.ts';
import { isChatStreaming } from '../../src/chat/streaming-state.ts';
import { buildAgentActivitySnapshot } from '../../src/state/agent-activity-registry.ts';
import {
  findChatById,
  setSessionStateForTests,
  createEmptyChatObject,
} from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';

function seedActiveChat(): void {
  const chat = createEmptyChatObject('m1');
  chat.id = FIXED_CHAT_ID;
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
}

describe('stopGeneration', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.performance = window.performance;
  });

  afterEach(() => {
    setSessionStateForTests(null);
    setChatAbort(FIXED_CHAT_ID, null);
    resetMainTurnActivity();
  });

  test('calls abort() when chat abort controller is set', () => {
    seedActiveChat();
    let aborted = false;
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    setChatAbort('11111111-1111-1111-1111-111111111111', controller);
    stopGeneration();
    assert.equal(aborted, true);
  });

  test('no-op when chatFetchAbort is null', () => {
    seedActiveChat();
    setChatAbort('11111111-1111-1111-1111-111111111111', null);
    assert.doesNotThrow(() => stopGeneration());
  });

  test('clears a stuck generation id when no local turn is abortable', () => {
    seedActiveChat();
    const chat = findChatById(FIXED_CHAT_ID)!;
    chat.currentGenerationId = 'gen-stuck';
    emitMainTurnActivity({
      chatId: FIXED_CHAT_ID,
      phase: 'generating',
      currentTool: null,
      workAgentLabel: 'Main turn',
      modelId: 'm1',
      providerId: 'p1',
      startedAtMs: Date.now(),
    });
    setChatAbort(FIXED_CHAT_ID, null);

    stopGeneration(FIXED_CHAT_ID);

    assert.equal(chat.currentGenerationId, undefined);
    assert.equal(getMainTurnActivity(FIXED_CHAT_ID), undefined);
    assert.equal(isChatStreaming(FIXED_CHAT_ID), false);
    assert.equal(
      buildAgentActivitySnapshot({
        nowMs: Date.now(),
        chats: [chat],
        mainTurns: listMainTurnActivity(),
        subAgents: [],
        titleJobs: [],
      }).length,
      0,
    );
  });

  test('leaves teardown to the live turn when an abort controller exists', () => {
    seedActiveChat();
    const chat = findChatById(FIXED_CHAT_ID)!;
    chat.currentGenerationId = 'gen-live';
    setChatAbort(FIXED_CHAT_ID, new AbortController());

    stopGeneration(FIXED_CHAT_ID);

    assert.equal(chat.currentGenerationId, 'gen-live');
  });

  test('an unknown explicit chat id does not stop the active chat', () => {
    seedActiveChat();
    const controller = new AbortController();
    setChatAbort(FIXED_CHAT_ID, controller);

    stopGeneration('22222222-2222-2222-2222-222222222222');

    assert.equal(controller.signal.aborted, false);
  });
});
