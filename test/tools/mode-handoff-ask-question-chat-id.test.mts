/**
 * propose_mode_switch must pass the tool-loop chatId into enqueueAskQuestion.
 *
 * mock.module must run before mode-handoff-tools loads.
 */
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

let lastEnqueueChatId: string | undefined;

mock.module('../../src/tools/ask-question-queue.ts', {
  namedExports: {
    enqueueAskQuestion: async (
      _args: unknown,
      _context: unknown,
      chatId?: string,
    ) => {
      lastEnqueueChatId = chatId;
      return JSON.stringify({ status: 'cancelled', answers: [] });
    },
    resetAskQuestionQueueForTests: () => {},
  },
});

const { executeProposeModeSwitch } = await import('../../src/tools/mode-handoff-tools.ts');

describe('executeProposeModeSwitch chat scope', () => {
  test('passes tool chatId to enqueueAskQuestion', async () => {
    lastEnqueueChatId = undefined;
    await executeProposeModeSwitch(
      { situation: 'plan_in_build' },
      { chatId: 'chat-handoff' },
    );
    assert.equal(lastEnqueueChatId, 'chat-handoff');
  });
});
