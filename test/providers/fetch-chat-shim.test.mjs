/**
 * postChatCompletions ReadableStream distinguishes abort, cancel, and empty complete.
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

/** @type {import('../../src/api/generations.ts').SubscribeToGenerationRawHandlers | undefined} */
let rawHandlers;
let cancelCalls = 0;
let unsubscribeCalls = 0;
let abortDuringSubscribeController;

mock.module('../../src/api/generations.ts', {
  namedExports: {
    createGeneration: async () => ({ generationId: 'gen_test' }),
    cancelGeneration: async () => {
      cancelCalls += 1;
    },
    subscribeToGenerationRaw: (_id, handlers) => {
      rawHandlers = handlers;
      abortDuringSubscribeController?.abort();
      abortDuringSubscribeController = undefined;
      return () => {
        unsubscribeCalls += 1;
      };
    },
  },
});

const { postChatCompletions } = await import('../../src/providers/fetch-chat.ts');

const provider = {
  id: 'test-provider',
  label: 'Test',
  baseUrl: 'http://127.0.0.1:9',
  apiKind: 'openai-v1',
};

async function consumeStreamError(res) {
  const reader = res.body.getReader();
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await reader.read();
      if (done) return null;
    }
  } catch (err) {
    return err;
  }
  return null;
}

describe('postChatCompletions shim', () => {
  test('cancelled end resolves as AbortError', async () => {
    const res = await postChatCompletions(
      provider,
      { messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 8 },
      new AbortController().signal,
    );
    rawHandlers?.onEnd?.({ status: 'cancelled' });
    const err = await consumeStreamError(res);
    assert.ok(err instanceof DOMException);
    assert.equal(err.name, 'AbortError');
  });

  test('onAbort resolves as AbortError', async () => {
    const res = await postChatCompletions(
      provider,
      { messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 8 },
      new AbortController().signal,
    );
    rawHandlers?.onAbort?.();
    const err = await consumeStreamError(res);
    assert.ok(err instanceof DOMException);
    assert.equal(err.name, 'AbortError');
  });

  test('zero-byte complete resolves as empty-response error', async () => {
    const res = await postChatCompletions(
      provider,
      { messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 8 },
      new AbortController().signal,
    );
    rawHandlers?.onEnd?.({ status: 'complete' });
    const err = await consumeStreamError(res);
    assert.ok(err instanceof Error);
    assert.match(err.message, /empty response/i);
  });

  test('cancelling the response body cancels the backend generation', async () => {
    cancelCalls = 0;
    unsubscribeCalls = 0;
    const res = await postChatCompletions(
      provider,
      { messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 8 },
      new AbortController().signal,
    );

    await res.body.cancel();

    assert.equal(cancelCalls, 1);
    assert.equal(unsubscribeCalls, 1);
  });

  test('an abort during subscription setup still cancels the backend generation', async () => {
    cancelCalls = 0;
    const abortController = new AbortController();
    abortDuringSubscribeController = abortController;

    const res = await postChatCompletions(
      provider,
      { messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 8 },
      abortController.signal,
    );
    const err = await consumeStreamError(res);

    assert.equal(err?.name, 'AbortError');
    assert.equal(cancelCalls, 1);
  });
});
